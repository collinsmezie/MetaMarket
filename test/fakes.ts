import type { Artifact } from '../src/domain/models/artifact';
import type { Conversation } from '../src/domain/models/conversation';
import { EMPTY_MEMORY } from '../src/domain/models/conversation';
import type { IncomingMessage, MessagePart } from '../src/domain/models/incoming-message';
import type { ConversationRelationship, IntentResult } from '../src/domain/models/understanding';
import type {
  SemanticFingerprint,
  WorkflowInstance,
  WorkflowRegistry,
  WorkflowStatus,
} from '../src/domain/models/workflow-instance';
import { EMPTY_FINGERPRINT, EMPTY_REGISTRY } from '../src/domain/models/workflow-instance';
import type { DomainEvent, EventPublisherPort } from '../src/domain/ports/outbound/event-publisher.port';
import type { StageLog, StageLoggerPort } from '../src/domain/ports/outbound/stage-logger.port';
import type {
  CreateWorkflowInstanceInput,
  TransitionRecord,
  WorkflowMutation,
  WorkflowRepositoryPort,
  WorkflowSimilarityMatch,
} from '../src/domain/ports/outbound/workflow-repository.port';
import type { WorkflowTrigger } from '../src/domain/workflows/workflow-definition';

/**
 * Test doubles shared across unit specs.
 *
 * Hand-written rather than auto-mocked so each fake encodes the real contract — an
 * in-memory workflow repository that actually enforces the same invariants catches bugs a
 * `jest.fn()` returning undefined never would.
 */

export const FIXED_NOW = new Date('2026-08-06T10:15:00.000Z');

export function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv_1',
    userId: '+2348012345678',
    history: [],
    memory: EMPTY_MEMORY,
    workflowRegistry: EMPTY_REGISTRY,
    lastChannel: 'whatsapp',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

export function makeRegistry(
  instances: readonly WorkflowInstance[],
  activeWorkflowId: string | null = null,
): WorkflowRegistry {
  return { activeWorkflowId, workflowInstances: instances };
}

export function makeInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: 'wf_1',
    conversationId: 'conv_1',
    workflowType: 'Triage',
    currentState: 'Classify',
    status: 'active' as WorkflowStatus,
    summary: '',
    semanticFingerprint: EMPTY_FINGERPRINT,
    importantEntities: {},
    data: {},
    priority: 0,
    resumable: true,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    expiresAt: null,
    ...overrides,
  };
}

export function makeFingerprint(overrides: Partial<SemanticFingerprint> = {}): SemanticFingerprint {
  return { intent: 'buyer_product_search', entities: [], keywords: [], ...overrides };
}

export function makeIntent(overrides: Partial<IntentResult> = {}): IntentResult {
  return {
    intent: 'buyer_product_search',
    confidence: 0.95,
    entities: {},
    language: 'en',
    ...overrides,
  };
}

export function makeRelationship(
  overrides: Partial<ConversationRelationship> = {},
): ConversationRelationship {
  return { relationship: 'new', confidence: 1, candidateWorkflowIds: [], ...overrides };
}

export function makeMessage(
  parts: readonly MessagePart[],
  overrides: Partial<IncomingMessage> = {},
): IncomingMessage {
  return {
    id: 'msg_1',
    conversationId: 'conv_1',
    userId: '+2348012345678',
    channel: 'whatsapp',
    timestamp: FIXED_NOW,
    parts,
    metadata: {},
    ...overrides,
  };
}

export function makeTrigger(overrides: Partial<WorkflowTrigger> = {}): WorkflowTrigger {
  return {
    conversation: makeConversation(),
    recentHistory: [],
    artifacts: [] as readonly Artifact[],
    text: 'I need a hammer',
    relationship: makeRelationship(),
    intent: makeIntent(),
    semanticRequest: null,
    interactivePayload: null,
    now: FIXED_NOW,
    ...overrides,
  };
}

/** Collects stage logs so tests can assert on the observability trace a turn produced. */
export class RecordingStageLogger implements StageLoggerPort {
  readonly logs: StageLog[] = [];
  readonly failures: (Omit<StageLog, 'output'> & { error: unknown })[] = [];

  stage(log: StageLog): void {
    this.logs.push(log);
  }

  stageFailed(log: Omit<StageLog, 'output'> & { error: unknown }): void {
    this.failures.push(log);
  }

  withCorrelation(): StageLoggerPort {
    return this;
  }

  stageNames(): string[] {
    return this.logs.map((log) => log.stage);
  }
}

export class RecordingEventPublisher implements EventPublisherPort {
  readonly events: DomainEvent[] = [];

  async publish<T>(event: DomainEvent<T>): Promise<void> {
    this.events.push(event as DomainEvent);
  }

  async publishAll(events: readonly DomainEvent[]): Promise<void> {
    this.events.push(...events);
  }

  types(): string[] {
    return this.events.map((event) => event.eventType);
  }
}

/**
 * In-memory workflow repository that enforces the same invariants as the Prisma adapter:
 * updates must target an existing instance, and transitions are recorded alongside them.
 */
export class InMemoryWorkflowRepository implements WorkflowRepositoryPort {
  private readonly instances = new Map<string, WorkflowInstance>();
  private readonly activeByConversation = new Map<string, string | null>();
  readonly transitions: TransitionRecord[] = [];
  similarityResults: readonly WorkflowSimilarityMatch[] = [];

  seed(instance: WorkflowInstance): WorkflowInstance {
    this.instances.set(instance.id, instance);
    return instance;
  }

  async create(input: CreateWorkflowInstanceInput): Promise<WorkflowInstance> {
    const instance: WorkflowInstance = {
      id: input.id,
      conversationId: input.conversationId,
      workflowType: input.workflowType,
      currentState: input.initialState,
      status: 'active',
      summary: input.summary,
      semanticFingerprint: input.semanticFingerprint,
      importantEntities: input.importantEntities,
      data: input.data,
      priority: input.priority,
      resumable: input.resumable,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      expiresAt: input.expiresAt,
    };

    this.instances.set(instance.id, instance);
    return instance;
  }

  async findById(workflowId: string): Promise<WorkflowInstance | null> {
    return this.instances.get(workflowId) ?? null;
  }

  async loadRegistry(conversationId: string): Promise<WorkflowRegistry> {
    return {
      activeWorkflowId: this.activeByConversation.get(conversationId) ?? null,
      workflowInstances: [...this.instances.values()].filter(
        (instance) => instance.conversationId === conversationId,
      ),
    };
  }

  async update(
    workflowId: string,
    mutation: WorkflowMutation,
    transition?: TransitionRecord,
  ): Promise<WorkflowInstance> {
    const existing = this.instances.get(workflowId);
    if (existing === undefined) throw new Error(`No workflow instance ${workflowId}`);

    const updated: WorkflowInstance = {
      ...existing,
      ...(mutation.currentState !== undefined ? { currentState: mutation.currentState } : {}),
      ...(mutation.status !== undefined ? { status: mutation.status } : {}),
      ...(mutation.summary !== undefined ? { summary: mutation.summary } : {}),
      ...(mutation.semanticFingerprint !== undefined
        ? { semanticFingerprint: mutation.semanticFingerprint }
        : {}),
      ...(mutation.importantEntities !== undefined ? { importantEntities: mutation.importantEntities } : {}),
      ...(mutation.data !== undefined ? { data: mutation.data } : {}),
      ...(mutation.expiresAt !== undefined ? { expiresAt: mutation.expiresAt } : {}),
      updatedAt: FIXED_NOW,
    };

    this.instances.set(workflowId, updated);
    if (transition !== undefined) this.transitions.push(transition);

    return updated;
  }

  async setActiveWorkflow(conversationId: string, workflowId: string | null): Promise<void> {
    this.activeByConversation.set(conversationId, workflowId);
  }

  activeWorkflowFor(conversationId: string): string | null {
    return this.activeByConversation.get(conversationId) ?? null;
  }

  async listByStatus(conversationId: string, status: WorkflowStatus): Promise<readonly WorkflowInstance[]> {
    return [...this.instances.values()].filter(
      (instance) => instance.conversationId === conversationId && instance.status === status,
    );
  }

  async findByImportantEntity(
    conversationId: string,
    key: string,
    value: string,
  ): Promise<readonly WorkflowInstance[]> {
    return [...this.instances.values()].filter(
      (instance) => instance.conversationId === conversationId && instance.importantEntities[key] === value,
    );
  }

  async findSimilarByEmbedding(): Promise<readonly WorkflowSimilarityMatch[]> {
    return this.similarityResults;
  }

  async findExpired(now: Date, limit: number): Promise<readonly WorkflowInstance[]> {
    return [...this.instances.values()]
      .filter(
        (instance) =>
          (instance.status === 'active' || instance.status === 'suspended') &&
          instance.expiresAt !== null &&
          instance.expiresAt.getTime() <= now.getTime(),
      )
      .slice(0, limit);
  }

  async transitionHistory(workflowId: string): Promise<readonly TransitionRecord[]> {
    return this.transitions.filter((transition) => transition.workflowId === workflowId);
  }
}

/** Deterministic ids so assertions can name the workflow a test expects to be created. */
export class SequentialIdGenerator {
  private counter = 0;

  uuid(): string {
    this.counter += 1;
    return `00000000-0000-4000-8000-${this.counter.toString().padStart(12, '0')}`;
  }

  prefixed(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter}`;
  }
}

export class FrozenClock {
  constructor(private current: Date = FIXED_NOW) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
