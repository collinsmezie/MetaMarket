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
import type { Channel } from '../src/domain/models/channel';
import type { Wallet, WalletDebitResult } from '../src/domain/models/credit';
import type { OutboundMessage } from '../src/domain/models/outbound-message';
import type { Response } from '../src/domain/models/response';
import type {
  EnqueuedOutboundMessage,
  OutboundMessageRepositoryPort,
} from '../src/domain/ports/outbound/outbound-message-repository.port';
import type { DomainEvent, EventPublisherPort } from '../src/domain/ports/outbound/event-publisher.port';
import type { StageLog, StageLoggerPort } from '../src/domain/ports/outbound/stage-logger.port';
import type {
  CreateWorkflowInstanceInput,
  TransitionRecord,
  WorkflowMutation,
  WorkflowRepositoryPort,
  WorkflowSimilarityMatch,
} from '../src/domain/ports/outbound/workflow-repository.port';
import type { WalletRepositoryPort } from '../src/domain/ports/outbound/wallet-repository.port';
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

/**
 * An in-memory credit wallet that enforces the real invariants (Konnet Credits Recharge TDR §18,
 * §25.5).
 *
 * Worth writing by hand rather than stubbing: the guarantees under test are "never negative",
 * "exactly once per reference" and "a create that loses a race adopts the winner". A fake that
 * returned canned outcomes would let a caller that violates all three still pass.
 */
export class InMemoryWalletRepository implements WalletRepositoryPort {
  readonly wallets = new Map<string, Wallet>();
  /** Ledger keyed by providerReference — the unique index, which is the whole guarantee. */
  readonly ledger = new Map<string, { walletId: string; type: 'credit' | 'debit'; credits: number }>();

  constructor(seed: readonly Wallet[] = []) {
    for (const wallet of seed) this.wallets.set(wallet.id, wallet);
  }

  /** Convenience for tests: a funded wallet for a user. */
  fund(userId: string, balanceCredits: number, conversationId = 'conv_1'): Wallet {
    const wallet: Wallet = {
      id: `wallet_${this.wallets.size + 1}`,
      userId,
      conversationId,
      currency: 'NGN',
      balanceCredits,
      providerCustomerCode: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    };
    this.wallets.set(wallet.id, wallet);
    return wallet;
  }

  async findById(id: string): Promise<Wallet | null> {
    return this.wallets.get(id) ?? null;
  }

  async findByUserId(userId: string): Promise<Wallet | null> {
    return [...this.wallets.values()].find((wallet) => wallet.userId === userId) ?? null;
  }

  async create(params: { id: string; userId: string; conversationId: string }): Promise<Wallet> {
    const existing = await this.findByUserId(params.userId);
    if (existing !== null) return existing;

    const wallet: Wallet = {
      id: params.id,
      userId: params.userId,
      conversationId: params.conversationId,
      currency: 'NGN',
      balanceCredits: 0,
      providerCustomerCode: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    };
    this.wallets.set(wallet.id, wallet);
    return wallet;
  }

  async updateProviderCustomerCode(walletId: string, customerCode: string): Promise<Wallet> {
    const wallet = { ...(this.wallets.get(walletId) as Wallet), providerCustomerCode: customerCode };
    this.wallets.set(walletId, wallet);
    return wallet;
  }

  async creditAtomically(params: {
    transactionId: string;
    walletId: string;
    amountCredits: number;
    providerReference: string | null;
    eventId: string | null;
  }): Promise<{ outcome: 'credited'; balanceAfter: number } | { outcome: 'duplicate' }> {
    const key = params.providerReference ?? params.eventId ?? params.transactionId;
    if (this.ledger.has(key)) return { outcome: 'duplicate' };

    this.ledger.set(key, { walletId: params.walletId, type: 'credit', credits: params.amountCredits });
    return { outcome: 'credited', balanceAfter: this.move(params.walletId, params.amountCredits) };
  }

  async debitAtomically(params: {
    transactionId: string;
    walletId: string;
    amountCredits: number;
    providerReference: string;
  }): Promise<WalletDebitResult> {
    if (this.ledger.has(params.providerReference)) return { outcome: 'duplicate' };

    const balance = this.wallets.get(params.walletId)?.balanceCredits ?? 0;
    if (balance < params.amountCredits) return { outcome: 'insufficient', balance };

    this.ledger.set(params.providerReference, {
      walletId: params.walletId,
      type: 'debit',
      credits: params.amountCredits,
    });

    return { outcome: 'debited', balanceAfter: this.move(params.walletId, -params.amountCredits) };
  }

  async grantAtomically(params: {
    transactionId: string;
    walletId: string;
    amountCredits: number;
    providerReference: string;
  }): Promise<{ outcome: 'credited'; balanceAfter: number } | { outcome: 'duplicate' }> {
    if (this.ledger.has(params.providerReference)) return { outcome: 'duplicate' };

    this.ledger.set(params.providerReference, {
      walletId: params.walletId,
      type: 'credit',
      credits: params.amountCredits,
    });

    return { outcome: 'credited', balanceAfter: this.move(params.walletId, params.amountCredits) };
  }

  private move(walletId: string, delta: number): number {
    const wallet = this.wallets.get(walletId) as Wallet;
    const updated = { ...wallet, balanceCredits: wallet.balanceCredits + delta };
    this.wallets.set(walletId, updated);
    return updated.balanceCredits;
  }
}

/** Records the wallet pushes a flow attempted, so best-effort delivery stays assertable. */
export class RecordingWalletNotifier {
  readonly credited: unknown[] = [];
  readonly insufficient: { variant: string; balance: number; userId: string }[] = [];
  readonly connected: { userId: string; credits: number; balanceAfter: number }[] = [];
  readonly freeTrial: { userId: string }[] = [];
  readonly onboarding: { userId: string; credits: number; balanceAfter: number }[] = [];

  async notifyCredited(params: unknown): Promise<void> {
    this.credited.push(params);
  }

  async notifyInsufficient(params: { variant: string; balance: number; userId: string }): Promise<void> {
    this.insufficient.push(params);
  }

  async notifyConnected(params: { userId: string; credits: number; balanceAfter: number }): Promise<void> {
    this.connected.push(params);
  }

  async notifyFreeTrial(params: { userId: string }): Promise<void> {
    this.freeTrial.push(params);
  }

  async notifyOnboardingCredit(params: {
    userId: string;
    credits: number;
    balanceAfter: number;
  }): Promise<void> {
    this.onboarding.push(params);
  }
}

/**
 * In-memory outbound queue enforcing the real ordering and lease rules.
 *
 * Written by hand because the properties under test are exactly the ones a stub would paper
 * over: that a conversation with a backlog does not send out of order, and that a claim is a
 * lease no second worker can take.
 */
export class InMemoryOutboundQueue implements OutboundMessageRepositoryPort {
  readonly rows: OutboundMessage[] = [];
  private counter = 0;

  async enqueue(params: {
    id: string;
    channel: Channel;
    address: string;
    conversationId: string;
    response: Response;
    at: Date;
  }): Promise<EnqueuedOutboundMessage> {
    this.counter += 1;

    const message: OutboundMessage = {
      id: params.id,
      channel: params.channel,
      address: params.address,
      conversationId: params.conversationId,
      response: params.response,
      status: 'pending',
      attempts: 0,
      lastError: null,
      providerMessageId: null,
      nextAttemptAt: params.at,
      // Distinct ordering even when the clock is frozen, as Postgres sequences would give.
      createdAt: new Date(params.at.getTime() + this.counter),
      sentAt: null,
    };

    const hasBacklog = this.rows.some(
      (row) =>
        row.conversationId === params.conversationId &&
        row.status === 'pending' &&
        row.createdAt <= message.createdAt,
    );

    this.rows.push(message);
    return { message, hasBacklog };
  }

  async markSent(id: string, params: { providerMessageId?: string; at: Date }): Promise<void> {
    this.patch(id, (row) => ({
      ...row,
      status: 'sent',
      sentAt: params.at,
      attempts: row.attempts + 1,
      lastError: null,
      providerMessageId: params.providerMessageId ?? null,
    }));
  }

  async scheduleRetry(id: string, params: { error: string; nextAttemptAt: Date }): Promise<void> {
    this.patch(id, (row) => ({
      ...row,
      status: 'pending',
      attempts: row.attempts + 1,
      lastError: params.error,
      nextAttemptAt: params.nextAttemptAt,
    }));
  }

  async markFailed(id: string, params: { error: string }): Promise<void> {
    this.patch(id, (row) => ({
      ...row,
      status: 'failed',
      attempts: row.attempts + 1,
      lastError: params.error,
    }));
  }

  async claimDue(params: {
    batchSize: number;
    now: Date;
    leaseMs: number;
  }): Promise<readonly OutboundMessage[]> {
    const due = this.rows
      .filter((row) => row.status === 'pending' && row.nextAttemptAt <= params.now)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, params.batchSize);

    const leaseUntil = new Date(params.now.getTime() + params.leaseMs);
    for (const row of due) this.patch(row.id, (current) => ({ ...current, nextAttemptAt: leaseUntil }));

    return due;
  }

  async purgeSent(params: { sentBefore: Date; limit: number }): Promise<number> {
    const doomed = this.rows
      .filter((row) => row.status === 'sent' && row.sentAt !== null && row.sentAt < params.sentBefore)
      .slice(0, params.limit);

    for (const row of doomed) this.rows.splice(this.rows.indexOf(row), 1);
    return doomed.length;
  }

  byId(id: string): OutboundMessage | undefined {
    return this.rows.find((row) => row.id === id);
  }

  private patch(id: string, update: (row: OutboundMessage) => OutboundMessage): void {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) this.rows[index] = update(this.rows[index]);
  }
}
