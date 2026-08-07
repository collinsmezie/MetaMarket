/**
 * The payment provider contract (Konnet Credits Recharge TDR §8.3).
 *
 * The domain never imports a Paystack SDK or performs HTTP. Swapping provider means writing
 * one adapter, exactly as with the LLM and channel ports.
 */

export const PAYMENT_PROVIDER = Symbol('PaymentProvider');

export interface ProvisioningResult {
  readonly providerAccountId: string;
  readonly accountNumber: string;
  readonly accountName: string;
  readonly bankName: string;
  readonly providerReference: string;
  /** Provider customer code, cached on the wallet so it is created only once. */
  readonly customerCode: string;
}

export interface PaymentProviderPort {
  /**
   * Creates (or reuses) the customer and their dedicated virtual account.
   *
   * Must be idempotent for a given `customerReference`: a retried call has to return the same
   * account rather than minting a second one, because the business invariant is one permanent
   * account per user.
   */
  provisionDedicatedAccount(params: {
    customerReference: string;
    /** Cached provider customer code, when the wallet already has one. */
    existingCustomerCode?: string | null;
    displayName?: string;
  }): Promise<ProvisioningResult>;
}

/**
 * Raised when provisioning cannot be completed.
 *
 * Typed so {@link WalletService} can catch precisely this and degrade the recharge view to
 * `unavailable`, rather than letting a provider outage throw into a conversation turn.
 */
export class ProvisioningError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProvisioningError';
  }
}
