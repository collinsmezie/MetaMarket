import type { Channel } from './channel';
import type { Response } from './response';

/**
 * The durable outbound queue (last-mile delivery guarantee).
 *
 * Every reply is written down before it is sent. The inline attempt is an optimisation — the
 * row is what makes delivery survive a network outage, a Graph API incident or a process
 * restart. Without it a composed reply lived only in memory, and an unreachable channel meant
 * the user got silence with nothing left to retry.
 */

export const OUTBOUND_MESSAGE_STATUSES = ['pending', 'sent', 'failed'] as const;

export type OutboundMessageStatus = (typeof OUTBOUND_MESSAGE_STATUSES)[number];

export interface OutboundMessage {
  readonly id: string;
  readonly channel: Channel;
  readonly address: string;
  readonly conversationId: string;
  readonly response: Response;
  readonly status: OutboundMessageStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly providerMessageId: string | null;
  readonly nextAttemptAt: Date;
  readonly createdAt: Date;
  readonly sentAt: Date | null;
}

/**
 * Attempts before a message is parked for an operator.
 *
 * Eight attempts on the schedule below spans about ten minutes. Past that the channel is not
 * having a blip, and a conversational reply that arrives half an hour late is often worse than
 * one that never arrives — while an unbounded queue would keep one poisoned message cycling
 * forever ahead of healthy ones.
 */
export const MAX_OUTBOUND_ATTEMPTS = 8;

/** First retry delay; each subsequent attempt doubles it. */
export const OUTBOUND_BACKOFF_BASE_MS = 5_000;

/** Ceiling on a single wait, so the tail of the schedule stays responsive. */
export const OUTBOUND_BACKOFF_MAX_MS = 10 * 60 * 1_000;

/**
 * When the next attempt for a message on its `attempts`-th failure may run.
 *
 * Jittered, so a channel outage that fails a thousand queued messages at once does not send
 * them all back at the provider in the same instant when it recovers.
 */
export function nextOutboundAttemptAt(attempts: number, now: Date, jitter = Math.random()): Date {
  const safeAttempts = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 1;
  const exponential = Math.min(OUTBOUND_BACKOFF_BASE_MS * 2 ** (safeAttempts - 1), OUTBOUND_BACKOFF_MAX_MS);

  // 50–150% of the nominal delay.
  return new Date(now.getTime() + Math.round(exponential * (0.5 + jitter)));
}

/** True once a message has used its whole budget and should be parked rather than retried. */
export function isExhausted(attempts: number): boolean {
  return attempts >= MAX_OUTBOUND_ATTEMPTS;
}
