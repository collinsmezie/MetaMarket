import type { AppConfigService } from '../../config/app-config.service';
import type { EventPublisherPort } from '../../domain/ports/outbound/event-publisher.port';
import type { StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { FixedClock } from '../../domain/ports/outbound/system.port';
import type { EnrichmentRepositoryPort } from '../../enrichment/ports/enrichment.repository.port';
import { SchemaRegistry } from '../../platform/contracts/schema-registry';
import type { PromptExecutionRecord, TraceRecorderPort } from '../../platform/observability/trace.port';
import type {
  PromptExecutor,
  PromptInvocation,
  PromptOutcome,
} from '../../platform/prompt-runtime/prompt-executor';
import { PromptRegistry } from '../../platform/prompt-runtime/prompt-registry';
import type { SemanticResolutionRepositoryPort } from '../../semantics/ports/semantic-resolution.repository.port';
import type { GpcCandidate, GpcResolverServiceRequest } from '../domain/gpc-mapping';
import type { CandidateQuery, GpcCandidateRetrievalPort } from '../ports/gpc-candidate-retrieval.port';
import type {
  GpcMappingRecord,
  GpcMappingRepositoryPort,
  GpcResolutionRecord,
  NewGpcMapping,
  NewGpcResolutionRecord,
} from '../ports/gpc-mapping.repository.port';
import { GpcResolverService } from './gpc-resolver.service';

class InMemoryMappings implements GpcMappingRepositoryPort {
  readonly rows: GpcResolutionRecord[] = [];
  readonly mappings: Array<NewGpcMapping & { id: string }> = [];
  async save(record: NewGpcResolutionRecord, mappings: readonly NewGpcMapping[]) {
    const resolution = { ...record, id: `gr_${this.rows.length + 1}`, createdAt: new Date() };
    this.rows.push(resolution);
    const saved = mappings.map((mapping, index) => ({
      ...mapping,
      id: `gm_${this.mappings.length + index + 1}`,
    }));
    this.mappings.push(...saved);
    return {
      resolution,
      mappings: saved.map((entry): GpcMappingRecord => {
        const mapping = entry.mapping.mapping as Record<string, unknown>;
        return {
          id: entry.id,
          resolutionId: resolution.id,
          requestId: record.requestId,
          csreRequestId: record.csreRequestId,
          enrichmentRequestId: record.enrichmentRequestId,
          semanticObjectId: entry.semanticObjectId,
          enrichmentProfileId: entry.enrichmentProfileId,
          conversationId: record.conversationId,
          turnId: record.turnId,
          objectId: entry.objectId,
          concept: '',
          marketConceptId: null,
          entityType: entry.entityType,
          state: String(mapping.state),
          gpcCode: (mapping.gpc_code as string | null) ?? null,
          gpcLevel: (mapping.gpc_level as string | null) ?? null,
          gpcTitle: (mapping.gpc_title as string | null) ?? null,
          mappingConfidence: Number(mapping.mapping_confidence ?? 0),
          reasonCodes: [],
          gpcVersion: String(mapping.gpc_version),
          resolverVersion: String(mapping.resolver_version),
          candidateCodes: entry.candidateCodes,
          mapping: entry.mapping,
          createdAt: new Date(),
        };
      }),
    };
  }
  async findByIdempotencyKey(key: string) {
    return this.rows.find((row) => row.idempotencyKey === key) ?? null;
  }
  async findByRequestId(requestId: string) {
    return this.rows.find((row) => row.requestId === requestId) ?? null;
  }
  async mappingsForRequest() {
    return [];
  }
  async latestMappingsForObjects() {
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
  requestId: 'req_gpc',
  parentRequestId: null,
  correlationId: 'corr',
  conversationId: 'c1',
  turnId: 't1',
  runId: 'turn:t1',
  component: 'GPC_RESOLVER',
  componentVersion: '4.4',
  promptId: 'gpc.runtime.resolve',
  promptVersion: '4.4.1',
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

const origin = (phrase: string, concept: string) => ({
  phrase,
  concept,
  market_concept_id: null,
  concept_status: 'PROPOSED',
  relationship: 'EXPRESSES',
  origin: 'CSRE',
  request_id: 'req_csre',
  semantic_confidence: 0.95,
});
const trace = {
  csre_request_id: 'req_csre',
  enrichment_request_id: 'req_enr',
  wrs_evidence_ids: [],
  evidence_system_ids: [],
};
const object = (id: string, surface: string, canonical: string, entityType: string) => ({
  object_id: id,
  semantic_origin: origin(surface, canonical),
  source_trace: trace,
  surface_form: surface,
  canonical_form: canonical,
  entity_type: entityType,
  definition: '',
  brand: null,
  model: null,
  attributes: {},
  aliases: [],
  commercial_interpretation: {
    relevance: entityType === 'SERVICE' ? 'DIRECT_SERVICE' : 'DIRECT_PRODUCT',
    commercial_offering: true,
    reason: '',
    confidence: 0.9,
  },
  relationships: [],
});

const candidate = (
  forObjectId: string,
  gpcCode: string,
  level: GpcCandidate['level'],
  title: string,
): GpcCandidate => ({
  gpcCode,
  level,
  title,
  definition: 'def',
  segment: { code: '80000000', title: 'Tools/Equipment - Hand' },
  family: { code: '80010000', title: 'Hand Tools' },
  class: { code: '80011600', title: 'Hammers/Mallets/Hatchets/Anvils' },
  brick: level === 'BRICK' ? { code: gpcCode, title } : null,
  retrievalSources: ['VECTOR', 'EXACT'],
  retrievalScore: 0.8,
  gpcVersion: 'gs1-gpc:test',
  forObjectId,
});

const request: GpcResolverServiceRequest = {
  schemaVersion: '4.0',
  requestId: 'req_gpc',
  resolverVersion: '4.4',
  conversationId: 'c1',
  turnId: 't1',
  runId: 'turn:t1',
  contextSnapshotId: 'snap',
  objects: [
    object('object_1', 'hammer', 'hammer', 'TOOL'),
    object('object_2', 'plumber', 'plumbing service', 'SERVICE'),
  ],
  messageContext: {},
  enrichment: {},
  marketKnowledge: [],
  evidence: [],
  gpcCandidates: [],
  resolutionPolicy: { policy_version: 'gpc-policy-1.0' },
};

const modelResponse = (gpcCode: string, level: string, title: string) => ({
  schema_version: 'model-guess',
  request_id: 'model-guess',
  resolver_version: 'model-guess',
  status: 'SUCCESS',
  objects: [
    {
      object_id: 'object_1',
      semantic_origin: origin('hammer', 'hammer'),
      source_trace: trace,
      mapping: {
        state: 'MAPPED',
        gpc_code: gpcCode,
        gpc_level: level,
        gpc_title: title,
        mapping_confidence: 0.9,
        reason_codes: ['STRONG_DEFINITION_MATCH'],
        evidence_ids: [],
        gpc_version: 'model-guess',
        resolver_version: 'model-guess',
      },
      diagnostic_candidates: [],
      diagnostics: { required_distinction: null, notes: [] },
    },
  ],
  message_level: { relationships: [], shared_context: [] },
});

function build(outcomes: Array<PromptOutcome<Record<string, unknown>>>, candidates: GpcCandidate[]) {
  const mappings = new InMemoryMappings();
  const executor = new FakeExecutor(outcomes);
  const events: unknown[] = [];
  const retrievalQueries: CandidateQuery[][] = [];
  const retrieval: GpcCandidateRetrievalPort = {
    retrieve: async (queries) => {
      retrievalQueries.push([...queries]);
      return { candidates, gpcVersion: 'gs1-gpc:test' };
    },
    datasetVersion: async () => 'gs1-gpc:test',
  };
  const traces: TraceRecorderPort = {
    startRun: async () => {},
    completeRun: async () => {},
    startStep: async () => {},
    finishStep: async () => {},
    recordPromptExecution: async () => {},
  };
  const logger: StageLoggerPort = { stage: () => {}, stageFailed: () => {}, withCorrelation: () => logger };
  const service = new GpcResolverService(
    mappings,
    retrieval,
    { priorMappings: async () => [] },
    {
      objectsForRequest: async () => [{ objectId: 'object_1', id: 'so_1' }],
    } as unknown as SemanticResolutionRepositoryPort,
    {
      profilesForRequest: async () => [{ objectId: 'object_1', id: 'ep_1' }],
    } as unknown as EnrichmentRepositoryPort,
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
  return { service, mappings, executor, events, retrievalQueries };
}

describe('GpcResolverService', () => {
  const hammerCandidates = [
    candidate('object_1', '10003500', 'BRICK', 'Hammers (DIY) (Non Powered)'),
    candidate('object_1', '80011600', 'CLASS', 'Hammers/Mallets/Hatchets/Anvils'),
  ];

  it('retrieves only for classifiable objects, stamps dataset/versions and sovereign level/title, and emits a mapping fact per object', async () => {
    const { service, mappings, events, executor, retrievalQueries } = build(
      [
        {
          status: 'SUCCESS',
          data: modelResponse('10003500', 'CLASS', 'wrong title'),
          execution: execution('SUCCESS'),
        },
      ],
      hammerCandidates,
    );
    const response = await service.resolve(request);
    expect(response.status).toBe('SUCCESS');
    const wire = response.resolution!;
    expect(wire.schema_version).toBe('4.0');
    expect(wire.request_id).toBe('req_gpc');
    expect(wire.resolver_version).toBe('4.4');
    const objects = wire.objects as Array<Record<string, unknown>>;
    expect(objects.map((o) => o.object_id)).toEqual(['object_1', 'object_2']);
    const hammer = objects[0]!.mapping as Record<string, unknown>;
    // The sovereign dataset, not the model, owns level and title for the chosen code.
    expect(hammer).toMatchObject({
      state: 'MAPPED',
      gpc_code: '10003500',
      gpc_level: 'BRICK',
      gpc_title: 'Hammers (DIY) (Non Powered)',
      gpc_version: 'gs1-gpc:test',
      resolver_version: '4.4',
    });
    const plumber = objects[1]!.mapping as Record<string, unknown>;
    expect(plumber).toMatchObject({
      state: 'NOT_APPLICABLE',
      gpc_code: null,
      gpc_level: null,
      gpc_title: null,
    });
    // The service never asked retrieval or the model about the service object.
    expect(retrievalQueries[0]!.map((q) => q.objectId)).toEqual(['object_1']);
    expect(
      (executor.invocations[0]!.sections.find((s) => s.name === 'csre-objects')!.content as unknown[]).length,
    ).toBe(1);
    expect(
      mappings.mappings.map((m) => [
        m.objectId,
        m.semanticObjectId,
        m.enrichmentProfileId,
        m.candidateCodes.length,
      ]),
    ).toEqual([
      ['object_1', 'so_1', 'ep_1', 2],
      ['object_2', null, null, 0],
    ]);
    expect(events).toHaveLength(2);
    expect((events[0] as { eventType: string }).eventType).toBe('GPCMapped');
  });

  it('answers NOT_APPLICABLE deterministically without a model call when no object is classifiable', async () => {
    const { service, executor, mappings } = build([], []);
    const response = await service.resolve({
      ...request,
      objects: [object('object_2', 'plumber', 'plumbing service', 'SERVICE')],
    });
    expect(response.status).toBe('SUCCESS');
    expect(executor.invocations).toHaveLength(0);
    expect(mappings.rows[0]!.promptExecutionId).toBeNull();
    expect(
      (
        (response.resolution!.objects as Array<Record<string, unknown>>)[0]!.mapping as Record<
          string,
          unknown
        >
      ).state,
    ).toBe('NOT_APPLICABLE');
  });

  it('rejects a foreign resolver version and is idempotent per CSRE/enrichment request', async () => {
    const { service, executor } = build(
      [
        {
          status: 'SUCCESS',
          data: modelResponse('10003500', 'BRICK', 'Hammers (DIY) (Non Powered)'),
          execution: execution('SUCCESS'),
        },
      ],
      hammerCandidates,
    );
    const foreign = await service.resolve({ ...request, resolverVersion: '4.1' });
    expect(foreign.status).toBe('ERROR');
    expect(foreign.error?.code).toBe('GPC_RESOLVER_VERSION_MISMATCH');
    const first = await service.resolve(request);
    const second = await service.resolve(request);
    expect(second.resolution).toEqual(first.resolution);
    expect(executor.invocations).toHaveLength(1);
  });

  it('never manufactures a code: a provider failure is a typed ERROR persisted as such', async () => {
    const { service, mappings, events } = build(
      [
        {
          status: 'PROVIDER_FAILURE',
          error: { code: 'LLM_ALL_PROVIDERS_FAILED', message: 'down', retryable: true },
          execution: execution('PROVIDER_FAILURE'),
        },
      ],
      hammerCandidates,
    );
    const response = await service.resolve(request);
    expect(response.status).toBe('ERROR');
    expect(mappings.rows[0]!.status).toBe('TEMPORARY_FAILURE');
    expect(mappings.mappings).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});
