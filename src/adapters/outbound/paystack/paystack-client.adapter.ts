import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { syntheticCustomerEmail } from '../../../domain/models/credit';
import type {
  PaymentProviderPort,
  ProvisioningResult,
} from '../../../domain/ports/outbound/payment-provider.port';
import { ProvisioningError } from '../../../domain/ports/outbound/payment-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';

const COMPONENT = 'Wallet';
const STAGE = 'PaystackAdapter';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 400;

/**
 * The bank Paystack should issue the dedicated account with.
 *
 * Wema is Paystack's standard DVA partner for Nigerian test and live accounts.
 */
const PREFERRED_BANK = 'wema-bank';

/**
 * Paystack implementation of {@link PaymentProviderPort} (Konnet Credits Recharge TDR §11).
 *
 * Owns every Paystack-specific detail: the two-step customer-then-account exchange, the wire
 * shapes, retry policy and error translation. Nothing above this file knows Paystack exists.
 */
@Injectable()
export class PaystackClientAdapter implements PaymentProviderPort {
  private readonly secretKey: string | undefined;
  private readonly apiBase: string;

  constructor(
    config: AppConfigService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {
    this.secretKey = config.paystack.secretKey;
    this.apiBase = config.paystack.apiBase;
  }

  isConfigured(): boolean {
    return this.secretKey !== undefined;
  }

  async provisionDedicatedAccount(params: {
    customerReference: string;
    existingCustomerCode?: string | null;
    displayName?: string;
  }): Promise<ProvisioningResult> {
    if (this.secretKey === undefined) {
      throw new ProvisioningError('PAYSTACK_SECRET_KEY is not configured', false);
    }

    const startedAt = Date.now();

    // Reuse the cached customer when the wallet already has one; creating a second customer
    // for the same person would let Paystack issue them a second account.
    const customerCode =
      params.existingCustomerCode ??
      (await this.ensureCustomer(params.customerReference, params.displayName));

    // Echoed to Paystack so a retried provisioning is recognisable rather than duplicated.
    const providerReference = randomUUID();

    const response = await this.request('/dedicated_account', {
      customer: customerCode,
      preferred_bank: PREFERRED_BANK,
      metadata: { userId: params.customerReference, reference: providerReference },
    });

    const account = this.readAccount(response);

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { customerReference: params.customerReference },
      action: 'Provisioned a dedicated virtual account via Paystack',
      output: {
        bankName: account.bankName,
        // The account number is the user's own funding detail, not a secret, and it is the
        // single most useful field when reconciling a payment.
        accountNumber: account.accountNumber,
        providerAccountId: account.providerAccountId,
      },
      durationMs: Date.now() - startedAt,
    });

    return { ...account, providerReference, customerCode };
  }

  /** Creates the Paystack customer, or reuses one Paystack already has for this email. */
  private async ensureCustomer(customerReference: string, displayName?: string): Promise<string> {
    const email = syntheticCustomerEmail(customerReference);

    const response = await this.request('/customer', {
      email,
      ...(displayName !== undefined && displayName.length > 0 ? { first_name: displayName } : {}),
      metadata: { userId: customerReference },
    });

    const code = this.readString(response, ['data', 'customer_code']);

    if (code === null) {
      throw new ProvisioningError('Paystack did not return a customer_code', false);
    }

    return code;
  }

  private readAccount(response: unknown): Omit<ProvisioningResult, 'providerReference' | 'customerCode'> {
    // Paystack returns the account either nested under `dedicated_account` or flattened,
    // depending on the endpoint version — accept both rather than breaking on a shape change.
    const accountNumber =
      this.readString(response, ['data', 'dedicated_account', 'account_number']) ??
      this.readString(response, ['data', 'account_number']);

    const accountName =
      this.readString(response, ['data', 'dedicated_account', 'account_name']) ??
      this.readString(response, ['data', 'account_name']);

    const bankName =
      this.readString(response, ['data', 'dedicated_account', 'bank', 'name']) ??
      this.readString(response, ['data', 'bank', 'name']);

    const providerAccountId =
      this.readString(response, ['data', 'dedicated_account', 'id']) ??
      this.readString(response, ['data', 'id']) ??
      '';

    if (accountNumber === null || accountName === null || bankName === null) {
      throw new ProvisioningError('Paystack response did not contain a usable dedicated account', false);
    }

    return { accountNumber, accountName, bankName, providerAccountId };
  }

  /**
   * POSTs to Paystack with bounded retries.
   *
   * 4xx responses are never retried: a rejected request will be rejected again, and retrying
   * only delays the graceful degradation the user is waiting on.
   */
  private async request(path: string, body: Record<string, unknown>): Promise<unknown> {
    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${this.apiBase}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

        if (response.ok) return payload;

        const message = typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`;

        // Client errors cannot heal; surface immediately.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new ProvisioningError(`Paystack ${path} rejected: ${message}`, false);
        }

        lastError = `Paystack ${path} ${response.status}: ${message}`;
      } catch (error) {
        if (error instanceof ProvisioningError) throw error;
        lastError = error instanceof Error ? error.message : String(error);
      }

      if (attempt < MAX_ATTEMPTS) {
        const delay = BACKOFF_BASE_MS * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * delay * 0.25));
      }
    }

    this.logger.stageFailed({
      component: COMPONENT,
      stage: STAGE,
      input: { path },
      action: `Paystack request failed after ${MAX_ATTEMPTS} attempts`,
      // `lastError` is a status/message only; the secret key is never included.
      error: new Error(lastError),
    });

    throw new ProvisioningError(lastError, true);
  }

  /** Reads a nested string without trusting the shape or reaching for `any`. */
  private readString(source: unknown, path: readonly string[]): string | null {
    let current: unknown = source;

    for (const key of path) {
      if (typeof current !== 'object' || current === null) return null;
      current = (current as Record<string, unknown>)[key];
    }

    if (typeof current === 'string' && current.length > 0) return current;
    if (typeof current === 'number') return String(current);

    return null;
  }
}
