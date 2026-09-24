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
import type { IDCEServiceRequest, IntentContext } from '../domain/idce-resolution';
import type {
  IntentResolutionRecord,
  IntentResolutionRepositoryPort,
  NewIntentResolutionRecord,
} from '../ports/intent-resolution.repository.port';
import { IdceService } from './idce.service';

class InMemoryResolutions implements IntentResolutionRepositoryPort {
  readonly rows: IntentResolutionRecord[] = [];
  async save(record: NewIntentResolutionRecord): Promise<IntentResolutionRecord> {
    const row = { ...record, id: `ir_${this.rows.length + 1}`, createdAt: new Date() };
    this.rows.push(row);
    return row;
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
  async priorIntentState() {
    return [];
  }
  async latestResolutionForTurn() {
    return null;
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
  requestId: 'req_1',
  parentRequestId: null,
  correlationId: 'corr',
  conversationId: 'c1',
  turnId: 't1',
  runId: 'turn:t1',
  component: 'IDCE',
  componentVersion: '1.6',
  promptId: 'idce.master.discover',
  promptVersion: '1.6.0',
  schemaId: 'x',
  schemaVersion: '1.0',
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

const wireResolution = {
  resolution_status: 'RESOLVED',
  intents: [
    {
      intent_id: 'i1',
      type: 'BUY',
      role: 'PRIMARY',
      status: 'RESOLVED',
      confidence: 0.95,
      explicitness: 'EXPLICIT',
      priority: 0.9,
      scope: { type: 'OBJECT', object_ids: ['object_1'], workflow_ids: [], conversation_scope: false },
      evidence: { explicit: true, implicit: false, context_used: false, signals: ['need'] },
      dependencies: [],
      related_intents: [],
      constraints: [
        {
          type: 'color',
          value: { hex: '#ff0000', local_name: 'red' },
          polarity: 'POSITIVE',
          source_span: 'red',
        },
      ],
      source_spans: ['I need a red generator'],
      routing_hints: ['BUYER_SEARCH_WORKFLOW'],
    },
  ],
  relations: [],
  clarification: null,
  unresolved: [],
  context_used: {
    conversation_history: false,
    active_workflows: false,
    semantic_objects: false,
    location: false,
    venue: false,
  },
  model_metadata: { prompt_version: 'model-guess', schema_version: 'model-guess' },
};

const context: IntentContext = {
  conversationId: 'c1',
  turnId: 't1',
  userId: 'u1',
  channel: 'WEB',
  recentMessages: [],
  activeWorkflows: [],
  suspendedWorkflows: [],
  semanticObjects: [],
  priorIntentState: [],
  locationContext: null,
  venueContext: null,
  userRole: 'UNKNOWN',
  interactionMetadata: { channel: 'web', assemblyReason: 'SINGLE_MESSAGE', messageCount: 1 },
};

const request: IDCEServiceRequest = {
  schemaVersion: '1.1',
  requestId: 'req_1',
  component: 'IDCE',
  componentVersion: '1.6',
  conversationId: 'c1',
  turnId: 't1',
  runId: 'turn:t1',
  contextSnapshotId: 'snap_1',
  logicalTurn: {
    conversationId: 'c1',
    turnId: 't1',
    messageIds: ['m1'],
    currentMessages: [
      {
        messageId: 'm1',
        text: 'I need a red generator',
        receivedAt: '2026-09-12T00:00:00Z',
        interactivePayload: null,
      },
    ],
    assembledText: 'I need a red generator',
    assemblyReason: 'SINGLE_MESSAGE',
    previousTurnSummary: null,
    contextSnapshot: context,
  },
  policyVersion: 'idce-policy-1.0',
};

function build(outcomes: Array<PromptOutcome<Record<string, unknown>>>) {
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
  const service = new IdceService(
    resolutions,
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

describe('IdceService', () => {
  it('returns a validated camelCase resolution, stamps authoritative versions, persists and emits', async () => {
    const { service, resolutions, events, executor } = build([
      { status: 'SUCCESS', data: wireResolution, execution: execution('SUCCESS') },
    ]);

    const response = await service.discover(request);

    expect(response.status).toBe('SUCCESS');
    expect(response.componentVersion).toBe('1.6');
    expect(response.resolution!.intents[0]!.type).toBe('BUY');
    expect(response.resolution!.intents[0]!.scope.objectIds).toEqual(['object_1']);
    // The runtime, not the model, owns the version stamps.
    expect(response.resolution!.modelMetadata).toEqual({ promptVersion: '1.6.1', schemaVersion: '1.0' });
    // Constraint values are user data; their keys are never re-cased.
    expect(response.resolution!.intents[0]!.constraints[0]!.value).toEqual({
      hex: '#ff0000',
      local_name: 'red',
    });

    expect(resolutions.rows).toHaveLength(1);
    expect(resolutions.rows[0]!.status).toBe('SUCCESS');
    expect(resolutions.rows[0]!.primaryIntentType).toBe('BUY');
    expect(resolutions.rows[0]!.idempotencyKey).toBe('idce:c1:t1:0');
    expect(events).toHaveLength(1);
    expect((events[0] as { eventType: string }).eventType).toBe('IntentResolved');

    // The prompt received the taxonomy, policy and user content as labelled DATA sections.
    const sections = executor.invocations[0]!.sections.map((section) => section.name);
    expect(sections).toEqual(
      expect.arrayContaining(['intent-taxonomy', 'policy', 'assembled-text', 'current-messages']),
    );
    expect(executor.invocations[0]!.semanticValidator).toBeDefined();
    expect(executor.invocations[0]!.definition.modelPolicy.model).toBe('gpt-4o-2024-11-20');
  });

  it('is idempotent for the same turn, snapshot and versions: no second model call', async () => {
    const { service, executor } = build([
      { status: 'SUCCESS', data: wireResolution, execution: execution('SUCCESS') },
    ]);
    const first = await service.discover(request);
    const second = await service.discover(request);
    expect(second.resolution).toEqual(first.resolution);
    expect(executor.invocations).toHaveLength(1);
  });

  it('never fabricates an intent: provider failure is a typed ERROR envelope and is persisted as such', async () => {
    const { service, resolutions } = build([
      {
        status: 'PROVIDER_FAILURE',
        error: { code: 'LLM_ALL_PROVIDERS_FAILED', message: 'circuit open', retryable: true },
        execution: execution('PROVIDER_FAILURE'),
      },
    ]);

    const response = await service.discover(request);

    expect(response.status).toBe('ERROR');
    expect(response.resolution).toBeNull();
    expect(response.error).toEqual({
      code: 'LLM_ALL_PROVIDERS_FAILED',
      message: 'circuit open',
      retryable: true,
    });
    expect(resolutions.rows[0]!.status).toBe('TEMPORARY_FAILURE');
    expect(resolutions.rows[0]!.resolution).toBeNull();
  });
});
