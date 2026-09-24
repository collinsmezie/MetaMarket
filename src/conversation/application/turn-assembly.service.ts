import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AppConfigService } from '../../config/app-config.service';
import type { IncomingMessage } from '../../domain/models/incoming-message';
import { isInteractiveReplyPart, PROVIDER_MESSAGE_ID_KEY } from '../../domain/models/incoming-message';
import {
  DISTRIBUTED_LOCK,
  type DistributedLockPort,
} from '../../domain/ports/outbound/distributed-lock.port';
import { EVENT_PUBLISHER, type EventPublisherPort } from '../../domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import { RequestContextStore } from '../../platform/correlation/request-context';
import { correlatedEvent, PlatformEvents } from '../../platform/events/domain-event';
import { LeaderLock } from '../../platform/scheduling/leader-lock';
import {
  decideBoundary,
  looksLikeTopicSwitch,
  type AssemblyLimits,
  type BoundaryDecision,
} from '../domain/assembly-policy';
import type { LogicalTurn, TurnMessage } from '../domain/logical-turn';
import {
  LOGICAL_TURN_REPOSITORY,
  type AcceptMessageOutcome,
  type LogicalTurnRepositoryPort,
  type OpenTurnRow,
} from '../ports/logical-turn.repository.port';
import { TurnAssemblyClassifier } from './turn-assembly-classifier';
import { TurnQueueWorker } from './turn-queue.worker';

const COMPONENT = 'MCOS';
const STAGE = 'TurnAssembly';
const SWEEP_INTERVAL_MS = 1_000;
const SWEEP_BATCH = 50;

/**
 * Logical Turn Assembly (MCOS TDR §5A).
 *
 * Owns the input boundary of an orchestration run: which transport messages are reasoned about
 * together. It never decides intent. Durable state lives in `logical_turns`/`turn_queue`; the
 * in-process quiet-deadline timer is an accelerator, and the periodic sweep (any replica, CAS-safe)
 * is the guarantee that a turn is sealed even if the process that opened it died (§5A.3).
 */
@Injectable()
export class TurnAssemblyService implements OnModuleDestroy {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly leader: LeaderLock;
  private stopped = false;

  constructor(
    @Inject(LOGICAL_TURN_REPOSITORY) private readonly turns: LogicalTurnRepositoryPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(DISTRIBUTED_LOCK) locks: DistributedLockPort,
    private readonly config: AppConfigService,
    private readonly classifier: TurnAssemblyClassifier,
    private readonly worker: TurnQueueWorker,
  ) {
    this.leader = new LeaderLock(locks);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /**
   * Accepts a persisted, deduplicated transport message into a logical turn. Returns the turn the
   * message now belongs to; sealed turns are already enqueued and the queue worker kicked.
   */
  async accept(params: {
    readonly message: IncomingMessage;
    readonly text: string;
  }): Promise<AcceptMessageOutcome> {
    const { message } = params;
    const now = this.clock.now();
    const limits = this.limitsFor(message.channel);
    const interactive = message.parts.find(isInteractiveReplyPart);
    const providerEventId = message.metadata[PROVIDER_MESSAGE_ID_KEY];

    const turnMessage: TurnMessage = {
      messageId: message.id,
      channel: message.channel,
      senderId: message.userId,
      text: params.text,
      // The message's own timestamp orders messages inside a turn even when two arrive together;
      // deadlines are computed from acceptance time (`now`) below.
      receivedAt: message.timestamp,
      providerEventId: typeof providerEventId === 'string' ? providerEventId : null,
      interactivePayload: interactive?.payload ?? null,
    };

    const classifierVerdict = await this.maybeClassify(message.conversationId, turnMessage);

    const decide = (open: OpenTurnRow | null): BoundaryDecision => {
      const decision = decideBoundary(
        open,
        {
          channel: message.channel,
          text: params.text,
          interactivePayload: turnMessage.interactivePayload,
          receivedAt: now,
        },
        limits,
        { classifierEnabled: this.config.turnAssembly.classifierEnabled },
      );
      if (decision.action !== 'UNCERTAIN') return decision;
      if (classifierVerdict === 'NEW_TURN') {
        return { action: 'SEAL_OPEN_THEN_NEW', reason: 'MODEL_CLASSIFIER', newTurnSealed: false };
      }
      return { action: 'APPEND', reason: 'CONTINUATION', newQuietDeadlineAt: decision.newQuietDeadlineAt };
    };

    const outcome = await this.turns.acceptMessage({
      conversationId: message.conversationId,
      channel: message.channel,
      correlationId: RequestContextStore.current()?.correlationId ?? `corr_${message.id}`,
      message: turnMessage,
      limits,
      decide,
    });

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { messageId: message.id, channel: message.channel, chars: params.text.length },
      action: `Accepted the message into turn ${outcome.turn.turnId} (${outcome.decision.action})`,
      output: {
        turnId: outcome.turn.turnId,
        status: outcome.turn.status,
        messages: outcome.turn.messageIds.length,
        sealed: outcome.sealedTurnIds,
        cancelled: outcome.cancelledTurnId,
        quietDeadlineAt: outcome.turn.quietDeadlineAt,
        limits,
      },
    });

    if (outcome.turn.messageIds.length === 1) {
      await this.publish(PlatformEvents.LogicalTurnCreated, outcome.turn, {
        boundaryReason: outcome.turn.boundaryReason,
        supersedesTurnId: outcome.turn.supersedesTurnId,
      });
    }

    if (outcome.cancelledTurnId !== null) {
      this.clearTimer(outcome.cancelledTurnId);
    }

    await this.afterSeal(outcome.sealedTurnIds);

    if (outcome.turn.status === 'OPEN') this.arm(outcome.turn);

    return outcome;
  }

  /** The turn a message was assembled into, or null when it has not been accepted yet. */
  async turnOf(messageId: string): Promise<string | null> {
    const turn = await this.turns.findByMessageId(messageId);
    return turn?.turnId ?? null;
  }

  /** Recovery path: seals every OPEN turn whose quiet deadline has passed, whichever replica opened it. */
  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    if (this.stopped) return;
    await this.leader.runExclusively('turn-assembly-sweep', SWEEP_INTERVAL_MS * 3, () => this.sealOverdue());
  }

  async sealOverdue(): Promise<number> {
    const now = this.clock.now();
    const overdue = await this.turns.findOverdueOpenTurns(now, SWEEP_BATCH);
    const sealed: string[] = [];
    for (const candidate of overdue) {
      if (await this.turns.sealIfDue(candidate.turnId, candidate.revision, now, 'QUIET_WINDOW_ELAPSED')) {
        sealed.push(candidate.turnId);
        this.clearTimer(candidate.turnId);
      }
    }
    await this.afterSeal(sealed);
    return sealed.length;
  }

  private arm(turn: LogicalTurn): void {
    if (this.stopped) return;
    this.clearTimer(turn.turnId);
    const delay = Math.max(0, turn.quietDeadlineAt.getTime() - this.clock.now().getTime()) + 10;
    const timer = setTimeout(() => {
      this.timers.delete(turn.turnId);
      void this.sealDue(turn.turnId, turn.revision);
    }, delay);
    this.timers.set(turn.turnId, timer);
  }

  private async sealDue(turnId: string, revision: number): Promise<void> {
    try {
      const sealed = await this.turns.sealIfDue(turnId, revision, this.clock.now(), 'QUIET_WINDOW_ELAPSED');
      // A zero-row CAS means the turn changed (a message was appended and re-armed the timer) or
      // another sealer won. Either way there is nothing to do here.
      if (sealed) await this.afterSeal([turnId]);
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Seal`,
        input: { turnId, revision },
        action: 'Quiet-deadline seal failed; the sweep will retry',
        error,
      });
    }
  }

  private async afterSeal(turnIds: readonly string[]): Promise<void> {
    for (const turnId of turnIds) {
      const turn = await this.turns.findById(turnId);
      if (turn === null) continue;
      await this.publish(PlatformEvents.LogicalTurnSealed, turn, {
        assemblyReason: turn.assemblyReason,
        boundaryReason: turn.boundaryReason,
        messageCount: turn.messageIds.length,
      });
      const entry = await this.turns.enqueue(turnId);
      if (entry !== null) this.worker.kick(entry.conversationId);
    }
  }

  private async maybeClassify(
    conversationId: string,
    incoming: TurnMessage,
  ): Promise<'SAME_TURN' | 'NEW_TURN' | null> {
    if (!this.config.turnAssembly.classifierEnabled) return null;
    if (incoming.interactivePayload !== null || !looksLikeTopicSwitch(incoming.text)) return null;

    const [latest] = await this.turns.listForConversation(conversationId, 1);
    if (latest === undefined || latest.status !== 'OPEN') return null;

    const verdict = await this.classifier.classify({
      unsealedMessages: latest.messages.map((message) => message.text),
      newMessage: incoming.text,
      channel: incoming.channel,
      activeWorkflowTypes: [],
    });
    return verdict?.decision ?? null;
  }

  private limitsFor(channel: string): AssemblyLimits {
    const policy = this.config.turnAssembly;
    return {
      quietWindowMs: policy.quietWindowMsFor(channel),
      maxAssemblyMs: policy.maxAssemblyMs,
      maxMessageCount: policy.maxMessageCount,
    };
  }

  private clearTimer(turnId: string): void {
    const timer = this.timers.get(turnId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(turnId);
    }
  }

  private async publish(
    eventType: string,
    turn: LogicalTurn,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.events.publish(
      correlatedEvent({
        eventId: this.ids.uuid(),
        eventType,
        producer: 'MCOS',
        occurredAt: this.clock.now(),
        payload: { turnId: turn.turnId, messageIds: turn.messageIds, ...payload },
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        aggregate: { type: 'LogicalTurn', id: turn.turnId },
      }),
    );
  }
}
