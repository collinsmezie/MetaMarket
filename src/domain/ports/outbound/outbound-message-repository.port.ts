import type { Channel } from '../../models/channel';
import type { OutboundMessage } from '../../models/outbound-message';
import type { Response } from '../../models/response';

export const OUTBOUND_MESSAGE_REPOSITORY = Symbol('OutboundMessageRepository');

export interface EnqueuedOutboundMessage {
  readonly message: OutboundMessage;
  /**
   * True when this conversation already had older undelivered messages.
   *
   * The caller uses it to skip the inline attempt and let the sweep drain the conversation in
   * order. Sending this one now would put it in front of a reply the user has not received yet,
   * and a chat that answers the second question first reads as a broken product.
   */
  readonly hasBacklog: boolean;
}

export interface OutboundMessageRepositoryPort {
  /** Writes the message down before any send is attempted. */
  enqueue(params: {
    id: string;
    channel: Channel;
    address: string;
    conversationId: string;
    response: Response;
    at: Date;
  }): Promise<EnqueuedOutboundMessage>;

  markSent(id: string, params: { providerMessageId?: string; at: Date }): Promise<void>;

  /** Records a failed attempt and schedules the retry. */
  scheduleRetry(id: string, params: { error: string; nextAttemptAt: Date }): Promise<void>;

  /** Parks a message: either the failure is permanent or the attempt budget is spent. */
  markFailed(id: string, params: { error: string }): Promise<void>;

  /**
   * Atomically leases up to `batchSize` due messages to this worker, oldest first.
   *
   * The same `FOR UPDATE SKIP LOCKED` claim as the payment work queue, so concurrent sweepers
   * take disjoint rows and no message is sent twice by two pods. The claim is a *lease* — it
   * pushes `nextAttemptAt` forward rather than moving the row to a `processing` state — which
   * means a sweeper that dies mid-batch strands nothing: the lease simply expires and the
   * message becomes due again, with no reaper to write and no stuck state to explain.
   */
  claimDue(params: { batchSize: number; now: Date; leaseMs: number }): Promise<readonly OutboundMessage[]>;

  /** Drops delivered rows past their retention window; the log is a queue, not an archive. */
  purgeSent(params: { sentBefore: Date; limit: number }): Promise<number>;
}
