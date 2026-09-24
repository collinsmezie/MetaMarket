import { Inject, Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { AppConfigService } from '../../config/app-config.service';
import { EVENT_PUBLISHER, type EventPublisherPort } from '../../domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import { SchemaRegistry } from '../../platform/contracts/schema-registry';
import { RequestContextStore } from '../../platform/correlation/request-context';
import { correlatedEvent, PlatformEvents } from '../../platform/events/domain-event';
import { TRACE_RECORDER, type TraceRecorderPort } from '../../platform/observability/trace.port';
import { DEFAULT_MODEL_POLICY, type PromptDefinition } from '../../platform/prompt-runtime/prompt-definition';
import {
  PromptExecutor,
  type PromptOutcome,
  type PromptSection,
} from '../../platform/prompt-runtime/prompt-executor';
import { loadPromptFile, PromptRegistry } from '../../platform/prompt-runtime/prompt-registry';
import { componentVersion } from '../../platform/registry/component-registry';
import { validateCsreInvariants } from '../domain/csre-invariants';
import {
  CSRE_ENTITY_TYPES,
  CSRE_OUTPUT_SCHEMA_ID,
  CSRE_PROMPT_ID,
  CSRE_PROMPT_VERSION,
  CSRE_REQUEST_SCHEMA_VERSION,
  CSRE_RESPONSE_SCHEMA_VERSION,
  COMMERCIAL_RELEVANCE,
  csreIdempotencyKey,
  OBJECT_RELATIONSHIP_TYPES,
  type CSREInvocationStatus,
  type CSREServiceRequest,
  type CSREServiceResponse,
} from '../domain/csre-resolution';
import {
  EXTERNAL_EVIDENCE_RETRIEVAL,
  SEMANTIC_GROUNDING,
  type ExternalEvidenceRetrievalPort,
  type SemanticGroundingPort,
} from '../ports/semantic-grounding.port';
import {
  SEMANTIC_RESOLUTION_REPOSITORY,
  type SemanticResolutionRecord,
  type SemanticResolutionRepositoryPort,
} from '../ports/semantic-resolution.repository.port';
import type { SemanticResolutionPort } from '../ports/semantic-resolution.port';
import resolutionSchema from '../schemas/csre-resolution-v5.json';
import requestSchema from '../schemas/csre-service-request-v5.1.json';

const COMPONENT = 'CSRE';
const STAGE = 'resolve';
/** Below this semantic confidence an object is a candidate for the evidence path (§17). */
const EVIDENCE_CONFIDENCE_THRESHOLD = 0.6;

type Wire = Record<string, unknown>;

/**
 * Commercial Semantic Resolution Engine v5.4 (CSRE TDR).
 *
 * Answers "what is the person referring to?" for one logical turn: Cognitive Multi-Entity
 * Extraction, independent per-object resolution, commercial interpretation, canonicalisation
 * and the Phrase → EXPRESSES → MarketConcept origin record (§3, §15, §25). It never decides
 * intent, GPC, matching or graph truth (§2, §30.1).
 *
 * Runtime chain (§4, §17, §27.3): one pinned prompt bound to `csre-resolution-v5` → parse →
 * schema → semantic invariants → one bounded repair → adaptive evidence path (only when WRS is
 * bound and ambiguity is material) → authoritative correlation stamps → persistence → events.
 */
@Injectable()
export class CsreService implements SemanticResolutionPort {
  private definition: PromptDefinition | null = null;

  constructor(
    @Inject(SEMANTIC_RESOLUTION_REPOSITORY) private readonly resolutions: SemanticResolutionRepositoryPort,
    @Inject(SEMANTIC_GROUNDING) private readonly grounding: SemanticGroundingPort,
    @Inject(EXTERNAL_EVIDENCE_RETRIEVAL) private readonly evidence: ExternalEvidenceRetrievalPort,
    @Inject(TRACE_RECORDER) private readonly traces: TraceRecorderPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly prompts: PromptRegistry,
    private readonly schemas: SchemaRegistry,
    private readonly executor: PromptExecutor,
    private readonly config: AppConfigService,
  ) {}

  /** Registers the CSRE contracts (idempotent). */
  register(): PromptDefinition {
    if (this.definition !== null) return this.definition;
    this.schemas.register(resolutionSchema as Record<string, unknown>, {
      version: CSRE_RESPONSE_SCHEMA_VERSION,
    });
    this.schemas.register(requestSchema as Record<string, unknown>, { version: CSRE_REQUEST_SCHEMA_VERSION });
    this.definition = this.prompts.register({
      id: CSRE_PROMPT_ID,
      version: CSRE_PROMPT_VERSION,
      component: 'CSRE',
      schemaId: CSRE_OUTPUT_SCHEMA_ID,
      system: loadPromptFile(join(__dirname, '..', 'prompts', 'csre.master.md')),
      sections: [
        'policy',
        'vocabulary',
        'user-message',
        'current-messages',
        'conversation-context',
        'regional-context',
        'commercial-context',
        'known-market-concepts',
        'lexicon-evidence',
        'external-evidence',
        'clarification-answers',
      ],
      // Multi-object vendor messages produce large payloads; leave room for five-plus objects.
      modelPolicy: { ...DEFAULT_MODEL_POLICY, model: this.config.specialistModel, maxOutputTokens: 6_000 },
      description:
        'Resolves every independently meaningful referent in a logical turn into canonical semantic objects with their Phrase → MarketConcept origin.',
    });
    return this.definition;
  }

  async resolve(request: CSREServiceRequest): Promise<CSREServiceResponse> {
    const definition = this.register();
    const revision = request.understandingRevision ?? 0;
    const idempotencyKey = csreIdempotencyKey(request.conversationId, request.turnId, revision);

    // Same turn + snapshot + versions ⇒ the stored resolution, no second model call.
    const existing = await this.resolutions.findByIdempotencyKey(idempotencyKey);
    if (
      existing !== null &&
      existing.status === 'SUCCESS' &&
      existing.resolution !== null &&
      existing.contextSnapshotId === request.contextSnapshotId &&
      existing.promptVersion === definition.version &&
      existing.schemaVersion === CSRE_RESPONSE_SCHEMA_VERSION
    ) {
      return this.envelope(request, existing.resolution, null);
    }

    const parent = RequestContextStore.current();
    return RequestContextStore.resume(
      {
        correlationId: parent?.correlationId,
        requestId: request.requestId,
        parentRequestId: parent?.requestId ?? null,
        component: COMPONENT,
        conversationId: request.conversationId,
        turnId: request.turnId,
        runId: request.runId,
        messageId: parent?.messageId ?? null,
      },
      () => this.run(request, definition, idempotencyKey, revision),
    );
  }

  private async run(
    request: CSREServiceRequest,
    definition: PromptDefinition,
    idempotencyKey: string,
    revision: number,
  ): Promise<CSREServiceResponse> {
    const startedAt = this.clock.now();
    const current = RequestContextStore.current();

    await this.traces.startStep({
      runId: request.runId,
      requestId: request.requestId,
      parentRequestId: current?.parentRequestId ?? null,
      correlationId: current?.correlationId ?? `corr_${request.requestId}`,
      conversationId: request.conversationId,
      turnId: request.turnId,
      component: COMPONENT,
      componentVersion: componentVersion('CSRE'),
      stage: STAGE,
      schemaVersion: CSRE_RESPONSE_SCHEMA_VERSION,
      startedAt,
      inputSummary: {
        message: request.message,
        message_count: request.currentMessages.length,
        lexicon_evidence: request.lexiconEvidence.length,
        external_evidence: request.externalEvidence.length,
        clarification_answers: request.clarificationAnswers.length,
      },
    });

    const knownConcepts = await this.grounding.knownConcepts({
      conversationId: request.conversationId,
      message: request.message,
      locations: locationsOf(request.regionalContext),
    });

    const executionIds: string[] = [];
    const invoke = (externalEvidence: readonly Wire[]) =>
      this.executor.execute<Wire>({
        definition,
        sections: this.sections(request, definition, knownConcepts, externalEvidence),
        task: TASK,
        semanticValidator: (output) => validateCsreInvariants(output, request.message),
        decisionSummary: (output) => summarize(output as Wire),
      });

    // Fast path (§17): one invocation with the context the orchestrator supplied.
    let outcome: PromptOutcome<Wire> = await invoke(request.externalEvidence);
    executionIds.push(outcome.execution.id);

    // Evidence path (§9, §17): only when the retrieval port is bound, no evidence was supplied and
    // the first pass left material ambiguity that evidence could distinguish.
    if (
      outcome.status === 'SUCCESS' &&
      request.externalEvidence.length === 0 &&
      this.evidence.available() &&
      needsEvidence(outcome.data)
    ) {
      const retrieved = await this.evidence.retrieve({
        requestId: request.requestId,
        conversationId: request.conversationId,
        turnId: request.turnId,
        expressions: uncertainExpressions(outcome.data),
        regionalContext: request.regionalContext,
      });
      if (retrieved.length > 0) {
        const second = await invoke(retrieved.map((item) => ({ ...item })));
        executionIds.push(second.execution.id);
        // A failed second pass never discards a valid first pass.
        if (second.status === 'SUCCESS') outcome = second;
      }
    }

    const latencyMs = this.clock.now().getTime() - startedAt.getTime();

    if (outcome.status !== 'SUCCESS') {
      const status: CSREInvocationStatus =
        outcome.status === 'PROVIDER_FAILURE'
          ? 'TEMPORARY_FAILURE'
          : outcome.status === 'SCHEMA_FAILURE'
            ? 'SCHEMA_FAILURE'
            : 'POLICY_FAILURE';
      const error = { code: outcome.error.code, message: outcome.error.message };
      await this.persist(
        request,
        idempotencyKey,
        revision,
        status,
        null,
        outcome.execution.id,
        outcome,
        latencyMs,
        error,
      );
      await this.traces.finishStep({
        requestId: request.requestId,
        status: 'ERROR',
        completedAt: this.clock.now(),
        decision: { status },
        outputSummary: null,
        persistedRecordIds: [],
        promptExecutionIds: executionIds,
        retryCount: Math.max(0, outcome.execution.providerAttempts - 1),
        error: { ...error, retryable: outcome.error.retryable },
      });
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { requestId: request.requestId, turnId: request.turnId },
        action: `Semantic resolution failed with ${status}; returning a typed ERROR (never a fabricated object)`,
        error: new Error(error.message),
      });
      return this.envelope(request, null, { ...error, retryable: outcome.error.retryable });
    }

    // Authoritative correlation stamps (§29.3): the runtime owns them, the model only copies them.
    const wire = stampCorrelation(outcome.data, request);
    const check = this.schemas.validate(CSRE_OUTPUT_SCHEMA_ID, wire);
    if (!check.valid) {
      const error = {
        code: 'CSRE_POST_STAMP_SCHEMA_VIOLATION',
        message: check.errors.map((e) => `${e.path} ${e.message}`).join('; '),
      };
      await this.persist(
        request,
        idempotencyKey,
        revision,
        'SCHEMA_FAILURE',
        null,
        outcome.execution.id,
        outcome,
        latencyMs,
        error,
      );
      return this.envelope(request, null, { ...error, retryable: false });
    }

    const summary = summarize(wire);
    const { resolution: record, objects } = await this.persist(
      request,
      idempotencyKey,
      revision,
      'SUCCESS',
      wire,
      outcome.execution.id,
      outcome,
      latencyMs,
      null,
    );

    // One observation per object (§25.4, §27.5): what Evidence consumes to learn market language.
    for (const object of objects) {
      await this.events.publish(
        correlatedEvent({
          eventId: this.ids.uuid(),
          eventType: PlatformEvents.SemanticObjectResolved,
          producer: COMPONENT,
          occurredAt: this.clock.now(),
          payload: {
            requestId: request.requestId,
            turnId: request.turnId,
            semanticResolutionId: record.id,
            semanticObjectId: object.id,
            objectId: object.objectId,
            surfaceForm: object.surfaceForm,
            canonicalForm: object.canonicalForm,
            entityType: object.entityType,
            semanticOrigin: object.semanticOrigin,
            commercialRelevance: object.commercialRelevance,
            context: wire.context,
          },
          conversationId: request.conversationId,
          turnId: request.turnId,
          runId: request.runId,
          aggregate: { type: 'SemanticObject', id: object.id },
        }),
      );
    }

    await this.traces.finishStep({
      requestId: request.requestId,
      status: 'SUCCESS',
      completedAt: this.clock.now(),
      decision: summary,
      outputSummary: {
        object_count: summary.objects.length,
        clarification_required: summary.clarification_required,
        evidence_pass: executionIds.length > 1,
      },
      persistedRecordIds: [record.id, ...objects.map((object) => object.id)],
      promptExecutionIds: executionIds,
      retryCount: Math.max(0, outcome.execution.providerAttempts - 1),
      error: null,
    });

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { requestId: request.requestId, turnId: request.turnId, text: request.message },
      action: `Resolved ${summary.objects.length} object(s) (${summary.resolution_status})`,
      output: summary,
      durationMs: latencyMs,
    });

    return this.envelope(request, wire, null);
  }

  /** Runtime prompt sections (§7), each a labelled DATA block. */
  private sections(
    request: CSREServiceRequest,
    definition: PromptDefinition,
    knownConcepts: readonly unknown[],
    externalEvidence: readonly Wire[],
  ): PromptSection[] {
    return [
      {
        name: 'policy',
        content: {
          request_id: request.requestId,
          policy_version: request.policyVersion,
          prompt_version: definition.version,
          schema_version: CSRE_RESPONSE_SCHEMA_VERSION,
        },
      },
      {
        name: 'vocabulary',
        content: {
          entity_types: CSRE_ENTITY_TYPES,
          commercial_relevance: COMMERCIAL_RELEVANCE,
          relationship_types: OBJECT_RELATIONSHIP_TYPES,
        },
      },
      { name: 'user-message', content: request.message },
      { name: 'current-messages', content: request.currentMessages },
      { name: 'conversation-context', content: request.conversationContext },
      { name: 'regional-context', content: request.regionalContext },
      { name: 'commercial-context', content: request.commercialContext },
      { name: 'known-market-concepts', content: knownConcepts },
      { name: 'lexicon-evidence', content: request.lexiconEvidence },
      { name: 'external-evidence', content: externalEvidence },
      { name: 'clarification-answers', content: request.clarificationAnswers },
    ];
  }

  private async persist(
    request: CSREServiceRequest,
    idempotencyKey: string,
    revision: number,
    status: CSREInvocationStatus,
    wire: Wire | null,
    promptExecutionId: string,
    outcome: PromptOutcome<Wire>,
    latencyMs: number,
    error: { code: string; message: string } | null,
  ) {
    const summary = wire === null ? null : summarize(wire);
    return this.resolutions.save({
      requestId: request.requestId,
      idempotencyKey: status === 'SUCCESS' ? idempotencyKey : `${idempotencyKey}:failed:${request.requestId}`,
      conversationId: request.conversationId,
      turnId: request.turnId,
      runId: request.runId,
      contextSnapshotId: request.contextSnapshotId,
      understandingRevision: revision,
      componentVersion: componentVersion('CSRE'),
      promptId: CSRE_PROMPT_ID,
      promptVersion: CSRE_PROMPT_VERSION,
      schemaVersion: CSRE_RESPONSE_SCHEMA_VERSION,
      policyVersion: request.policyVersion,
      status,
      resolutionStatus: summary?.resolution_status ?? null,
      resolution: wire,
      objectCount: summary?.objects.length ?? 0,
      canonicalForms: summary?.objects.map((object) => object.canonical_form) ?? [],
      entityTypes: [...new Set(summary?.objects.map((object) => object.entity_type) ?? [])],
      clarificationRequired: summary?.clarification_required ?? false,
      promptExecutionId,
      modelProvider: outcome.execution.modelProvider,
      modelName: outcome.execution.modelName,
      latencyMs,
      error,
    });
  }

  private envelope(
    request: CSREServiceRequest,
    wire: Readonly<Wire> | null,
    error: { code: string; message: string; retryable: boolean } | null,
  ): CSREServiceResponse {
    return {
      requestId: request.requestId,
      component: 'CSRE',
      componentVersion: componentVersion('CSRE'),
      conversationId: request.conversationId,
      turnId: request.turnId,
      runId: request.runId,
      status: error !== null || wire === null ? 'ERROR' : 'SUCCESS',
      resolution: wire,
      error,
    };
  }
}

const TASK = [
  'Resolve the USER MESSAGE according to the CSRE system instructions.',
  'Perform Cognitive Multi-Entity Extraction first: identify every independently resolvable object, preserve its exact surface span, separate objects from context, venue, qualifiers and constraints, and identify relationships between objects.',
  'Assign object_1, object_2, … in order of appearance; resolve each object independently using the whole message and the supplied context and evidence; determine commercial interpretation; canonicalize without unsupported specificity; preserve brand, model, attributes, aliases and relationships; preserve ambiguity where it materially affects the result; recommend at most one clarification question.',
  'Do NOT classify transaction intent, assign GPC or taxonomy IDs, perform vector search, capability matching, enrichment or vendor ranking.',
  'Return only the csre-resolution-v5 JSON object.',
].join('\n');

/** Runtime-owned fields (§27.1, §29.3 rule 1) and the derived origin confidence. */
export function stampCorrelation(wire: Readonly<Wire>, request: CSREServiceRequest): Wire {
  const objects = ((wire.objects as Wire[]) ?? []).map((object) => {
    const origin = (object.semantic_origin ?? {}) as Wire;
    const confidence = (object.confidence ?? {}) as Wire;
    return {
      ...object,
      semantic_origin: {
        ...origin,
        relationship: 'EXPRESSES',
        origin: 'CSRE',
        request_id: request.requestId,
        semantic_confidence:
          typeof confidence.semantic_resolution === 'number'
            ? confidence.semantic_resolution
            : origin.semantic_confidence,
      },
    };
  });
  return {
    ...wire,
    schema_version: CSRE_RESPONSE_SCHEMA_VERSION,
    request_id: request.requestId,
    original_message: request.message,
    objects,
  };
}

function needsEvidence(wire: Readonly<Wire>): boolean {
  const status = wire.resolution_status;
  if (status === 'NON_REFERENTIAL') return false;
  return uncertainExpressions(wire).length > 0;
}

function uncertainExpressions(wire: Readonly<Wire>): Array<{ surfaceForm: string; candidates: string[] }> {
  return ((wire.objects as Wire[]) ?? [])
    .filter((object) => {
      const ambiguity = object.ambiguity as { present?: boolean } | undefined;
      const confidence = object.confidence as { semantic_resolution?: number } | undefined;
      return (
        ambiguity?.present === true || (confidence?.semantic_resolution ?? 1) < EVIDENCE_CONFIDENCE_THRESHOLD
      );
    })
    .map((object) => ({
      surfaceForm: String(object.surface_form),
      candidates: (((object.ambiguity as Wire)?.remaining_candidates as Wire[]) ?? []).map((c) =>
        String(c.meaning),
      ),
    }));
}

function locationsOf(regionalContext: Readonly<Wire>): string[] {
  const locations = regionalContext.locations;
  return Array.isArray(locations)
    ? locations.map((location) => String((location as Wire).value ?? location))
    : [];
}

export interface DecisionSummary {
  resolution_status: string;
  objects: Array<{
    object_id: string;
    surface_form: string;
    canonical_form: string;
    entity_type: string;
    concept: string;
    concept_status: string;
    market_concept_id: string | null;
    brand: string | null;
    model: string | null;
    relevance: string;
    semantic_confidence: number;
    ambiguous: boolean;
  }>;
  venues: string[];
  functional_context: string[];
  clarification_required: boolean;
}

export function summarize(wire: Readonly<Wire>): DecisionSummary {
  const objects = (wire.objects as Wire[]) ?? [];
  const context = (wire.context ?? {}) as Wire;
  const clarification = (wire.clarification ?? {}) as { required?: boolean };
  return {
    resolution_status: String(wire.resolution_status),
    objects: objects.map((object) => {
      const origin = (object.semantic_origin ?? {}) as Wire;
      const commercial = (object.commercial_interpretation ?? {}) as Wire;
      const confidence = (object.confidence ?? {}) as Wire;
      return {
        object_id: String(object.object_id),
        surface_form: String(object.surface_form),
        canonical_form: String(object.canonical_form),
        entity_type: String(object.entity_type),
        concept: String(origin.concept),
        concept_status: String(origin.concept_status),
        market_concept_id: (origin.market_concept_id as string | null) ?? null,
        brand: (object.brand as string | null) ?? null,
        model: (object.model as string | null) ?? null,
        relevance: String(commercial.relevance),
        semantic_confidence: Number(confidence.semantic_resolution),
        ambiguous: (object.ambiguity as { present?: boolean } | undefined)?.present === true,
      };
    }),
    venues: ((context.venues as Wire[]) ?? []).map((venue) => String(venue.canonical_venue)),
    functional_context: ((context.functional_context as unknown[]) ?? []).map(String),
    clarification_required: clarification.required === true,
  };
}

export type { SemanticResolutionRecord };
