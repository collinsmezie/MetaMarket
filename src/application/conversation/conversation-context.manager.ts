import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import type { Channel } from '../../domain/models/channel';
import type {
  Conversation,
  ConversationContext,
  ConversationMemory,
  HistoryEntry,
  HistoryRole,
} from '../../domain/models/conversation';
import { withFact } from '../../domain/models/conversation';
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepositoryPort,
} from '../../domain/ports/outbound/conversation-repository.port';
import {
  conversationLockKey,
  DISTRIBUTED_LOCK,
  type DistributedLockPort,
  type LockHandle,
} from '../../domain/ports/outbound/distributed-lock.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepositoryPort,
} from '../../domain/ports/outbound/workflow-repository.port';

const COMPONENT = 'MCOS';
const STAGE = 'ConversationContextManager';

/**
 * How much history is loaded for reasoning.
 *
 * Bounded deliberately: workflow summaries and conversation memory carry long-term context
 * (MCOS §11), so replaying an unbounded transcript would cost tokens without adding signal.
 */
const HISTORY_WINDOW = 20;

/**
 * Owner of conversation state (MCOS §5.3).
 *
 * Creates and loads conversations, assembles the working context, appends history, and
 * holds the per-conversation lock. It never determines intent.
 */
@Injectable()
export class ConversationContextManager {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly conversations: ConversationRepositoryPort,
    @Inject(WORKFLOW_REPOSITORY) private readonly workflows: WorkflowRepositoryPort,
    @Inject(DISTRIBUTED_LOCK) private readonly locks: DistributedLockPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Runs `work` while holding the conversation lock, so exactly one worker processes a
   * conversation at a time (MCOS §20).
   *
   * Returns null when the lock could not be taken; the caller decides how to degrade rather
   * than having a timeout surface as an opaque exception.
   */
  async withLock<T>(conversationId: string, work: (handle: LockHandle) => Promise<T>): Promise<T | null> {
    const { lockTtlMs, lockWaitMs } = this.config.conversationPolicy;
    const handle = await this.locks.acquire(conversationLockKey(conversationId), lockTtlMs, lockWaitMs);

    if (handle === null) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Lock`,
        input: { conversationId, waitedMs: lockWaitMs },
        action: 'Could not acquire the conversation lock; another worker holds this conversation',
        error: new Error(`Lock timeout after ${lockWaitMs}ms`),
      });
      return null;
    }

    try {
      return await work(handle);
    } finally {
      // Always release, including when the work threw — otherwise the conversation stays
      // wedged until the TTL expires.
      await this.locks.release(handle);
    }
  }

  /** Extends the lock when a turn is doing slow work and risks losing it mid-flight. */
  async extendLock(handle: LockHandle): Promise<LockHandle | null> {
    return this.locks.extend(handle, this.config.conversationPolicy.lockTtlMs);
  }

  /**
   * Loads (or creates) the conversation and assembles the working context: memory, the
   * workflow registry and a bounded history window.
   */
  async load(params: { userId: string; channel: Channel }): Promise<ConversationContext> {
    const startedAt = Date.now();

    const { conversation, created } = await this.conversations.findOrCreateByUser(params);

    const [registry, recentHistory] = await Promise.all([
      this.workflows.loadRegistry(conversation.id),
      created
        ? Promise.resolve([] as readonly HistoryEntry[])
        : this.conversations.loadRecentHistory(conversation.id, HISTORY_WINDOW),
    ]);

    const hydrated: Conversation = { ...conversation, workflowRegistry: registry, history: recentHistory };

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { userId: params.userId, channel: params.channel },
      action: created
        ? 'Created a new conversation for a first-time user'
        : 'Loaded the existing conversation with its workflow registry and recent history',
      output: {
        conversationId: hydrated.id,
        created,
        activeWorkflowId: registry.activeWorkflowId,
        workflowCount: registry.workflowInstances.length,
        historyLoaded: recentHistory.length,
        knownFacts: Object.keys(hydrated.memory.facts).length,
      },
      durationMs: Date.now() - startedAt,
    });

    return { conversation: hydrated, recentHistory };
  }

  /**
   * Resolves the conversation a user's message belongs to, creating it on first contact.
   *
   * Channel adapters cannot know this id — they only know a phone number — so the pipeline
   * resolves it before persisting the message. Idempotent, and safe to call outside the
   * conversation lock.
   */
  async resolveConversationId(params: { userId: string; channel: Channel }): Promise<string> {
    const { conversation } = await this.conversations.findOrCreateByUser(params);
    return conversation.id;
  }

  async loadById(conversationId: string): Promise<ConversationContext | null> {
    const conversation = await this.conversations.findById(conversationId);
    if (conversation === null) return null;

    const [registry, recentHistory] = await Promise.all([
      this.workflows.loadRegistry(conversationId),
      this.conversations.loadRecentHistory(conversationId, HISTORY_WINDOW),
    ]);

    return {
      conversation: { ...conversation, workflowRegistry: registry, history: recentHistory },
      recentHistory,
    };
  }

  async recordUserTurn(params: {
    conversationId: string;
    channel: Channel;
    content: string;
    workflowId?: string;
  }): Promise<void> {
    await this.appendHistory({ ...params, role: 'user' });
  }

  async recordAssistantTurn(params: {
    conversationId: string;
    channel: Channel;
    content: string;
    workflowId?: string;
  }): Promise<void> {
    await this.appendHistory({ ...params, role: 'assistant' });
  }

  private async appendHistory(params: {
    conversationId: string;
    channel: Channel;
    content: string;
    role: HistoryRole;
    workflowId?: string;
  }): Promise<void> {
    // Empty turns carry no signal and would dilute the history window.
    if (params.content.trim().length === 0) return;

    await this.conversations.appendHistory(params.conversationId, {
      id: this.ids.uuid(),
      role: params.role,
      content: params.content,
      channel: params.channel,
      timestamp: this.clock.now(),
      ...(params.workflowId !== undefined ? { workflowId: params.workflowId } : {}),
    });
  }

  /**
   * Persists learned facts so later workflows never re-ask for them
   * (Information Before Questions, MCOS Refinement #11).
   */
  async rememberFacts(
    conversation: Conversation,
    facts: Readonly<Record<string, { value: unknown; confidence: number; source: string }>>,
    summary?: string,
  ): Promise<ConversationMemory> {
    let memory = conversation.memory;

    for (const [key, fact] of Object.entries(facts)) {
      const existing = memory.facts[key];

      // A weaker signal must not overwrite a stronger one — a guessed city should never
      // replace a city the user stated outright.
      if (existing !== undefined && existing.confidence > fact.confidence) continue;

      memory = withFact(memory, key, { ...fact, updatedAt: this.clock.now() });
    }

    if (summary !== undefined) memory = { ...memory, summary };

    await this.conversations.updateMemory(conversation.id, memory);

    return memory;
  }

  async touch(conversationId: string, channel: Channel): Promise<void> {
    await this.conversations.touch(conversationId, channel, this.clock.now());
  }
}
