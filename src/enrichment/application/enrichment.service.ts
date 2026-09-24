import { Inject, Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { AppConfigService } from '../../config/app-config.service';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../../domain/ports/outbound/embedding-provider.port';
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
import {
  SEMANTIC_RESOLUTION_REPOSITORY,
  type SemanticResolutionRepositoryPort,
} from '../../semantics/ports/semantic-resolution.repository.port';
import { validateEnrichmentInvariants } from '../domain/enrichment-invariants';
import {
  ENRICHMENT_OUTPUT_SCHEMA_ID,
  ENRICHMENT_PROMPT_ID,
  ENRICHMENT_PROMPT_VERSION,
  ENRICHMENT_REQUEST_SCHEMA_VERSION,
  ENRICHMENT_RESPONSE_SCHEMA_VERSION,
  enrichmentIdempotencyKey,
  type EnrichmentInvocationStatus,
  type EnrichmentServiceRequest,
  type EnrichmentServiceResponse,
} from '../domain/enrichment-resolution';
import {
  ENRICHMENT_REPOSITORY,
  type EnrichmentRepositoryPort,
  type NewEnrichmentProfile,
  type ProfileEmbeddings,
} from '../ports/enrichment.repository.port';
import {
  ENRICHMENT_EVIDENCE_RETRIEVAL,
  MKG_READ,
  type EnrichmentEvidenceItem,
  type EnrichmentEvidenceRetrievalPort,
  type MKGReadPort,
} from '../ports/mkg-read.port';
import type { SemanticEnrichmentPort } from '../ports/semantic-enrichment.port';
import resolutionSchema from '../schemas/enrichment-resolution-v4.json';
import requestSchema from '../schemas/enrichment-service-request-v4.1.json';

const COMPONENT = 'ENRICHMENT';
const STAGE = 'enrich';

type Wire = Record<string, unknown>;

/**
 * GPC-Oriented Semantic Enrichment Engine v4.4 (Enrichment TDR).
 *
 * Takes CSRE's resolved objects and produces, per object, the classification-ready semantic
 * profile and purpose-built embedding representations downstream retrieval needs (§1, §6, §11),
 * without re-resolving identity (§13 "DO NOT RE-RESOLVE"), without GPC codes (§7) and without
 * unsupported specificity (§10). Pipeline per Overarching §11.1: identity validation → knowledge
 * lookup (MKG read port) → optional WRS evidence → model enrichment → schema + invariants →
 * lineage/correlation stamps → embeddings → persistence → event.
 */
@Injectable()
export class EnrichmentService implements SemanticEnrichmentPort {
  private definition: PromptDefinition | null = null;

  constructor(
    @Inject(ENRICHMENT_REPOSITORY) private readonly enrichments: EnrichmentRepositoryPort,
    @Inject(SEMANTIC_RESOLUTION_REPOSITORY) private readonly semantics: SemanticResolutionRepositoryPort,
    @Inject(MKG_READ) private readonly knowledge: MKGReadPort,
    @Inject(ENRICHMENT_EVIDENCE_RETRIEVAL) private readonly evidence: EnrichmentEvidenceRetrievalPort,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProviderPort,
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

  register(): PromptDefinition {
    if (this.definition !== null) return this.definition;
    this.schemas.register(resolutionSchema as Record<string, unknown>, {
      version: ENRICHMENT_RESPONSE_SCHEMA_VERSION,
    });
    this.schemas.register(requestSchema as Record<string, unknown>, {
      version: ENRICHMENT_REQUEST_SCHEMA_VERSION,
    });
    this.definition = this.prompts.register({
      id: ENRICHMENT_PROMPT_ID,
      version: ENRICHMENT_PROMPT_VERSION,
      component: 'ENRICHMENT',
      schemaId: ENRICHMENT_OUTPUT_SCHEMA_ID,
      system: loadPromptFile(join(__dirname, '..', 'prompts', 'enrichment.master.md')),
      sections: [
        'policy',
        'resolver-output',
        'context',
        'available-evidence',
        'knowledge-context',
        'downstream-purpose',
        'target-level',
      ],
      // Five-object vendor statements produce ~1.2k tokens per profile.
      modelPolicy: { ...DEFAULT_MODEL_POLICY, model: this.config.specialistModel, maxOutputTokens: 8_000 },
      description:
        'Enriches CSRE objects with GPC-oriented semantic context and embedding representations without re-resolving them.',
    });
    return this.definition;
  }

  async enrich(request: EnrichmentServiceRequest): Promise<EnrichmentServiceResponse> {
    const definition = this.register();
    const idempotencyKey = enrichmentIdempotencyKey(
      request.conversationId,
      request.turnId,
      request.sourceResolution.resolutionRequestId,
      request.downstreamPurpose,
    );

    const existing = await this.enrichments.findByIdempotencyKey(idempotencyKey);
    if (
      existing !== null &&
      existing.status === 'SUCCESS' &&
      existing.resolution !== null &&
      existing.promptVersion === definition.version &&
      existing.schemaVersion === ENRICHMENT_RESPONSE_SCHEMA_VERSION
    ) {
      return this.envelope(request, existing.resolution, null);
    }

    // §26.1: reject objects that do not carry a CSRE EXPRESSES origin.
    const foreign = request.objects.find((object) => {
      const origin = (object.semantic_origin ?? {}) as Wire;
      return origin.origin !== 'CSRE' || origin.relationship !== 'EXPRESSES';
    });
    if (foreign !== undefined) {
      return this.envelope(request, null, {
        code: 'ENRICHMENT_INPUT_NOT_CSRE',
        message: `Object "${String(foreign.object_id)}" does not carry a CSRE EXPRESSES semantic origin`,
        retryable: false,
      });
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
      () => this.run(request, definition, idempotencyKey),
    );
  }

  private async run(
    request: EnrichmentServiceRequest,
    definition: PromptDefinition,
    idempotencyKey: string,
  ): Promise<EnrichmentServiceResponse> {
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
      componentVersion: componentVersion('ENRICHMENT'),
      stage: STAGE,
      schemaVersion: ENRICHMENT_RESPONSE_SCHEMA_VERSION,
      startedAt,
      inputSummary: {
        objects: request.objects.map((object) => ({
          object_id: object.object_id,
          canonical_form: object.canonical_form,
          entity_type: object.entity_type,
        })),
        downstream_purpose: request.downstreamPurpose,
        source_resolution_request_id: request.sourceResolution.resolutionRequestId,
        available_evidence: request.availableEvidence?.length ?? 0,
      },
    });

    // Knowledge context (§29.3): read-only, empty until the graph exists.
    const knowledge = await this.knowledge
      .knowledgeFor({
        marketConceptIds: request.objects
          .map(
            (object) =>
              ((object.semantic_origin as Wire | undefined)?.market_concept_id as string | null) ?? null,
          )
          .filter((id): id is string => id !== null),
        labels: request.objects.map((object) => String(object.canonical_form)),
        locality: null,
      })
      .catch(() => []);

    let evidenceItems: readonly EnrichmentEvidenceItem[] = (request.availableEvidence ?? []).map(
      toEvidenceItem,
    );
    const executionIds: string[] = [];
    const invoke = () =>
      this.executor.execute<Wire>({
        definition,
        sections: this.sections(request, definition, knowledge, evidenceItems),
        task: TASK,
        semanticValidator: (output) =>
          validateEnrichmentInvariants(
            output,
            request.objects,
            new Set(evidenceItems.map((item) => item.evidenceId)),
          ),
        decisionSummary: (output) => summarize(output as Wire),
      });

    let outcome: PromptOutcome<Wire> = await invoke();
    executionIds.push(outcome.execution.id);

    // §8/§9: the evidence path runs only when the model asked for evidence and WRS is bound.
    if (outcome.status === 'SUCCESS' && this.evidence.available()) {
      const requests = evidenceRequestsOf(outcome.data);
      if (requests.length > 0) {
        const retrieved: EnrichmentEvidenceItem[] = [];
        for (const entry of requests) {
          const object = request.objects.find((candidate) => candidate.object_id === entry.objectId);
          const items = await this.evidence.retrieve({
            requestId: request.requestId,
            conversationId: request.conversationId,
            turnId: request.turnId,
            objectId: entry.objectId,
            semanticOrigin: ((object?.semantic_origin as Wire | undefined) ?? {}) as Wire,
            ...entry.request,
          });
          retrieved.push(...items);
        }
        if (retrieved.length > 0) {
          evidenceItems = [...evidenceItems, ...retrieved];
          const second = await invoke();
          executionIds.push(second.execution.id);
          if (second.status === 'SUCCESS') outcome = second;
        }
      }
    }

    const latencyMs = this.clock.now().getTime() - startedAt.getTime();

    if (outcome.status !== 'SUCCESS') {
      const status: EnrichmentInvocationStatus =
        outcome.status === 'PROVIDER_FAILURE'
          ? 'TEMPORARY_FAILURE'
          : outcome.status === 'SCHEMA_FAILURE'
            ? 'SCHEMA_FAILURE'
            : 'POLICY_FAILURE';
      const error = { code: outcome.error.code, message: outcome.error.message };
      await this.persist(request, idempotencyKey, status, null, [], outcome, latencyMs, error);
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
        action: `Enrichment failed with ${status}; returning a typed ERROR (never a guessed profile)`,
        error: new Error(error.message),
      });
      return this.envelope(request, null, { ...error, retryable: outcome.error.retryable });
    }

    // Runtime-owned correlation (§28.3): the model copies them, the runtime owns them.
    const wire: Wire = {
      ...outcome.data,
      schema_version: ENRICHMENT_RESPONSE_SCHEMA_VERSION,
      request_id: request.requestId,
      source_resolution: {
        resolver_version: request.sourceResolution.componentVersion,
        resolution_request_id: request.sourceResolution.resolutionRequestId,
      },
    };
    const check = this.schemas.validate(ENRICHMENT_OUTPUT_SCHEMA_ID, wire);
    if (!check.valid) {
      const error = {
        code: 'ENRICHMENT_POST_STAMP_SCHEMA_VIOLATION',
        message: check.errors.map((e) => `${e.path} ${e.message}`).join('; '),
      };
      await this.persist(request, idempotencyKey, 'SCHEMA_FAILURE', null, [], outcome, latencyMs, error);
      return this.envelope(request, null, { ...error, retryable: false });
    }

    const profiles = await this.profiles(request, wire);
    const summary = summarize(wire);
    const { resolution: record, profiles: saved } = await this.persist(
      request,
      idempotencyKey,
      'SUCCESS',
      wire,
      profiles,
      outcome,
      latencyMs,
      null,
    );

    await this.events.publish(
      correlatedEvent({
        eventId: this.ids.uuid(),
        eventType: PlatformEvents.EnrichmentCompleted,
        producer: COMPONENT,
        occurredAt: this.clock.now(),
        payload: {
          requestId: request.requestId,
          turnId: request.turnId,
          enrichmentResolutionId: record.id,
          sourceResolutionRequestId: request.sourceResolution.resolutionRequestId,
          downstreamPurpose: request.downstreamPurpose,
          enrichmentStatus: summary.enrichment_status,
          profiles: saved.map((profile) => ({
            id: profile.id,
            objectId: profile.objectId,
            semanticObjectId: profile.semanticObjectId,
            canonicalForm: profile.canonicalForm,
          })),
        },
        conversationId: request.conversationId,
        turnId: request.turnId,
        runId: request.runId,
        aggregate: { type: 'EnrichmentResolution', id: record.id },
      }),
    );

    await this.traces.finishStep({
      requestId: request.requestId,
      status: 'SUCCESS',
      completedAt: this.clock.now(),
      decision: summary,
      outputSummary: {
        object_count: summary.objects.length,
        enrichment_status: summary.enrichment_status,
        evidence_pass: executionIds.length > 1,
        embedded: profiles.filter((p) => p.embeddings !== null).length,
      },
      persistedRecordIds: [record.id, ...saved.map((profile) => profile.id)],
      promptExecutionIds: executionIds,
      retryCount: Math.max(0, outcome.execution.providerAttempts - 1),
      error: null,
    });

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { requestId: request.requestId, turnId: request.turnId, objects: request.objects.length },
      action: `Enriched ${summary.objects.length} object(s) (${summary.enrichment_status})`,
      output: summary,
      durationMs: latencyMs,
    });

    return this.envelope(request, wire, null);
  }

  private sections(
    request: EnrichmentServiceRequest,
    definition: PromptDefinition,
    knowledge: readonly unknown[],
    evidence: readonly EnrichmentEvidenceItem[],
  ): PromptSection[] {
    const levels = [...new Set(request.objects.map((object) => targetLevel(String(object.entity_type))))];
    return [
      {
        name: 'policy',
        content: {
          request_id: request.requestId,
          source_resolution: {
            resolver_version: request.sourceResolution.componentVersion,
            resolution_request_id: request.sourceResolution.resolutionRequestId,
          },
          policy_version: request.policyVersion,
          prompt_version: definition.version,
          schema_version: ENRICHMENT_RESPONSE_SCHEMA_VERSION,
        },
      },
      {
        name: 'resolver-output',
        content: {
          schema_version: '5.0',
          request_id: request.sourceResolution.resolutionRequestId,
          objects: request.objects,
          relationships: request.relationships,
        },
      },
      { name: 'context', content: request.messageContext },
      {
        name: 'available-evidence',
        content: evidence.map((item) => ({
          evidence_id: item.evidenceId,
          source: item.source,
          source_type: item.sourceType,
          claim: item.claim,
          reliability: item.reliability,
          geographic_relevance: item.geographicRelevance,
        })),
      },
      { name: 'knowledge-context', content: knowledge },
      { name: 'downstream-purpose', content: request.downstreamPurpose },
      { name: 'target-level', content: levels.length === 1 ? levels[0] : 'mixed object set' },
    ];
  }

  /** Embeds the three representations per object (§11) and links each profile to its durable CSRE object. */
  private async profiles(request: EnrichmentServiceRequest, wire: Wire): Promise<NewEnrichmentProfile[]> {
    const objects = (wire.objects as Wire[]) ?? [];
    const persisted = await this.semantics
      .objectsForRequest(request.sourceResolution.resolutionRequestId)
      .catch(() => []);
    const byObjectId = new Map(persisted.map((object) => [object.objectId, object.id]));

    const texts = objects.flatMap((object) => {
      const embedding = (object.embedding_representations ?? {}) as Wire;
      return [
        String(embedding.canonical_embedding_text ?? ''),
        String(embedding.functional_embedding_text ?? ''),
        String(embedding.taxonomy_embedding_text ?? ''),
      ];
    });
    let vectors: readonly (readonly number[] | null)[] = texts.map(() => null);
    const nonEmpty = texts
      .map((text, index) => ({ text, index }))
      .filter((entry) => entry.text.trim().length > 0);
    if (nonEmpty.length > 0) {
      try {
        const embedded = await this.embeddings.embedBatch(nonEmpty.map((entry) => entry.text));
        const filled = [...vectors];
        nonEmpty.forEach((entry, position) => {
          filled[entry.index] = embedded[position] ?? null;
        });
        vectors = filled;
      } catch (error) {
        // Embeddings are a retrieval optimisation; their outage must not lose the profile.
        this.logger.stageFailed({
          component: COMPONENT,
          stage: `${STAGE}:Embeddings`,
          input: { requestId: request.requestId, texts: nonEmpty.length },
          action: 'Could not embed enrichment representations; profiles are stored without vectors',
          error,
        });
      }
    }

    return objects.map((object, index) => {
      const [canonical, functional, taxonomy] = [
        vectors[index * 3] ?? null,
        vectors[index * 3 + 1] ?? null,
        vectors[index * 3 + 2] ?? null,
      ];
      const embeddings: ProfileEmbeddings | null =
        canonical === null && functional === null && taxonomy === null
          ? null
          : { model: this.embeddings.model, canonical, functional, taxonomy };
      return {
        objectId: String(object.object_id),
        semanticObjectId: byObjectId.get(String(object.object_id)) ?? null,
        profile: object,
        embeddings,
      };
    });
  }

  private async persist(
    request: EnrichmentServiceRequest,
    idempotencyKey: string,
    status: EnrichmentInvocationStatus,
    wire: Wire | null,
    profiles: readonly NewEnrichmentProfile[],
    outcome: PromptOutcome<Wire>,
    latencyMs: number,
    error: { code: string; message: string } | null,
  ) {
    const summary = wire === null ? null : summarize(wire);
    return this.enrichments.save(
      {
        requestId: request.requestId,
        idempotencyKey:
          status === 'SUCCESS' ? idempotencyKey : `${idempotencyKey}:failed:${request.requestId}`,
        conversationId: request.conversationId,
        turnId: request.turnId,
        runId: request.runId,
        contextSnapshotId: request.contextSnapshotId,
        sourceResolutionRequestId: request.sourceResolution.resolutionRequestId,
        componentVersion: componentVersion('ENRICHMENT'),
        promptId: ENRICHMENT_PROMPT_ID,
        promptVersion: ENRICHMENT_PROMPT_VERSION,
        schemaVersion: ENRICHMENT_RESPONSE_SCHEMA_VERSION,
        policyVersion: request.policyVersion,
        downstreamPurpose: request.downstreamPurpose,
        status,
        enrichmentStatus: summary?.enrichment_status ?? null,
        resolution: wire,
        objectCount: summary?.objects.length ?? 0,
        evidenceRequired: summary?.objects.some((object) => object.evidence_required) ?? false,
        promptExecutionId: outcome.execution.id,
        modelProvider: outcome.execution.modelProvider,
        modelName: outcome.execution.modelName,
        latencyMs,
        error,
      },
      profiles,
    );
  }

  private envelope(
    request: EnrichmentServiceRequest,
    wire: Readonly<Wire> | null,
    error: { code: string; message: string; retryable: boolean } | null,
  ): EnrichmentServiceResponse {
    return {
      requestId: request.requestId,
      component: 'ENRICHMENT',
      componentVersion: componentVersion('ENRICHMENT'),
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
  'Enrich the resolved commercial object set according to the system instructions.',
  'For every object: preserve the CSRE identity; build the semantic profile; add functional information, useful terminology, distinguishing characteristics and confusable concepts; generate GPC-oriented vocabulary and the three embedding texts plus search/semantic/negative terms; decide whether external evidence is actually needed and, if so, describe the exact WRS request.',
  'For multi-object inputs, enrich each object independently while preserving supplied relationships and shared context.',
  'Do not produce final GPC classification. Do not invent unsupported specificity.',
  'Return only the enrichment-resolution-v4 JSON object.',
].join('\n');

function targetLevel(entityType: string): string {
  switch (entityType) {
    case 'PRODUCT_CATEGORY':
      return 'category';
    case 'PRODUCT_SUBCATEGORY':
      return 'subcategory';
    case 'SERVICE':
      return 'service';
    case 'CAPABILITY':
      return 'capability';
    case 'MATERIAL':
      return 'material';
    case 'CONCEPT':
      return 'domain';
    default:
      return 'product';
  }
}

function toEvidenceItem(wire: Readonly<Wire>): EnrichmentEvidenceItem {
  return {
    evidenceId: String(wire.evidence_id ?? wire.evidenceId ?? ''),
    source: String(wire.source ?? ''),
    sourceType: String(wire.source_type ?? wire.sourceType ?? 'UNKNOWN'),
    claim: String(wire.claim ?? ''),
    reliability: Number(wire.reliability ?? 0.5),
    geographicRelevance: (wire.geographic_relevance as string | null | undefined) ?? null,
  };
}

function evidenceRequestsOf(wire: Readonly<Wire>): Array<{
  objectId: string;
  request: {
    question: string;
    reason: string;
    candidates: string[];
    geographicContext: string | null;
    preferredSourceTypes: string[];
    requestedFields: string[];
  };
}> {
  return ((wire.objects as Wire[]) ?? [])
    .filter(
      (object) =>
        object.evidence_required === true &&
        object.evidence_request !== null &&
        object.evidence_request !== undefined,
    )
    .map((object) => {
      const request = object.evidence_request as Wire;
      return {
        objectId: String(object.object_id),
        request: {
          question: String(request.question ?? ''),
          reason: String(request.reason ?? ''),
          candidates: ((request.candidates as unknown[]) ?? []).map(String),
          geographicContext: (request.geographic_context as string | null) ?? null,
          preferredSourceTypes: ((request.preferred_source_types as unknown[]) ?? []).map(String),
          requestedFields: ((request.requested_fields as unknown[]) ?? []).map(String),
        },
      };
    });
}

export interface EnrichmentSummary {
  enrichment_status: string;
  objects: Array<{
    object_id: string;
    canonical_form: string;
    entity_type: string;
    primary_function: string | null;
    domain_hints: string[];
    category_hints: string[];
    confusables: string[];
    search_terms: number;
    evidence_required: boolean;
    resolution_concern: string | null;
    confidence: number;
  }>;
}

export function summarize(wire: Readonly<Wire>): EnrichmentSummary {
  return {
    enrichment_status: String(wire.enrichment_status),
    objects: ((wire.objects as Wire[]) ?? []).map((object) => {
      const functional = (object.functional_profile ?? {}) as Wire;
      const taxonomy = (object.taxonomy_semantics ?? {}) as Wire;
      const embedding = (object.embedding_representations ?? {}) as Wire;
      const confidence = (object.confidence ?? {}) as Wire;
      return {
        object_id: String(object.object_id),
        canonical_form: String(object.canonical_form),
        entity_type: String(object.entity_type),
        primary_function: (functional.primary_function as string | null) ?? null,
        domain_hints: ((taxonomy.domain_hints as unknown[]) ?? []).map(String),
        category_hints: ((taxonomy.category_hints as unknown[]) ?? []).map(String),
        confusables: ((object.confusable_concepts as Wire[]) ?? []).map((item) => String(item.concept)),
        search_terms: ((embedding.search_terms as unknown[]) ?? []).length,
        evidence_required: object.evidence_required === true,
        resolution_concern: (object.resolution_concern as string | null) ?? null,
        confidence: Number(confidence.enrichment ?? 0),
      };
    }),
  };
}
