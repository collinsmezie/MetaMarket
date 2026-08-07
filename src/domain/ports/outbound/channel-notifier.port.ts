import type { Channel } from '../../models/channel';
import type { Response } from '../../models/response';

/**
 * Outbound delivery contract (ADR-001 driven port).
 *
 * The domain hands over a canonical Response and a destination; rendering it into a
 * WhatsApp interactive message, an SMS body or TwiML is entirely the adapter's problem.
 */

export const CHANNEL_NOTIFIER = Symbol('ChannelNotifier');

export interface DeliveryTarget {
  readonly channel: Channel;
  /** Channel-native address: E.164 phone number for WhatsApp/SMS/Voice. */
  readonly address: string;
  readonly conversationId: string;
}

export interface DeliveryResult {
  readonly delivered: boolean;
  /** Provider message id, retained for correlating later status callbacks. */
  readonly providerMessageId?: string;
  readonly error?: string;
  /** Set when one Response had to be split across several provider messages. */
  readonly messageCount?: number;
  /**
   * True when delivery failed but the message is durably queued and will be retried.
   *
   * The distinction callers care about is not "did this reach the user yet" but "has the
   * platform taken responsibility for it" — a queued reply is late, not lost, and treating it
   * as a failure would log noise and, worse, invite a caller to compensate for nothing.
   */
  readonly queued?: boolean;
  /**
   * Whether a retry could succeed without duplicating the message.
   *
   * Set by the channel adapter, which is the only layer that can tell a connection refused from
   * a socket reset mid-flight. Absent means unknown, which the queue treats as not retryable.
   */
  readonly retryable?: boolean;
}

/**
 * True when the platform has taken responsibility for a message — delivered now, or durably
 * queued and delivered shortly.
 *
 * Callers should branch on this rather than `delivered` alone; only a result where both are
 * false is a message the user will never see.
 */
export function isAccepted(result: DeliveryResult): boolean {
  return result.delivered || result.queued === true;
}

export interface ChannelNotifierPort {
  readonly channel: Channel;

  /**
   * Delivers a response.
   *
   * Returns a result rather than throwing on provider rejection: a failed reply must be
   * recorded as a MessageFailed event and must not roll back the workflow state that was
   * already committed.
   */
  send(target: DeliveryTarget, response: Response): Promise<DeliveryResult>;
}

export const CHANNEL_NOTIFIER_REGISTRY = Symbol('ChannelNotifierRegistry');

/** Resolves the notifier for a channel, so callers stay channel-agnostic. */
export interface ChannelNotifierRegistryPort {
  forChannel(channel: Channel): ChannelNotifierPort;
  supports(channel: Channel): boolean;
}
