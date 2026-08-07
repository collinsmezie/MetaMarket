import { z } from 'zod';
import type { PaymentNotificationInput } from '../../../domain/ports/inbound/handle-payment-notification.port';

/**
 * Translates Paystack webhook payloads into the canonical notification
 * (Konnet Credits Recharge TDR §10.2).
 *
 * The only place in the codebase that understands Paystack's wire shape. Pure, total, and
 * schema-validated: a malformed payload returns null rather than throwing, because the
 * controller must acknowledge every authenticated delivery.
 */

/** The event that means money actually landed on a user's dedicated account. */
export const CREDIT_EVENT = 'dedicated_account.credit';

/**
 * Assignment events are acknowledged and ignored.
 *
 * The platform learns its account details from its own provisioning call, so treating an
 * assignment notification as authoritative would add a second, racing source of truth.
 */
export const ASSIGNMENT_EVENTS = [
  'dedicated_account.assign.success',
  'dedicated_account.assign.failed',
  'dedicated_account.assignment',
] as const;

const creditPayloadSchema = z.object({
  event: z.string(),
  data: z.object({
    // Paystack sends a numeric id; coerced because the canonical model keys on a string.
    id: z.union([z.number(), z.string()]).transform((value) => String(value)),
    reference: z.string().min(1),
    amount: z.number().int().positive(),
    currency: z.string().default('NGN'),
    dedicated_account: z.object({
      account_number: z.string().min(1),
    }),
  }),
});

export type MappedPayload =
  | { readonly kind: 'credit'; readonly notification: PaymentNotificationInput }
  /** Recognised but not credit-bearing; acknowledge and move on. */
  | { readonly kind: 'ignored'; readonly eventType: string; readonly reason: string };

/**
 * Maps a webhook body, or explains why it was ignored.
 *
 * Returns a discriminated result rather than null so the controller can log *why* something was
 * skipped — an unrecognised event and a malformed one need different follow-up.
 */
export function mapWebhookToNotification(body: unknown): MappedPayload {
  const eventType = readEventType(body);

  if (eventType === null) {
    return { kind: 'ignored', eventType: 'unknown', reason: 'Payload has no event type' };
  }

  if ((ASSIGNMENT_EVENTS as readonly string[]).includes(eventType)) {
    return {
      kind: 'ignored',
      eventType,
      reason: 'Account assignment is handled by our own provisioning call',
    };
  }

  if (eventType !== CREDIT_EVENT) {
    return { kind: 'ignored', eventType, reason: 'Event does not credit a dedicated account' };
  }

  const parsed = creditPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return {
      kind: 'ignored',
      eventType,
      reason: `Malformed credit payload: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    };
  }

  const { data } = parsed.data;

  return {
    kind: 'credit',
    notification: {
      provider: 'paystack',
      eventType,
      eventId: data.id,
      providerReference: data.reference,
      accountNumber: data.dedicated_account.account_number,
      // Paystack reports in kobo; the platform stores minor units unchanged so nothing is
      // ever converted twice.
      amountKobo: data.amount,
      currency: data.currency,
    },
  };
}

function readEventType(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;

  const event = (body as Record<string, unknown>).event;

  return typeof event === 'string' && event.length > 0 ? event : null;
}
