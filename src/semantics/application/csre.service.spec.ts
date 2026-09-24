import type { AppConfigService } from '../../config/app-config.service';
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
import type { CSREServiceRequest } from '../domain/csre-resolution';
import type { ExternalEvidenceRetrievalPort, SemanticGroundingPort } from '../ports/semantic-grounding.port';
import type {
  NewSemanticResolutionRecord,
  PersistedSemanticObject,
  SemanticResolutionRecord,
  SemanticResolutionRepositoryPort,
} from '../ports/semantic-resolution.repository.port';
import { CsreService } from './csre.service';

class InMemoryResolutions implements SemanticResolutionRepositoryPort {
  readonly rows: SemanticResolutionRecord[] = [];
  readonly objects: PersistedSemanticObject[] = [];
  async save(record: NewSemanticResolutionRecord) {
    const resolution = { ...record, id: `sr_${this.rows.length + 1}`, createdAt: new Date() };
    this.rows.push(resolution);
    const objects: PersistedSemanticObject[] =
      record.status !== 'SUCCESS' || record.resolution === null
        ? []
        : ((record.resolution.objects as Array<Record<string, unknown>>) ?? []).map((object, index) => ({
            id: `so_${this.objects.length + index + 1}`,
            resolutionId: resolution.id,
            requestId: record.requestId,
            conversationId: record.conversationId,
            turnId: record.turnId,
            objectId: String(object.object_id),
            surfaceForm: String(object.surface_form),
            canonicalForm: String(object.canonical_form),
            entityType: String(object.entity_type),
            brand: null,
            model: null,
            semanticOrigin: object.semantic_origin as PersistedSemanticObject['semanticOrigin'],
            commercialRelevance: 'DIRECT_PRODUCT',
            commercialOffering: true,
            semanticConfidence: 0.9,
            commercialConfidence: 0.9,
            ambiguityPresent: false,
            object,
            createdAt: new Date(),
          }));
    this.objects.push(...objects);
    return { resolution, objects };
  }
  async findByIdempotencyKey(key: string) {
    return this.rows.find((row) => row.idempotencyKey === key) ?? null;
  }
  async findByRequestId(requestId: string) {
    return this.rows.find((row) => row.requestId === requestId) ?? null;
  }
  async findByTurnId(turnId: string) {
    return this.rows.filter((row) => row.turnId === turnId);
  }
  async objectsForRequest(requestId: string) {
    return this.objects.filter((object) => object.requestId === requestId);
  }
  async recentObjects() {
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

const execution = (status: PromptExecutionRecord['status'], id = 'pe_1'): PromptExecutionRecord => ({
  id,
  requestId: 'req_1',
  parentRequestId: null,
  correlationId: 'corr',
  conversationId: 'c1',
  turnId: 't1',
  runId: 'turn:t1',
  component: 'CSRE',
  componentVersion: '5.4',
  promptId: 'csre.runtime.resolve',
  promptVersion: '5.4.3',
  schemaId: 'x',
  schemaVersion: '5.0',
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

const wireObject = (id: string, surface: string, canonical: string, semantic: number, ambiguous = false) => ({
  object_id: id,
  semantic_origin: {
    phrase: surface,
    concept: canonical,
    market_concept_id: null,
    concept_status: 'PROPOSED',
    relationship: 'EXPRESSES',
    origin: 'CSRE',
    request_id: 'model-guess',
    semantic_confidence: 0.1,
  },
  surface_form: surface,
  canonical_form: canonical,
  entity_type: 'PRODUCT',
  definition: `${canonical} definition`,
  brand: null,
  model: null,
  attributes: { color: 'red', capacity_litres: 20 },
  aliases: [],
  commercial_interpretation: {
    relevance: 'DIRECT_PRODUCT',
    commercial_offering: true,
    reason: 'sold in hardware',
    confidence: 0.9,
  },
  confidence: { semantic_resolution: semantic, commercial_relevance: 0.9 },
  ambiguity: {
    present: ambiguous,
    remaining_candidates: ambiguous
      ? [{ meaning: 'voltage stabilizer', entity_type: 'PRODUCT', definition: '', plausibility: 0.5 }]
      : [],
  },
  functional_context: ['roofing'],
  relationships: [],
});

const wireResolution = (objects: unknown[], status: string) => ({
  schema_version: 'model-guess',
  request_id: 'model-guess',
  resolution_status: status,
  original_message: 'model paraphrase',
  objects,
  context: {
    venues: [{ expression: 'hardware store', canonical_venue: 'hardware store', venue_type: 'RETAIL_VENUE' }],
    regional_context: {
      country: 'Nigeria',
      region: null,
      regional_terms: [],
      regional_interpretation_used: false,
    },
    functional_context: ['roofing'],
    location_context: null,
    qualifiers: [],
  },
  clarification: { required: false, question: null },
  evidence: [],
});

const request: CSREServiceRequest = {
  schemaVersion: '5.1',
  requestId: 'req_1',
  component: 'CSRE',
  componentVersion: '5.4',
  conversationId: 'c1',
  turnId: 't1',
  runId: 'turn:t1',
  contextSnapshotId: 'snap_1',
  message: 'I need a hammer and nails for roofing from a hardware store',
  currentMessages: [
    {
      messageId: 'm1',
      text: 'I need a hammer and nails for roofing from a hardware store',
      receivedAt: '2026-09-12T00:00:00Z',
      interactivePayload: null,
    },
  ],
  conversationContext: { recent_messages: [] },
  regionalContext: { country: 'Nigeria', locations: [{ value: 'Warri' }] },
  commercialContext: { user_role: 'BUYER' },
  lexiconEvidence: [],
  externalEvidence: [],
  clarificationAnswers: [],
  policyVersion: 'csre-policy-1.0',
};

function build(
  outcomes: Array<PromptOutcome<Record<string, unknown>>>,
  evidence: ExternalEvidenceRetrievalPort = { available: () => false, retrieve: async () => [] },
) {
  const resolutions = new InMemoryResolutions();
  const executor = new FakeExecutor(outcomes);
  const events: unknown[] = [];
  const steps: unknown[] = [];
  const traces: TraceRecorderPort = {
    startRun: async () => {},
    completeRun: async () => {},
    startStep: async (step) => void steps.push(step),
    finishStep: async (step) => void steps.push(step),
    recordPromptExecution: async () => {},
  };
  const logger: StageLoggerPort = { stage: () => {}, stageFailed: () => {}, withCorrelation: () => logger };
  const grounding: SemanticGroundingPort = { knownConcepts: async () => [], lexiconEvidence: async () => [] };
  const service = new CsreService(
    resolutions,
    grounding,
    evidence,
    traces,
    { publish: async (event) => void events.push(event), publishAll: async () => {} } as EventPublisherPort,
    logger,
    new FixedClock(new Date('2026-09-12T00:00:00Z')),
    { uuid: () => 'evt_1', prefixed: (p: string) => `${p}_1` },
    new PromptRegistry(),
    new SchemaRegistry(),
    executor as unknown as PromptExecutor,
    { specialistModel: 'gpt-4o-2024-11-20' } as AppConfigService,
  );
  return { service, resolutions, executor, events, steps };
}

describe('CsreService', () => {
  it('stamps correlation authoritatively, keeps user attribute keys, persists objects and emits one observation per object', async () => {
    const composite = wireResolution(
      [wireObject('object_1', 'hammer', 'hammer', 0.95), wireObject('object_2', 'nails', 'nails', 0.9)],
      'COMPOSITE',
    );
    const { service, resolutions, events, executor } = build([
      { status: 'SUCCESS', data: composite, execution: execution('SUCCESS') },
    ]);

    const response = await service.resolve(request);

    expect(response.status).toBe('SUCCESS');
    expect(response.componentVersion).toBe('5.4');
    const wire = response.resolution!;
    // Runtime-owned fields (§27.1, §29.3) override whatever the model copied.
    expect(wire.schema_version).toBe('5.0');
    expect(wire.request_id).toBe('req_1');
    expect(wire.original_message).toBe(request.message);
    const objects = wire.objects as Array<Record<string, unknown>>;
    const origin = objects[0]!.semantic_origin as Record<string, unknown>;
    expect(origin.request_id).toBe('req_1');
    expect(origin.origin).toBe('CSRE');
    expect(origin.relationship).toBe('EXPRESSES');
    // Origin confidence is derived from the object's semantic confidence, not a second guess.
    expect(origin.semantic_confidence).toBe(0.95);
    expect(objects[1]!.attributes).toEqual({ color: 'red', capacity_litres: 20 });

    expect(resolutions.rows).toHaveLength(1);
    expect(resolutions.rows[0]!.idempotencyKey).toBe('csre:c1:t1:0');
    expect(resolutions.rows[0]!.canonicalForms).toEqual(['hammer', 'nails']);
    expect(resolutions.objects).toHaveLength(2);
    expect(events).toHaveLength(2);
    expect((events[0] as { eventType: string }).eventType).toBe('SemanticObjectResolved');

    const sections = executor.invocations[0]!.sections.map((section) => section.name);
    expect(sections).toEqual(
      expect.arrayContaining([
        'policy',
        'vocabulary',
        'user-message',
        'known-market-concepts',
        'external-evidence',
      ]),
    );
    expect(executor.invocations[0]!.semanticValidator).toBeDefined();
    expect(executor.invocations[0]!.definition.modelPolicy.model).toBe('gpt-4o-2024-11-20');
  });

  it('is idempotent for the same turn, snapshot and versions', async () => {
    const { service, executor } = build([
      {
        status: 'SUCCESS',
        data: wireResolution([wireObject('object_1', 'hammer', 'hammer', 0.95)], 'RESOLVED'),
        execution: execution('SUCCESS'),
      },
    ]);
    const first = await service.resolve(request);
    const second = await service.resolve(request);
    expect(second.resolution).toEqual(first.resolution);
    expect(executor.invocations).toHaveLength(1);
  });

  it('never fabricates an object: provider failure is a typed ERROR and persisted as such', async () => {
    const { service, resolutions, events } = build([
      {
        status: 'PROVIDER_FAILURE',
        error: { code: 'LLM_ALL_PROVIDERS_FAILED', message: 'circuit open', retryable: true },
        execution: execution('PROVIDER_FAILURE'),
      },
    ]);
    const response = await service.resolve(request);
    expect(response.status).toBe('ERROR');
    expect(response.resolution).toBeNull();
    expect(response.error?.code).toBe('LLM_ALL_PROVIDERS_FAILED');
    expect(resolutions.rows[0]!.status).toBe('TEMPORARY_FAILURE');
    expect(resolutions.objects).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('skips the evidence path while WRS is unbound, and takes it once for material ambiguity when bound', async () => {
    const ambiguous = wireResolution(
      [wireObject('object_1', 'stabilizer', 'stabilizer', 0.4, true)],
      'AMBIGUOUS',
    );
    const resolved = wireResolution(
      [wireObject('object_1', 'stabilizer', 'voltage stabilizer', 0.9)],
      'RESOLVED',
    );

    const unbound = build([{ status: 'SUCCESS', data: ambiguous, execution: execution('SUCCESS') }]);
    await unbound.service.resolve({ ...request, message: 'stabilizer' });
    expect(unbound.executor.invocations).toHaveLength(1);

    const retrieved: string[] = [];
    const bound = build(
      [
        { status: 'SUCCESS', data: ambiguous, execution: execution('SUCCESS', 'pe_1') },
        { status: 'SUCCESS', data: resolved, execution: execution('SUCCESS', 'pe_2') },
      ],
      {
        available: () => true,
        retrieve: async (query) => {
          retrieved.push(...query.expressions.map((e) => e.surfaceForm));
          return [
            {
              evidenceId: 'ev_1',
              source: 'https://example.ng',
              sourceType: 'RETAILER',
              claim: 'In Nigerian retail "stabilizer" denotes an automatic voltage regulator',
              supportsInterpretation: 'voltage stabilizer',
              contradictsInterpretation: null,
              geographicRelevance: 'NG',
              reliability: 0.8,
            },
          ];
        },
      },
    );
    const response = await bound.service.resolve({ ...request, message: 'stabilizer' });
    expect(retrieved).toEqual(['stabilizer']);
    expect(bound.executor.invocations).toHaveLength(2);
    const evidenceSection = bound.executor.invocations[1]!.sections.find(
      (s) => s.name === 'external-evidence',
    );
    expect((evidenceSection!.content as unknown[]).length).toBe(1);
    expect(response.resolution!.resolution_status).toBe('RESOLVED');
    const step = bound.steps[1] as {
      promptExecutionIds: string[];
      outputSummary: { evidence_pass: boolean };
    };
    expect(step.promptExecutionIds).toEqual(['pe_1', 'pe_2']);
    expect(step.outputSummary.evidence_pass).toBe(true);
  });
});
