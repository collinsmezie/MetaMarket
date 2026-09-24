import { Inject, Injectable } from '@nestjs/common';
import { ConversationContextManager } from '../../application/conversation/conversation-context.manager';
import { AppConfigService } from '../../config/app-config.service';
import { EVENT_PUBLISHER, type EventPublisherPort } from '../../domain/ports/outbound/event-publisher.port';
import {
  MESSAGE_REPOSITORY,
  type MessageRepositoryPort,
} from '../../domain/ports/outbound/message-repository.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import { RequestContextStore, runIdForTurn } from '../../platform/correlation/request-context';
import { correlatedEvent, PlatformEvents } from '../../platform/events/domain-event';
import { TRACE_RECORDER, type TraceRecorderPort } from '../../platform/observability/trace.port';
import type { LogicalTurn, TurnQueueEntry } from '../domain/logical-turn';
import type { TurnInputState } from '../domain/turn-context';
import {
  LOGICAL_TURN_REPOSITORY,
  type LogicalTurnRepositoryPort,
} from '../ports/logical-turn.repository.port';
import {
  summaryFromOutcome,
  TURN_ORCHESTRATOR,
  type TurnOrchestratorPort,
  type TurnOutcome,
} from '../ports/turn-orchestrator.port';
import { ClarificationService } from './clarification.service';
import { TurnContextBuilder } from './turn-context.builder';

const COMPONENT = 'MCOS';
const STAGE = 'TurnExecutor';

/**
 * Executes one claimed logical turn end to end (MCOS TDR §10 turn lifecycle, §19–§20, §46–§49).
 *
 *   claim → load turn → bind pending clarification → build/persist context snapshot →
 *   run envelope (run_id = turn:{turnId}) → conversation lock (extended while running) →
 *   orchestrator → commit turn outcome + summary → events → trace.
 *
 * Business state is read fresh by the orchestrator against the latest committed state
 * (§5A.10 invariant 6). The executor never mutates workflow, wallet or evidence state itself.
 */
@Injectable()
export class TurnExecutor {
  constructor(
    @Inject(LOGICAL_TURN_REPOSITORY) private readonly turns: LogicalTurnRepositoryPort,
    @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
    @Inject(TURN_ORCHESTRATOR) private readonly orchestrator: TurnOrchestratorPort,
    @Inject(TRACE_RECORDER) private readonly traces: TraceRecorderPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly config: AppConfigService,
    private readonly conversations: ConversationContextManager,
    private readonly contextBuilder: TurnContextBuilder,
    private readonly clarifications: ClarificationService,
  ) {}

  async execute(entry: TurnQueueEntry): Promise<void> {
    const turn = await this.turns.findById(entry.turnId);
    if (turn === null) {
      await this.turns.complete({
        turnId: entry.turnId,
        status: 'FAILED',
        completedAt: this.clock.now(),
        summary: null,
        error: { code: 'TURN_NOT_FOUND', message: 'Queue entry references a missing logical turn' },
      });
      return;
    }

    const runId = runIdForTurn(turn.turnId);

    await RequestContextStore.resume(
      {
        correlationId: turn.correlationId,
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        runId,
        component: 'MCOS',
      },
      () => this.run(turn, entry, runId),
    );
  }

  private async run(turn: LogicalTurn, entry: TurnQueueEntry, runId: string): Promise<void> {
    const startedAt = this.clock.now();

    await this.traces.startRun({
      runId,
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      correlationId: turn.correlationId,
      messageIds: turn.messageIds,
      channel: turn.channel,
      startedAt,
    });

    try {
      // Deterministic answer-to-question binding happens before orchestration (MCOS §25A.3).
      const pending = await this.clarifications.bindAnswer(turn);
      const { snapshot, conversation } = await this.contextBuilder.build(turn, pending);

      await this.turns.markProcessing(turn.turnId, runId, snapshot.snapshotId, this.clock.now());

      const input: TurnInputState = {
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        runId,
        messageIds: turn.messageIds,
        currentMessages: turn.messages.map((message) => ({
          messageId: message.messageId,
          channel: message.channel,
          senderId: message.senderId,
          text: message.text,
          receivedAt: message.receivedAt.toISOString(),
          providerEventId: message.providerEventId,
          interactivePayload: message.interactivePayload,
        })),
        assembledText: turn.assembledText,
        assemblyReason: turn.assemblyReason ?? 'SINGLE_MESSAGE',
        previousTurnSummary: snapshot.context.previousTurnSummary,
        contextSnapshotId: snapshot.snapshotId,
        assembledAt: (turn.sealedAt ?? turn.lastMessageAt).toISOString(),
        channel: turn.channel,
        userId: conversation.conversation.userId,
      };

      const outcome = await this.underConversationLock(turn.conversationId, () =>
        this.orchestrator.runTurn(input, snapshot.context),
      );

      if (outcome === null) {
        throw new RetryableTurnError('CONVERSATION_LOCKED', 'Another executor holds this conversation');
      }

      await this.commit(turn, entry, runId, outcome, startedAt);
    } catch (error) {
      await this.fail(turn, entry, runId, error);
    }
  }

  private async commit(
    turn: LogicalTurn,
    entry: TurnQueueEntry,
    runId: string,
    outcome: TurnOutcome,
    startedAt: Date,
  ): Promise<void> {
    const completedAt = this.clock.now();
    const status =
      outcome.status === 'WAITING_USER'
        ? 'WAITING_USER'
        : outcome.status === 'FAILED'
          ? 'FAILED'
          : 'COMMITTED';
    const summary = summaryFromOutcome(turn.turnId, outcome);

    await this.turns.complete({
      turnId: turn.turnId,
      status,
      completedAt,
      summary,
      error: outcome.error === null ? null : { code: outcome.error.code, message: outcome.error.message },
    });

    await Promise.all(
      turn.messageIds.map((messageId) => this.messages.markProcessed(messageId, completedAt)),
    );

    await this.events.publish(
      correlatedEvent({
        eventId: this.ids.uuid(),
        eventType: PlatformEvents.LogicalTurnCommitted,
        producer: 'MCOS',
        occurredAt: completedAt,
        payload: {
          turnId: turn.turnId,
          status,
          outcome: outcome.status,
          workflowIds: outcome.workflowIds,
          intentTypes: outcome.intentTypes,
          objectIds: outcome.objectIds,
          attempts: entry.attempts,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        runId,
        aggregate: { type: 'LogicalTurn', id: turn.turnId },
      }),
    );

    await this.traces.completeRun({
      runId,
      status: outcome.status === 'PARTIAL' ? 'PARTIAL' : status === 'COMMITTED' ? 'COMPLETED' : status,
      completedAt,
      finalResponse: outcome.responses,
      error: outcome.error === null ? null : { code: outcome.error.code, message: outcome.error.message },
    });

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { turnId: turn.turnId, messages: turn.messageIds.length, attempt: entry.attempts },
      action: `Committed the logical turn as ${status}`,
      output: { runId, workflowIds: outcome.workflowIds, responses: outcome.responses.length },
      durationMs: completedAt.getTime() - startedAt.getTime(),
    });
  }

  private async fail(turn: LogicalTurn, entry: TurnQueueEntry, runId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof RetryableTurnError ? error.code : 'TURN_EXECUTION_ERROR';
    const completedAt = this.clock.now();
    const canRetry = entry.attempts < this.config.turnAssembly.maxExecutionAttempts;

    this.logger.stageFailed({
      component: COMPONENT,
      stage: STAGE,
      input: { turnId: turn.turnId, attempt: entry.attempts, willRetry: canRetry },
      action: canRetry
        ? 'Turn execution failed; requeued for a bounded retry'
        : 'Turn execution failed; attempts exhausted',
      error,
    });

    await this.traces.completeRun({
      runId,
      status: 'FAILED',
      completedAt,
      finalResponse: null,
      error: { code, message },
    });

    if (canRetry) {
      await this.turns.requeue(turn.turnId, `${code}: ${message}`);
      return;
    }

    await this.turns.complete({
      turnId: turn.turnId,
      status: 'FAILED',
      completedAt,
      summary: null,
      error: { code, message },
    });
  }

  /**
   * Holds the conversation lock for the whole orchestration and extends it on a heartbeat so a
   * long turn (fanout, slow model) cannot outlive its lease (MCOS §19; wires the previously
   * unused `extendLock`).
   */
  private async underConversationLock<T>(conversationId: string, work: () => Promise<T>): Promise<T | null> {
    const ttl = this.config.conversationPolicy.lockTtlMs;
    return this.conversations.withLock(conversationId, async (initial) => {
      let handle = initial;
      const heartbeat = setInterval(
        () => {
          void this.conversations.extendLock(handle).then((extended) => {
            if (extended !== null) handle = extended;
          });
        },
        Math.max(1_000, Math.floor(ttl / 2)),
      );
      try {
        return await work();
      } finally {
        clearInterval(heartbeat);
      }
    });
  }
}

class RetryableTurnError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RetryableTurnError';
  }
}
