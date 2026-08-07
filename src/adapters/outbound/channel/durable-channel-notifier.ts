import type { Channel } from '../../../domain/models/channel';
import { nextOutboundAttemptAt } from '../../../domain/models/outbound-message';
import type { Response } from '../../../domain/models/response';
import type {
  ChannelNotifierPort,
  DeliveryResult,
  DeliveryTarget,
} from '../../../domain/ports/outbound/channel-notifier.port';
import type { OutboundMessageRepositoryPort } from '../../../domain/ports/outbound/outbound-message-repository.port';
import type { StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import type { ClockPort, IdGeneratorPort } from '../../../domain/ports/outbound/system.port';

const COMPONENT = 'MCOS';
const STAGE = 'DurableDelivery';

/**
 * Gives any channel notifier a write-ahead log.
 *
 * The message is persisted *before* the send is attempted, which is the whole point: the inline
 * attempt is an optimisation for the common case, and the row is the guarantee. Previously a
 * composed reply existed only in memory, so an unreachable Graph API — or a deploy landing
 * mid-turn — meant the user got silence and there was nothing left to retry.
 *
 * A decorator rather than a change to each caller: `TurnProcessor`, `WalletNotifier` and
 * `VendorFanoutNotifier` all send through the registry, and durability is not a concern any of
 * them should have to remember to opt into.
 */
export class DurableChannelNotifier implements ChannelNotifierPort {
  readonly channel: Channel;

  constructor(
    private readonly inner: ChannelNotifierPort,
    private readonly queue: OutboundMessageRepositoryPort,
    private readonly logger: StageLoggerPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {
    this.channel = inner.channel;
  }

  async send(target: DeliveryTarget, response: Response): Promise<DeliveryResult> {
    const at = this.clock.now();

    let enqueued;
    try {
      enqueued = await this.queue.enqueue({
        id: this.ids.uuid(),
        channel: this.channel,
        address: target.address,
        conversationId: target.conversationId,
        response,
        at,
      });
    } catch (error) {
      // The database is the durability mechanism, so there is nothing to fall back *to* — but
      // an unsendable message is strictly worse than an unlogged one. Try anyway.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { channel: this.channel, conversationId: target.conversationId },
        action: 'Could not write the outbound message down; sending without a retry guarantee',
        error,
      });

      return this.inner.send(target, response);
    }

    const { message, hasBacklog } = enqueued;

    // Something older is still owed to this conversation. Sending now would land this reply in
    // front of one the user has not received, and a chat that answers out of order reads as
    // broken. Let the sweep drain the conversation in composition order.
    if (hasBacklog) {
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { conversationId: target.conversationId, messageId: message.id },
        action: 'Queued behind an undelivered reply for this conversation to preserve order',
        output: { queued: true },
      });

      return { delivered: false, queued: true };
    }

    const result = await this.inner.send(target, response);

    if (result.delivered) {
      await this.settle(message.id, () =>
        this.queue.markSent(message.id, {
          at: this.clock.now(),
          ...(result.providerMessageId !== undefined ? { providerMessageId: result.providerMessageId } : {}),
        }),
      );

      return result;
    }

    const error = result.error ?? 'unknown delivery failure';

    // Only failures the adapter judged safe to repeat are queued. Anything ambiguous — a socket
    // reset, a partially delivered multi-part reply — would risk the user receiving a message
    // twice, and there is no idempotency key on any of these channels to prevent it.
    if (result.retryable !== true) {
      await this.settle(message.id, () => this.queue.markFailed(message.id, { error }));
      return result;
    }

    await this.settle(message.id, () =>
      this.queue.scheduleRetry(message.id, {
        error,
        nextAttemptAt: nextOutboundAttemptAt(1, this.clock.now()),
      }),
    );

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { conversationId: target.conversationId, messageId: message.id },
      action: `Delivery failed but the message is queued for retry: ${error}`,
      output: { queued: true },
    });

    return { ...result, queued: true };
  }

  /**
   * Records the outcome of an attempt.
   *
   * Never throws: the send has already happened one way or the other, and failing the caller
   * over bookkeeping would turn a delivered message into a reported error. A lost `markSent`
   * costs at worst one duplicate on the next sweep, which is why it is logged loudly.
   */
  private async settle(messageId: string, write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { messageId },
        action: 'Could not record the delivery outcome; the sweep may retry an already-sent message',
        error,
      });
    }
  }
}
