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
import {
  ENRICHMENT_REPOSITORY,
  type EnrichmentRepositoryPort,
} from '../../enrichment/ports/enrichment.repository.port';
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
import { validateGpcInvariants } from '../domain/gpc-invariants';
import {
  candidateToWire,
  GPC_CANDIDATE_SCHEMA_ID,
  GPC_PROMPT_ID,
  GPC_PROMPT_VERSION,
  GPC_RESPONSE_SCHEMA_ID,
  GPC_WIRE_SCHEMA_VERSION,
  gpcIdempotencyKey,
  NON_GPC_ENTITY_TYPES,
  REASON_CODES,
  type GpcCandidate,
  type GpcInvocationStatus,
  type GpcResolverServiceRequest,
  type GpcResolverServiceResponse,
} from '../domain/gpc-mapping';
import {
  GPC_CANDIDATE_RETRIEVAL,
  GPC_KNOWLEDGE,
  type CandidateQuery,
  type GpcCandidateRetrievalPort,
  type GpcKnowledgePort,
} from '../ports/gpc-candidate-retrieval.port';
import {
  GPC_MAPPING_REPOSITORY,
  type GpcMappingRepositoryPort,
  type NewGpcMapping,
} from '../ports/gpc-mapping.repository.port';
import type { GpcResolutionPort } from '../ports/gpc-resolution.port';
import candidateSchema from '../schemas/gpc-candidate-v4.json';
import requestSchema from '../schemas/gpc-resolver-request-v4.json';
import responseSchema from '../schemas/gpc-resolver-response-v4.json';

const COMPONENT = 'GPC_RESOLVER';
const STAGE = 'resolve';
const CANDIDATES_PER_OBJECT = 10;

type Wire = Record<string, unknown>;

/**
 * GPC Resolver v4.4 — sovereign classification (GPC Resolver TDR).
 *
 * Answers "where does this already-resolved MarketConcept belong in GS1 GPC?" (§75.1): retrieves
 * candidates from the installed sovereign taxonomy through `GpcCandidateRetrievalPort` (§76.2),
 * lets the model compare them against the CSRE identity and Enrichment context (§13–§15, §49),
 * and enforces sovereignty in code — a mapping may only name a supplied candidate, with that
 * candidate's level and title (§5, §93.4). Non-product referents are NOT_APPLICABLE without a
 * model call (§14.1, §17). Every mapping is emitted as a fact for Evidence/MKG (§75.2).
 */
@Injectable()
export class GpcResolverService implements GpcResolutionPort {
  private definition: PromptDefinition | null = null;

  constructor(
    @Inject(GPC_MAPPING_REPOSITORY) private readonly mappings: GpcMappingRepositoryPort,
    @Inject(GPC_CANDIDATE_RETRIEVAL) private readonly retrieval: GpcCandidateRetrievalPort,
    @Inject(GPC_KNOWLEDGE) private readonly knowledge: GpcKnowledgePort,
    @Inject(SEMANTIC_RESOLUTION_REPOSITORY) private readonly semantics: SemanticResolutionRepositoryPort,
    @Inject(ENRICHMENT_REPOSITORY) private readonly enrichments: EnrichmentRepositoryPort,
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
    this.schemas.register(responseSchema as Record<string, unknown>, { version: GPC_WIRE_SCHEMA_VERSION });
    this.schemas.register(requestSchema as Record<string, unknown>, { version: GPC_WIRE_SCHEMA_VERSION });
    this.schemas.register(candidateSchema as Record<string, unknown>, { version: GPC_WIRE_SCHEMA_VERSION });
    this.definition = this.prompts.register({
      id: GPC_PROMPT_ID,
      version: GPC_PROMPT_VERSION,
      component: 'GPC_RESOLVER',
      schemaId: GPC_RESPONSE_SCHEMA_ID,
      system: loadPromptFile(join(__dirname, '..', 'prompts', 'gpc.master.md')),
      sections: [
        'policy',
        'csre-objects',
        'enrichment',
        'market-knowledge',
        'evidence',
        'gpc-candidates',
        'gpc-hierarchy',
        'message-context',
      ],
      modelPolicy: { ...DEFAULT_MODEL_POLICY, model: this.config.specialistModel, maxOutputTokens: 4_000 },
      description:
        'Maps already-resolved MarketConcepts onto the best existing sovereign GPC representation.',
    });
    return this.definition;
  }

  async resolve(request: GpcResolverServiceRequest): Promise<GpcResolverServiceResponse> {
    const definition = this.register();
    const deployed = componentVersion('GPC_RESOLVER');
    if (request.resolverVersion !== deployed) {
      return this.envelope(request, null, {
        code: 'GPC_RESOLVER_VERSION_MISMATCH',
        message: `resolver_version ${request.resolverVersion} is not the deployed ${deployed}`,
        retryable: false,
      });
    }
    const csreRequestId = firstTrace(request.objects, 'csre_request_id');
    const enrichmentRequestId = firstTrace(request.objects, 'enrichment_request_id');
    if (csreRequestId === null) {
      return this.envelope(request, null, {
        code: 'GPC_SOURCE_TRACE_MISSING',
        message: 'Objects carry no source_trace.csre_request_id',
        retryable: false,
      });
    }
    const idempotencyKey = gpcIdempotencyKey(
      request.conversationId,
      request.turnId,
      csreRequestId,
      enrichmentRequestId,
    );

    const existing = await this.mappings.findByIdempotencyKey(idempotencyKey);
    if (
      existing !== null &&
      existing.status === 'SUCCESS' &&
      existing.resolution !== null &&
      existing.promptVersion === definition.version
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
      () => this.run(request, definition, idempotencyKey, csreRequestId, enrichmentRequestId),
    );
  }

  private async run(
    request: GpcResolverServiceRequest,
    definition: PromptDefinition,
    idempotencyKey: string,
    csreRequestId: string,
    enrichmentRequestId: string | null,
  ): Promise<GpcResolverServiceResponse> {
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
      componentVersion: componentVersion('GPC_RESOLVER'),
      stage: STAGE,
      schemaVersion: GPC_WIRE_SCHEMA_VERSION,
      startedAt,
      inputSummary: {
        objects: request.objects.map((object) => ({
          object_id: object.object_id,
          canonical_form: object.canonical_form,
          entity_type: object.entity_type,
        })),
        csre_request_id: csreRequestId,
        enrichment_request_id: enrichmentRequestId,
        supplied_candidates: request.gpcCandidates.length,
      },
    });

    // §14.1 / §17: referents the product taxonomy cannot represent are decided deterministically.
    const applicable = request.objects.filter(
      (object) => !NON_GPC_ENTITY_TYPES.has(String(object.entity_type)) && !isNonCommercial(object),
    );
    const notApplicable = request.objects.filter((object) => !applicable.includes(object));

    // Knowledge context (§76.6) and candidate retrieval (§76.2).
    const priors = await this.knowledge
      .priorMappings({
        marketConceptIds: request.objects
          .map(
            (object) =>
              ((object.semantic_origin as Wire | undefined)?.market_concept_id as string | null) ?? null,
          )
          .filter((id): id is string => id !== null),
        concepts: request.objects.map((object) =>
          String(
            ((object.semantic_origin as Wire | undefined)?.concept as string | undefined) ??
              object.canonical_form,
          ),
        ),
      })
      .catch(() => []);
    const enrichmentByObject = request.enrichment as Record<string, Wire>;
    const queries: CandidateQuery[] = applicable.map((object) => {
      const enrichment = enrichmentByObject[String(object.object_id)] ?? {};
      const terminology = (enrichment.commercial_terminology ?? {}) as Wire;
      const taxonomy = (enrichment.taxonomy_semantics ?? {}) as Wire;
      const embedding = (enrichment.embedding_representations ?? {}) as Wire;
      const concept = String(
        ((object.semantic_origin as Wire | undefined)?.concept as string | undefined) ??
          object.canonical_form,
      );
      return {
        objectId: String(object.object_id),
        canonicalForm: String(object.canonical_form),
        entityType: String(object.entity_type),
        definition: String(enrichment.definition ?? object.definition ?? ''),
        aliases: [
          ...strings(object.aliases),
          ...strings(terminology.synonyms),
          ...strings(terminology.aliases),
          ...strings(terminology.industry_terms),
        ],
        taxonomyVocabulary: [
          ...strings(taxonomy.object_family),
          ...strings(taxonomy.subcategory_hints),
          ...strings(taxonomy.category_hints),
          ...strings(taxonomy.taxonomy_vocabulary),
        ],
        taxonomyEmbeddingText:
          typeof embedding.taxonomy_embedding_text === 'string' &&
          embedding.taxonomy_embedding_text.length > 0
            ? embedding.taxonomy_embedding_text
            : null,
        knownGpcCodes: priors
          .filter(
            (prior) =>
              prior.concept === concept ||
              (prior.marketConceptId !== null &&
                prior.marketConceptId ===
                  ((object.semantic_origin as Wire | undefined)?.market_concept_id ?? null)),
          )
          .map((prior) => prior.gpcCode),
      };
    });

    const retrieved =
      queries.length === 0
        ? { candidates: [] as GpcCandidate[], gpcVersion: await this.retrieval.datasetVersion() }
        : await this.retrieval.retrieve(queries, CANDIDATES_PER_OBJECT);
    // §76.2: externally supplied candidates are a hint merged into (never replacing) retrieval.
    const supplied = request.gpcCandidates
      .filter((candidate) => this.schemas.validate(GPC_CANDIDATE_SCHEMA_ID, candidate).valid)
      .map((candidate) => fromWireCandidate(candidate, retrieved.gpcVersion));
    const candidates: GpcCandidate[] = dedupe([...retrieved.candidates, ...supplied]);
    const gpcVersion = retrieved.gpcVersion;
    const evidenceIds = new Set(
      request.evidence
        .map((item) => String(item.evidence_id ?? item.evidenceId ?? ''))
        .filter((id) => id.length > 0),
    );

    let wire: Wire;
    let outcome: PromptOutcome<Wire> | null = null;

    if (applicable.length === 0) {
      wire = deterministicResponse(request, [], notApplicable, gpcVersion);
    } else {
      outcome = await this.executor.execute<Wire>({
        definition,
        sections: this.sections(request, definition, applicable, candidates, priors, gpcVersion),
        task: TASK,
        semanticValidator: (output) => validateGpcInvariants(output, applicable, candidates, evidenceIds),
        decisionSummary: (output) => summarize(output as Wire),
      });
      if (outcome.status !== 'SUCCESS') {
        const status: GpcInvocationStatus =
          outcome.status === 'PROVIDER_FAILURE'
            ? 'TEMPORARY_FAILURE'
            : outcome.status === 'SCHEMA_FAILURE'
              ? 'SCHEMA_FAILURE'
              : 'POLICY_FAILURE';
        const error = { code: outcome.error.code, message: outcome.error.message };
        const latencyMs = this.clock.now().getTime() - startedAt.getTime();
        await this.persist(
          request,
          idempotencyKey,
          csreRequestId,
          enrichmentRequestId,
          gpcVersion,
          status,
          null,
          [],
          candidates.length,
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
          promptExecutionIds: [outcome.execution.id],
          retryCount: Math.max(0, outcome.execution.providerAttempts - 1),
          error: { ...error, retryable: outcome.error.retryable },
        });
        this.logger.stageFailed({
          component: COMPONENT,
          stage: STAGE,
          input: { requestId: request.requestId },
          action: `GPC resolution failed with ${status}; returning a typed ERROR (never a manufactured code)`,
          error: new Error(error.message),
        });
        return this.envelope(request, null, { ...error, retryable: outcome.error.retryable });
      }
      // Runtime-owned stamps (§93.5–§93.6): correlation, versions, dataset identity, and the
      // sovereign level/title of the chosen code (taken from the dataset, not the model).
      wire = stamp(outcome.data, request, candidates, gpcVersion, notApplicable);
    }

    const check = this.schemas.validate(GPC_RESPONSE_SCHEMA_ID, wire);
    if (!check.valid) {
      const error = {
        code: 'GPC_POST_STAMP_SCHEMA_VIOLATION',
        message: check.errors.map((e) => `${e.path} ${e.message}`).join('; '),
      };
      const latencyMs = this.clock.now().getTime() - startedAt.getTime();
      await this.persist(
        request,
        idempotencyKey,
        csreRequestId,
        enrichmentRequestId,
        gpcVersion,
        'SCHEMA_FAILURE',
        null,
        [],
        candidates.length,
        outcome,
        latencyMs,
        error,
      );
      return this.envelope(request, null, { ...error, retryable: false });
    }

    const latencyMs = this.clock.now().getTime() - startedAt.getTime();
    const newMappings = await this.mappingRows(request, wire, candidates, csreRequestId, enrichmentRequestId);
    const summary = summarize(wire);
    const { resolution: record, mappings: saved } = await this.persist(
      request,
      idempotencyKey,
      csreRequestId,
      enrichmentRequestId,
      gpcVersion,
      'SUCCESS',
      wire,
      newMappings,
      candidates.length,
      outcome,
      latencyMs,
      null,
    );

    // §75.2: one mapping fact per object for Evidence / MKG.
    for (const mapping of saved) {
      await this.events.publish(
        correlatedEvent({
          eventId: this.ids.uuid(),
          eventType: PlatformEvents.GPCMapped,
          producer: COMPONENT,
          occurredAt: this.clock.now(),
          payload: {
            requestId: request.requestId,
            turnId: request.turnId,
            gpcResolutionId: record.id,
            gpcMappingId: mapping.id,
            objectId: mapping.objectId,
            semanticObjectId: mapping.semanticObjectId,
            concept: mapping.concept,
            marketConceptId: mapping.marketConceptId,
            state: mapping.state,
            gpcCode: mapping.gpcCode,
            gpcLevel: mapping.gpcLevel,
            gpcTitle: mapping.gpcTitle,
            mappingConfidence: mapping.mappingConfidence,
            gpcVersion: mapping.gpcVersion,
            csreRequestId,
            enrichmentRequestId,
          },
          conversationId: request.conversationId,
          turnId: request.turnId,
          runId: request.runId,
          aggregate: { type: 'GpcMapping', id: mapping.id },
        }),
      );
    }

    await this.traces.finishStep({
      requestId: request.requestId,
      status: 'SUCCESS',
      completedAt: this.clock.now(),
      decision: summary,
      outputSummary: {
        objects: summary.objects.length,
        mapped: summary.objects.filter((object) => object.state === 'MAPPED').length,
        candidates: candidates.length,
        gpc_version: gpcVersion,
        model_call: outcome !== null,
      },
      persistedRecordIds: [record.id, ...saved.map((mapping) => mapping.id)],
      promptExecutionIds: outcome === null ? [] : [outcome.execution.id],
      retryCount: outcome === null ? 0 : Math.max(0, outcome.execution.providerAttempts - 1),
      error: null,
    });
    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { requestId: request.requestId, objects: request.objects.length, candidates: candidates.length },
      action: `Resolved GPC for ${summary.objects.length} object(s): ${summary.objects.map((object) => `${object.object_id}=${object.state}${object.gpc_code ? `(${object.gpc_code})` : ''}`).join(', ')}`,
      output: summary,
      durationMs: latencyMs,
    });
    return this.envelope(request, wire, null);
  }

  private sections(
    request: GpcResolverServiceRequest,
    definition: PromptDefinition,
    objects: readonly Wire[],
    candidates: readonly GpcCandidate[],
    priors: readonly unknown[],
    gpcVersion: string,
  ): PromptSection[] {
    const enrichment = request.enrichment as Record<string, Wire>;
    const hierarchy = candidates.map((candidate) => ({
      gpc_code: candidate.gpcCode,
      for_object_id: candidate.forObjectId,
      path: [candidate.segment, candidate.family, candidate.class, candidate.brick]
        .filter((ref): ref is NonNullable<typeof ref> => ref !== null)
        .map((ref) => `${ref.title} [${ref.code}]`)
        .join(' > '),
    }));
    return [
      {
        name: 'policy',
        content: {
          request_id: request.requestId,
          resolver_version: componentVersion('GPC_RESOLVER'),
          gpc_version: gpcVersion,
          policy_version: request.resolutionPolicy.policy_version ?? 'gpc-policy-1.0',
          prompt_version: definition.version,
          schema_version: GPC_WIRE_SCHEMA_VERSION,
          reason_codes: REASON_CODES,
          resolution_policy: request.resolutionPolicy,
        },
      },
      { name: 'csre-objects', content: objects },
      { name: 'enrichment', content: objects.map((object) => enrichment[String(object.object_id)] ?? null) },
      {
        name: 'market-knowledge',
        content: { prior_validated_mappings: priors, supplied: request.marketKnowledge },
      },
      { name: 'evidence', content: request.evidence },
      { name: 'gpc-candidates', content: candidates.map(candidateToWire) },
      { name: 'gpc-hierarchy', content: hierarchy },
      { name: 'message-context', content: request.messageContext },
    ];
  }

  private async mappingRows(
    request: GpcResolverServiceRequest,
    wire: Wire,
    candidates: readonly GpcCandidate[],
    csreRequestId: string,
    enrichmentRequestId: string | null,
  ): Promise<NewGpcMapping[]> {
    const semanticObjects = await this.semantics.objectsForRequest(csreRequestId).catch(() => []);
    const profiles =
      enrichmentRequestId === null
        ? []
        : await this.enrichments.profilesForRequest(enrichmentRequestId).catch(() => []);
    const inputs = new Map(request.objects.map((object) => [String(object.object_id), object]));
    return ((wire.objects as Wire[]) ?? []).map((result) => {
      const objectId = String(result.object_id);
      return {
        objectId,
        semanticObjectId: semanticObjects.find((object) => object.objectId === objectId)?.id ?? null,
        enrichmentProfileId: profiles.find((profile) => profile.objectId === objectId)?.id ?? null,
        entityType: String(inputs.get(objectId)?.entity_type ?? ''),
        candidateCodes: candidates
          .filter((candidate) => candidate.forObjectId === objectId)
          .map((candidate) => candidate.gpcCode),
        mapping: result,
      };
    });
  }

  private async persist(
    request: GpcResolverServiceRequest,
    idempotencyKey: string,
    csreRequestId: string,
    enrichmentRequestId: string | null,
    gpcVersion: string,
    status: GpcInvocationStatus,
    wire: Wire | null,
    mappings: readonly NewGpcMapping[],
    candidateCount: number,
    outcome: PromptOutcome<Wire> | null,
    latencyMs: number,
    error: { code: string; message: string } | null,
  ) {
    const summary = wire === null ? null : summarize(wire);
    return this.mappings.save(
      {
        requestId: request.requestId,
        idempotencyKey:
          status === 'SUCCESS' ? idempotencyKey : `${idempotencyKey}:failed:${request.requestId}`,
        conversationId: request.conversationId,
        turnId: request.turnId,
        runId: request.runId,
        contextSnapshotId: request.contextSnapshotId,
        csreRequestId,
        enrichmentRequestId,
        componentVersion: componentVersion('GPC_RESOLVER'),
        promptId: GPC_PROMPT_ID,
        promptVersion: GPC_PROMPT_VERSION,
        schemaVersion: GPC_WIRE_SCHEMA_VERSION,
        policyVersion: String(request.resolutionPolicy.policy_version ?? 'gpc-policy-1.0'),
        gpcVersion,
        status,
        resolutionStatus: summary?.status ?? null,
        resolution: wire,
        objectCount: summary?.objects.length ?? 0,
        mappedCount: summary?.objects.filter((object) => object.state === 'MAPPED').length ?? 0,
        candidateCount,
        promptExecutionId: outcome?.execution.id ?? null,
        modelProvider: outcome?.execution.modelProvider ?? null,
        modelName: outcome?.execution.modelName ?? null,
        latencyMs,
        error,
      },
      mappings,
    );
  }

  private envelope(
    request: GpcResolverServiceRequest,
    wire: Readonly<Wire> | null,
    error: { code: string; message: string; retryable: boolean } | null,
  ): GpcResolverServiceResponse {
    return {
      requestId: request.requestId,
      component: 'GPC_RESOLVER',
      componentVersion: componentVersion('GPC_RESOLVER'),
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
  'Resolve the GPC mapping for every CSRE object.',
  'For each object_id: inspect the established referent, its specificity and entity type; compare the supplied candidates; evaluate definition/function/attribute compatibility; apply hierarchy constraints; penalize contradictions; choose one winner when the evidence clearly supports one, otherwise return the correct non-MAPPED state; preserve candidate diagnostics without presenting them as equal winners.',
  'Classify only against the supplied GPC candidates. Never invent a code.',
  'Return only the gpc-resolver-response-v4 JSON object.',
].join('\n');

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter((item) => item.trim().length > 0) : [];
}

function firstTrace(
  objects: readonly Readonly<Wire>[],
  field: 'csre_request_id' | 'enrichment_request_id',
): string | null {
  for (const object of objects) {
    const trace = object.source_trace as Wire | undefined;
    const value = trace?.[field];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function isNonCommercial(object: Readonly<Wire>): boolean {
  const commercial = object.commercial_interpretation as Wire | undefined;
  return commercial?.relevance === 'NON_COMMERCIAL';
}

function dedupe(candidates: readonly GpcCandidate[]): GpcCandidate[] {
  const seen = new Map<string, GpcCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.forObjectId}:${candidate.gpcCode}`;
    const existing = seen.get(key);
    if (existing === undefined) seen.set(key, candidate);
    else
      seen.set(key, {
        ...existing,
        retrievalSources: [...new Set([...existing.retrievalSources, ...candidate.retrievalSources])],
        retrievalScore: Math.max(existing.retrievalScore, candidate.retrievalScore),
      });
  }
  return [...seen.values()];
}

function fromWireCandidate(wire: Readonly<Wire>, gpcVersion: string): GpcCandidate {
  const ref = (value: unknown): GpcCandidate['segment'] => {
    const record = value as Wire | undefined;
    return record !== undefined && typeof record.code === 'string'
      ? { code: record.code, title: String(record.title ?? '') }
      : null;
  };
  return {
    gpcCode: String(wire.gpc_code),
    level: String(wire.level) as GpcCandidate['level'],
    title: String(wire.title),
    definition: (wire.definition as string | null) ?? null,
    segment: ref(wire.segment),
    family: ref(wire.family),
    class: ref(wire.class),
    brick: ref(wire.brick),
    retrievalSources: strings(wire.retrieval_sources) as GpcCandidate['retrievalSources'],
    retrievalScore: Number(wire.retrieval_score ?? 0),
    gpcVersion: String(wire.gpc_version ?? gpcVersion),
    forObjectId: String(wire.for_object_id ?? ''),
  };
}

function notApplicableResult(object: Readonly<Wire>, gpcVersion: string): Wire {
  return {
    object_id: object.object_id,
    semantic_origin: object.semantic_origin,
    source_trace: object.source_trace,
    mapping: {
      state: 'NOT_APPLICABLE',
      gpc_code: null,
      gpc_level: null,
      gpc_title: null,
      mapping_confidence: 0,
      reason_codes: ['NOT_GPC_APPLICABLE', 'ENTITY_TYPE_MISMATCH'],
      evidence_ids: [],
      gpc_version: gpcVersion,
      resolver_version: componentVersion('GPC_RESOLVER'),
    },
    diagnostic_candidates: [],
    diagnostics: {
      required_distinction: null,
      notes: [
        `${String(object.entity_type)} referents are not represented by the product taxonomy (GPC Resolver §14.1, §17)`,
      ],
    },
  };
}

function deterministicResponse(
  request: GpcResolverServiceRequest,
  results: readonly Wire[],
  notApplicable: readonly Readonly<Wire>[],
  gpcVersion: string,
): Wire {
  return {
    schema_version: GPC_WIRE_SCHEMA_VERSION,
    request_id: request.requestId,
    resolver_version: componentVersion('GPC_RESOLVER'),
    status: 'SUCCESS',
    objects: [...results, ...notApplicable.map((object) => notApplicableResult(object, gpcVersion))],
    message_level: { relationships: [], shared_context: [] },
  };
}

/** Correlation, versions and the sovereign level/title of the chosen code; NOT_APPLICABLE objects appended. */
function stamp(
  wire: Readonly<Wire>,
  request: GpcResolverServiceRequest,
  candidates: readonly GpcCandidate[],
  gpcVersion: string,
  notApplicable: readonly Readonly<Wire>[],
): Wire {
  const resolverVersion = componentVersion('GPC_RESOLVER');
  const byKey = new Map(
    candidates.map((candidate) => [`${candidate.forObjectId}:${candidate.gpcCode}`, candidate]),
  );
  const objects: Wire[] = ((wire.objects as Wire[]) ?? []).map((result): Wire => {
    const mapping = (result.mapping ?? {}) as Wire;
    const candidate =
      mapping.state === 'MAPPED' && typeof mapping.gpc_code === 'string'
        ? byKey.get(`${String(result.object_id)}:${mapping.gpc_code}`)
        : undefined;
    return {
      ...result,
      mapping: {
        ...mapping,
        ...(candidate !== undefined ? { gpc_level: candidate.level, gpc_title: candidate.title } : {}),
        gpc_version: gpcVersion,
        resolver_version: resolverVersion,
      },
    };
  });
  const order = new Map(request.objects.map((object, index) => [String(object.object_id), index]));
  const all = [...objects, ...notApplicable.map((object) => notApplicableResult(object, gpcVersion))].sort(
    (a, b) => (order.get(String(a.object_id)) ?? 0) - (order.get(String(b.object_id)) ?? 0),
  );
  return {
    ...wire,
    schema_version: GPC_WIRE_SCHEMA_VERSION,
    request_id: request.requestId,
    resolver_version: resolverVersion,
    objects: all,
  };
}

export interface GpcSummary {
  status: string;
  objects: Array<{
    object_id: string;
    concept: string;
    state: string;
    gpc_code: string | null;
    gpc_level: string | null;
    gpc_title: string | null;
    confidence: number;
    reason_codes: string[];
    diagnostics: number;
    required_distinction: string | null;
  }>;
}

export function summarize(wire: Readonly<Wire>): GpcSummary {
  return {
    status: String(wire.status),
    objects: ((wire.objects as Wire[]) ?? []).map((object) => {
      const mapping = (object.mapping ?? {}) as Wire;
      const origin = (object.semantic_origin ?? {}) as Wire;
      const diagnostics = (object.diagnostics ?? {}) as Wire;
      return {
        object_id: String(object.object_id),
        concept: String(origin.concept ?? ''),
        state: String(mapping.state),
        gpc_code: (mapping.gpc_code as string | null) ?? null,
        gpc_level: (mapping.gpc_level as string | null) ?? null,
        gpc_title: (mapping.gpc_title as string | null) ?? null,
        confidence: Number(mapping.mapping_confidence ?? 0),
        reason_codes: strings(mapping.reason_codes),
        diagnostics: ((object.diagnostic_candidates as unknown[]) ?? []).length,
        required_distinction: (diagnostics.required_distinction as string | null) ?? null,
      };
    }),
  };
}
