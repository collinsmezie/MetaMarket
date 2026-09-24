import type { AppConfigService } from '../../config/app-config.service';
import type { EmbeddingProviderPort } from '../../domain/ports/outbound/embedding-provider.port';
import type { EventPublisherPort } from '../../domain/ports/outbound/event-publisher.port';
import type { StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { FixedClock } from '../../domain/ports/outbound/system.port';
import { SchemaRegistry } from '../../platform/contracts/schema-registry';
import type { PromptExecutionRecord, TraceRecorderPort } from '../../platform/observability/trace.port';
import type {
  PromptExecutor,
  PromptInvocation,
  PromptOutcome,
} from '../../platform/prompt-runtime/prompt-executor';
import { PromptRegistry } from '../../platform/prompt-runtime/prompt-registry';
import type { SemanticResolutionRepositoryPort } from '../../semantics/ports/semantic-resolution.repository.port';
import type { EnrichmentServiceRequest } from '../domain/enrichment-resolution';
import type {
  EnrichmentProfileRecord,
  EnrichmentRepositoryPort,
  EnrichmentResolutionRecord,
  NewEnrichmentProfile,
  NewEnrichmentResolutionRecord,
} from '../ports/enrichment.repository.port';
import { EnrichmentService } from './enrichment.service';

class InMemoryEnrichments implements EnrichmentRepositoryPort {
  readonly rows: EnrichmentResolutionRecord[] = [];
  readonly profiles: Array<NewEnrichmentProfile & { id: string }> = [];
  async save(record: NewEnrichmentResolutionRecord, profiles: readonly NewEnrichmentProfile[]) {
    const resolution = { ...record, id: `er_${this.rows.length + 1}`, createdAt: new Date() };
    this.rows.push(resolution);
    const saved = profiles.map((profile, index) => ({
      ...profile,
      id: `ep_${this.profiles.length + index + 1}`,
    }));
    this.profiles.push(...saved);
    return {
      resolution,
      profiles: saved.map((profile): EnrichmentProfileRecord => ({
        id: profile.id,
        resolutionId: resolution.id,
        requestId: record.requestId,
        sourceResolutionRequestId: record.sourceResolutionRequestId,
        semanticObjectId: profile.semanticObjectId,
        conversationId: record.conversationId,
        turnId: record.turnId,
        objectId: profile.objectId,
        canonicalForm: String(profile.profile.canonical_form),
        entityType: String(profile.profile.entity_type),
        concept: '',
        marketConceptId: null,
        conceptStatus: 'PROPOSED',
        definition: '',
        canonicalEmbeddingText: '',
        functionalEmbeddingText: '',
        taxonomyEmbeddingText: '',
        searchTerms: [],
        semanticKeywords: [],
        negativeTerms: [],
        evidenceRequired: false,
        embeddingModel: profile.embeddings?.model ?? null,
        profile: profile.profile,
        createdAt: new Date(),
      })),
    };
  }
  async findByIdempotencyKey(key: string) {
    return this.rows.find((row) => row.idempotencyKey === key) ?? null;
  }
  async findByRequestId(requestId: string) {
    return this.rows.find((row) => row.requestId === requestId) ?? null;
  }
  async profilesForRequest() {
    return [];
  }
  async latestProfilesForObjects() {
    return [];
  }
}

class FakeExecutor {
  readonly invocations: PromptInvocation[] = [];
  constructor(private readonly outcomes: Array<PromptOutcome<Record<string, unknown>>>) {}
  async execute<T>(invocation: PromptInvocation): Promise<PromptOutcome<T>> {
    this.invocations.push(invocation);
    const next = this.outcomes.shift();
    if (next === undefined) throw new Error('unexpected model call');
    return next as unknown as PromptOutcome<T>;
  }
}

const execution = (status: PromptExecutionRecord['status']): PromptExecutionRecord => ({
  id: 'pe_1',
  requestId: 'req_enr',
  parentRequestId: null,
  correlationId: 'corr',
  conversationId: 'c1',
  turnId: 't1',
  runId: 'turn:t1',
  component: 'ENRICHMENT',
  componentVersion: '4.4',
  promptId: 'enrichment.runtime.enrich',
  promptVersion: '4.4.0',
  schemaId: 'x',
  schemaVersion: '4.0',
  modelProvider: 'openai',
  modelName: 'gpt-4o',
  inputHash: 'h',
  input: {},
  output: null,
  rawOutput: null,
  status,
  validationErrors: [],
  repairAttempts: 0,
  providerAttempts: 1,
  failedProviders: [],
  latencyMs: 10,
  usage: null,
  decisionSummary: null,
  sharedInvocation: false,
  createdAt: new Date(),
});

const origin = {
  phrase: 'hammer',
  concept: 'hammer',
  market_concept_id: null,
  concept_status: 'PROPOSED',
  relationship: 'EXPRESSES',
  origin: 'CSRE',
  request_id: 'req_csre',
  semantic_confidence: 0.95,
};

const csreObject = {
  object_id: 'object_1',
  semantic_origin: origin,
  surface_form: 'hammer',
  canonical_form: 'hammer',
  entity_type: 'TOOL',
  definition: '',
  brand: null,
  model: null,
  attributes: {},
  aliases: [],
  commercial_interpretation: {
    relevance: 'DIRECT_PRODUCT',
    commercial_offering: true,
    reason: '',
    confidence: 0.9,
  },
  confidence: { semantic_resolution: 0.95, commercial_relevance: 0.9 },
  ambiguity: { present: false, remaining_candidates: [] },
  functional_context: [],
  relationships: [],
};

const wireProfile = {
  object_id: 'object_1',
  semantic_origin: origin,
  canonical_form: 'hammer',
  entity_type: 'TOOL',
  definition: 'A hand tool with a weighted head used to drive nails.',
  brand: null,
  model: null,
  variant: null,
  attributes: {},
  functional_profile: {
    primary_function: 'drive nails',
    secondary_functions: ['remove nails'],
    mechanism: 'striking',
  },
  use_cases: ['carpentry'],
  commercial_terminology: {
    synonyms: ['claw hammer'],
    aliases: [],
    informal_terms: [],
    regional_terms: [],
    industry_terms: [],
  },
  taxonomy_semantics: {
    domain_hints: ['tools'],
    category_hints: ['hand tools'],
    subcategory_hints: ['striking tools'],
    object_family: ['hammers'],
    taxonomy_vocabulary: ['hammer'],
  },
  distinguishing_features: ['striking head'],
  confusable_concepts: [{ concept: 'mallet', distinguishing_signal: 'soft head' }],
  embedding_representations: {
    canonical_embedding_text: 'hammer hand tool',
    functional_embedding_text: 'drives nails',
    taxonomy_embedding_text: 'hand tools striking tools',
    search_terms: ['hammer'],
    semantic_keywords: ['nail'],
    negative_terms: ['sledgehammer'],
  },
  evidence: [],
  confidence: { enrichment: 0.9, functional_profile: 0.9, taxonomy_semantics: 0.85 },
  evidence_required: false,
  evidence_request: null,
  resolution_concern: null,
};

const wire = {
  schema_version: 'model-guess',
  request_id: 'model-guess',
  enrichment_status: 'ENRICHED',
  source_resolution: { resolver_version: 'model-guess', resolution_request_id: 'model-guess' },
  objects: [wireProfile],
  relationships: [],
  message_context: { functional_context: [], shared_constraints: [] },
};

const request: EnrichmentServiceRequest = {
  schemaVersion: '4.1',
  requestId: 'req_enr',
  component: 'ENRICHMENT',
  componentVersion: '4.4',
  conversationId: 'c1',
  turnId: 't1',
  runId: 'turn:t1',
  contextSnapshotId: 'snap',
  sourceResolution: {
    resolver: 'CSRE',
    componentVersion: '5.4',
    wireSchemaVersion: '5.0',
    resolutionRequestId: 'req_csre',
  },
  objects: [csreObject],
  relationships: [],
  messageContext: {},
  downstreamPurpose: 'SEMANTIC_SEARCH',
  policyVersion: 'enrichment-policy-1.0',
};

function build(outcomes: Array<PromptOutcome<Record<string, unknown>>>, embedFails = false) {
  const enrichments = new InMemoryEnrichments();
  const executor = new FakeExecutor(outcomes);
  const events: unknown[] = [];
  const embedded: string[] = [];
  const traces: TraceRecorderPort = {
    startRun: async () => {},
    completeRun: async () => {},
    startStep: async () => {},
    finishStep: async () => {},
    recordPromptExecution: async () => {},
  };
  const logger: StageLoggerPort = { stage: () => {}, stageFailed: () => {}, withCorrelation: () => logger };
  const embeddings: EmbeddingProviderPort = {
    model: 'text-embedding-3-small',
    dimension: 3,
    embed: async () => [0, 0, 1],
    embedBatch: async (texts) => {
      if (embedFails) throw new Error('embedding outage');
      embedded.push(...texts);
      return texts.map((_, index) => [index, 0, 1]);
    },
  };
  const semantics = {
    objectsForRequest: async () => [{ objectId: 'object_1', id: 'so_durable_1' }],
  } as unknown as SemanticResolutionRepositoryPort;
  const service = new EnrichmentService(
    enrichments,
    semantics,
    { knowledgeFor: async () => [] },
    { available: () => false, retrieve: async () => [] },
    embeddings,
    traces,
    { publish: async (event) => void events.push(event), publishAll: async () => {} } as EventPublisherPort,
    logger,
    new FixedClock(new Date('2026-09-24T00:00:00Z')),
    { uuid: () => 'evt_1', prefixed: (p: string) => `${p}_1` },
    new PromptRegistry(),
    new SchemaRegistry(),
    executor as unknown as PromptExecutor,
    { specialistModel: 'gpt-4o-2024-11-20' } as AppConfigService,
  );
  return { service, enrichments, executor, events, embedded };
}

describe('EnrichmentService', () => {
  it('stamps correlation, keeps the CSRE identity, embeds three representations and links the durable object', async () => {
    const { service, enrichments, events, executor, embedded } = build([
      { status: 'SUCCESS', data: wire, execution: execution('SUCCESS') },
    ]);
    const response = await service.enrich(request);
    expect(response.status).toBe('SUCCESS');
    const resolution = response.resolution!;
    expect(resolution.schema_version).toBe('4.0');
    expect(resolution.request_id).toBe('req_enr');
    expect(resolution.source_resolution).toEqual({
      resolver_version: '5.4',
      resolution_request_id: 'req_csre',
    });
    expect(embedded).toEqual(['hammer hand tool', 'drives nails', 'hand tools striking tools']);
    expect(enrichments.profiles[0]).toMatchObject({ objectId: 'object_1', semanticObjectId: 'so_durable_1' });
    expect(enrichments.profiles[0]!.embeddings?.canonical).toEqual([0, 0, 1]);
    expect(enrichments.rows[0]!.idempotencyKey).toBe('enrichment:c1:t1:req_csre:SEMANTIC_SEARCH');
    expect(events).toHaveLength(1);
    expect((events[0] as { eventType: string }).eventType).toBe('EnrichmentCompleted');
    expect(executor.invocations[0]!.sections.map((section) => section.name)).toEqual(
      expect.arrayContaining([
        'policy',
        'resolver-output',
        'available-evidence',
        'knowledge-context',
        'downstream-purpose',
        'target-level',
      ]),
    );
  });

  it('rejects objects without a CSRE EXPRESSES origin before any model call (§26.1)', async () => {
    const { service, executor } = build([]);
    const foreign = { ...csreObject, semantic_origin: { ...origin, origin: 'GPC' } };
    const response = await service.enrich({ ...request, objects: [foreign] });
    expect(response.status).toBe('ERROR');
    expect(response.error?.code).toBe('ENRICHMENT_INPUT_NOT_CSRE');
    expect(executor.invocations).toHaveLength(0);
  });

  it('is idempotent per CSRE request and purpose, and stores profiles without vectors when embeddings fail', async () => {
    const { service, executor, enrichments } = build(
      [{ status: 'SUCCESS', data: wire, execution: execution('SUCCESS') }],
      true,
    );
    const first = await service.enrich(request);
    const second = await service.enrich(request);
    expect(second.resolution).toEqual(first.resolution);
    expect(executor.invocations).toHaveLength(1);
    expect(enrichments.profiles[0]!.embeddings).toBeNull();
  });

  it('never guesses a profile: a provider failure is a typed ERROR persisted as such', async () => {
    const { service, enrichments, events } = build([
      {
        status: 'PROVIDER_FAILURE',
        error: { code: 'LLM_ALL_PROVIDERS_FAILED', message: 'down', retryable: true },
        execution: execution('PROVIDER_FAILURE'),
      },
    ]);
    const response = await service.enrich(request);
    expect(response.status).toBe('ERROR');
    expect(enrichments.rows[0]!.status).toBe('TEMPORARY_FAILURE');
    expect(enrichments.profiles).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});
