/**
 * The entry point payment webhooks call (Konnet Credits Recharge TDR §8.4).
 *
 * Mirrors {@link HandleIncomingMessagePort}: the inbound adapter maps a provider payload to
 * this canonical shape and knows nothing about wallets, crediting or idempotency.
 */

export const HANDLE_PAYMENT_NOTIFICATION = Symbol('HandlePaymentNotification');

export interface PaymentNotificationInput {
  readonly provider: 'paystack';
  readonly eventType: string;
  readonly eventId: string;
  readonly providerReference: string;
  readonly accountNumber: string;
  readonly amountKobo: number;
  readonly currency: string;
}

export interface HandlePaymentNotificationResult {
  /**
   * True when this delivery duplicated an event already recorded.
   *
   * A normal outcome, not an error: providers retry, and the platform must acknowledge without
   * crediting twice.
   */
  readonly duplicate: boolean;
}

export interface HandlePaymentNotificationPort {
  handle(notification: PaymentNotificationInput): Promise<HandlePaymentNotificationResult>;
}
