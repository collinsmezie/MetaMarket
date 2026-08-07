import { Inject, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { OutboundMessage } from '../../domain/models/outbound-message';
import { isExhausted, nextOutboundAttemptAt } from '../../domain/models/outbound-message';
import {
  CHANNEL_NOTIFIER_REGISTRY,
  type ChannelNotifierRegistryPort,
} from '../../domain/ports/outbound/channel-notifier.port';
import {
  OUTBOUND_MESSAGE_REPOSITORY,
  type OutboundMessageRepositoryPort,
} from '../../domain/ports/outbound/outbound-message-repository.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { CLOCK, type ClockPort } from '../../domain/ports/outbound/system.port';

const COMPONENT = 'MCOS';
const STAGE = 'OutboundDeliverySweeper';

const SWEEP_INTERVAL_MS = 10_000;

/** Bounds the work one tick can do, so a large backlog drains steadily rather than in a spike. */
const BATCH_SIZE = 50;

/**
 * How long a claimed message is invisible to other sweepers.
 *
 * Comfortably longer than the adapter's own send deadline (20s), so a slow send finishes before
 * a second worker could consider the message abandoned and deliver it again.
 */
const CLAIM_LEASE_MS = 60_000;

/** Delivered messages are evidence for a day, not an archive. */
const SENT_RETENTION_MS = 24 * 60 * 60 * 1_000;

/**
 * Drains the durable outbound queue (last-mile delivery guarantee).
 *
 * The counterpart to `DurableChannelNotifier`: that writes every reply down and attempts it
 * inline, this one delivers whatever the inline attempt could not. Between them a channel
 * outage becomes a delayed message rather than a lost one — the gap that left a user staring at
 * silence after the Graph API timed out mid-turn.
 *
 * Deliberately the same shape as `OutboxRelay`: an interval sweep, a bounded batch, an attempt
 * ceiling, and failures parked for an operator rather than retried forever.
 */
@Injectable()
export class OutboundDeliverySweeper {
  /** Prevents overlapping sweeps when a batch outlives the interval. */
  private running = false;

  constructor(
    @Inject(OUTBOUND_MESSAGE_REPOSITORY) private readonly queue: OutboundMessageRepositoryPort,
    @Inject(CHANNEL_NOTIFIER_REGISTRY) private readonly notifiers: ChannelNotifierRegistryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      await this.drain();
      await this.purge();
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: {},
        action: 'Outbound sweep failed; the next tick retries',
        error,
      });
    } finally {
      this.running = false;
    }
  }

  /** Exposed so tests and operators can force a drain without waiting for the interval. */
  async drain(): Promise<{ sent: number; retried: number; failed: number }> {
    const claimed = await this.queue.claimDue({
      batchSize: BATCH_SIZE,
      now: this.clock.now(),
      leaseMs: CLAIM_LEASE_MS,
    });

    const counts = { sent: 0, retried: 0, failed: 0 };
    if (claimed.length === 0) return counts;

    // A conversation whose oldest pending message just failed must not have its later messages
    // delivered ahead of it. Ordering is the reason the queue exists at all for a chat product.
    const blocked = new Set<string>();

    for (const message of claimed) {
      if (blocked.has(message.conversationId)) continue;

      const outcome = await this.deliver(message);

      counts[outcome] += 1;
      if (outcome !== 'sent') blocked.add(message.conversationId);
    }

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { claimed: claimed.length },
      action: `Drained ${counts.sent} queued message(s)`,
      output: counts,
    });

    return counts;
  }

  private async deliver(message: OutboundMessage): Promise<'sent' | 'retried' | 'failed'> {
    const now = this.clock.now();

    if (!this.notifiers.supports(message.channel)) {
      await this.queue.markFailed(message.id, {
        error: `No notifier is registered for channel "${message.channel}"`,
      });
      return 'failed';
    }

    let result;
    try {
      result = await this.notifiers
        .forChannel(message.channel)
        .send(
          { channel: message.channel, address: message.address, conversationId: message.conversationId },
          message.response,
        );
    } catch (error) {
      // A notifier is contracted to return a result rather than throw, but the queue must not
      // lose a message because one broke that contract.
      result = { delivered: false, error: error instanceof Error ? error.message : String(error) };
    }

    if (result.delivered) {
      await this.queue.markSent(message.id, {
        at: now,
        ...(result.providerMessageId !== undefined ? { providerMessageId: result.providerMessageId } : {}),
      });
      return 'sent';
    }

    const error = result.error ?? 'unknown delivery failure';
    const attempts = message.attempts + 1;

    // `retryable === false` is the adapter saying a repeat could duplicate the message, or that
    // the rejection is a decision no amount of waiting changes — a revoked token, a recipient
    // outside the 24-hour window. Both are parked rather than cycled.
    if (result.retryable !== true || isExhausted(attempts)) {
      await this.queue.markFailed(message.id, { error });

      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { messageId: message.id, conversationId: message.conversationId, attempts },
        action: isExhausted(attempts)
          ? 'Attempt budget exhausted; parking the message for reconciliation'
          : 'Delivery failed permanently; parking the message for reconciliation',
        error: new Error(error),
      });

      return 'failed';
    }

    await this.queue.scheduleRetry(message.id, {
      error,
      nextAttemptAt: nextOutboundAttemptAt(attempts, now),
    });

    return 'retried';
  }

  private async purge(): Promise<void> {
    const removed = await this.queue.purgeSent({
      sentBefore: new Date(this.clock.now().getTime() - SENT_RETENTION_MS),
      limit: 500,
    });

    if (removed > 0) {
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { retentionHours: SENT_RETENTION_MS / 3_600_000 },
        action: `Purged ${removed} delivered message(s) past the retention window`,
        output: { removed },
      });
    }
  }
}
