import { Inject, Injectable } from '@nestjs/common';
import type { RechargeView, Wallet, WalletDebitResult } from '../../domain/models/credit';
import { ONBOARDING_GRANT_REASON, WalletEvents, onboardingGrantReference } from '../../domain/models/credit';
import {
  EVENT_PUBLISHER,
  type DomainEvent,
  type EventPublisherPort,
} from '../../domain/ports/outbound/event-publisher.port';
import {
  PAYMENT_PROVIDER,
  ProvisioningError,
  type PaymentProviderPort,
} from '../../domain/ports/outbound/payment-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import {
  VIRTUAL_ACCOUNT_REPOSITORY,
  WALLET_REPOSITORY,
  type VirtualAccountRepositoryPort,
  type WalletRepositoryPort,
} from '../../domain/ports/outbound/wallet-repository.port';

const COMPONENT = 'Wallet';
const STAGE = 'WalletService';

/**
 * Wallet and funding-account lifecycle (Konnet Credits Recharge TDR §9.1).
 *
 * Enforces the business invariant — one user, one wallet, one permanent virtual account — and
 * owns the decision of when to provision. Provisioning is lazy: an account is created the first
 * time a user actually asks to recharge, so onboarding never waits on Paystack and users who
 * never fund never cost an API call.
 */
@Injectable()
export class WalletService {
  constructor(
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepositoryPort,
    @Inject(VIRTUAL_ACCOUNT_REPOSITORY) private readonly accounts: VirtualAccountRepositoryPort,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProviderPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  /** Returns the user's wallet, creating it on first contact. Idempotent under concurrency. */
  async ensureWallet(userId: string, conversationId: string): Promise<Wallet> {
    const existing = await this.wallets.findByUserId(userId);
    if (existing !== null) return existing;

    const wallet = await this.wallets.create({
      id: this.ids.uuid(),
      userId,
      conversationId,
    });

    await this.publish({
      eventType: WalletEvents.Created,
      conversationId,
      payload: { userId, walletId: wallet.id },
    });

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { userId },
      action: 'Created a credit wallet on first contact',
      output: { walletId: wallet.id, balanceCredits: wallet.balanceCredits },
    });

    return wallet;
  }

  /**
   * Builds the recharge view: balance plus permanent funding-account details.
   *
   * A provider failure degrades to `unavailable` with the user's real balance rather than
   * throwing. The alternative — letting a Paystack outage propagate — would hand the user the
   * generic fallback envelope, which tells them nothing and loses their balance from the reply
   * (Execution.md §2.5).
   */
  async getRechargeView(params: { userId: string; conversationId: string }): Promise<RechargeView> {
    const startedAt = Date.now();
    const wallet = await this.ensureWallet(params.userId, params.conversationId);

    const existing = await this.accounts.findActiveByWalletId(wallet.id);

    if (existing !== null) {
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { userId: params.userId },
        action: 'Returned the existing funding account; no provisioning needed',
        output: { balanceCredits: wallet.balanceCredits, accountNumber: existing.accountNumber },
        durationMs: Date.now() - startedAt,
      });

      return {
        status: 'ready',
        balanceCredits: wallet.balanceCredits,
        bankName: existing.bankName,
        accountNumber: existing.accountNumber,
        accountName: existing.accountName,
      };
    }

    try {
      const provisioned = await this.provider.provisionDedicatedAccount({
        customerReference: wallet.userId,
        existingCustomerCode: wallet.providerCustomerCode,
      });

      // Cache the customer code so a later provisioning never creates a second customer.
      if (wallet.providerCustomerCode === null && provisioned.customerCode.length > 0) {
        await this.wallets.updateProviderCustomerCode(wallet.id, provisioned.customerCode);
      }

      const account = await this.accounts.create({
        id: this.ids.uuid(),
        walletId: wallet.id,
        providerAccountId: provisioned.providerAccountId,
        accountNumber: provisioned.accountNumber,
        accountName: provisioned.accountName,
        bankName: provisioned.bankName,
        providerReference: provisioned.providerReference,
      });

      await this.publish({
        eventType: WalletEvents.FundingAccountProvisioned,
        conversationId: params.conversationId,
        payload: {
          walletId: wallet.id,
          userId: wallet.userId,
          accountNumber: account.accountNumber,
          bankName: account.bankName,
        },
      });

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { userId: params.userId },
        action: 'Provisioned and persisted the permanent funding account',
        output: { accountNumber: account.accountNumber, bankName: account.bankName },
        durationMs: Date.now() - startedAt,
      });

      return {
        status: 'ready',
        balanceCredits: wallet.balanceCredits,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
      };
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { userId: params.userId },
        action:
          error instanceof ProvisioningError
            ? 'Funding account provisioning failed; showing the balance and asking the user to retry'
            : 'Unexpected failure while provisioning; degrading to the unavailable view',
        error,
        durationMs: Date.now() - startedAt,
      });

      // Deliberately not retried inline: the next "Recharge" turn tries again, and holding the
      // conversation open while Paystack is down helps nobody.
      return { status: 'unavailable', balanceCredits: wallet.balanceCredits, reason: 'provisioning_failed' };
    }
  }

  async getBalance(userId: string): Promise<number> {
    const wallet = await this.wallets.findByUserId(userId);
    return wallet?.balanceCredits ?? 0;
  }

  /**
   * Spends credits (TDR §25.6).
   *
   * Deliberately does no balance pre-check. `debitAtomically` answers "can they pay?" and "take
   * the payment" in the same locked transaction, so a check here could only be a second opinion
   * formed before the lock — one that a concurrent debit or recharge can invalidate before it is
   * acted on. The caller branches on the result instead, and `insufficient` carries the balance
   * the refusal was actually based on.
   *
   * Returns the raw outcome rather than a boolean: `duplicate` means the caller's work was
   * already paid for and must proceed, which is the opposite of `insufficient`.
   */
  async debit(params: {
    userId: string;
    amountCredits: number;
    reason: string;
    providerReference: string;
    metadata: Readonly<Record<string, unknown>>;
  }): Promise<WalletDebitResult> {
    const wallet = await this.wallets.findByUserId(params.userId);

    // No wallet means the vendor has never recharged and never been granted anything. Creating
    // one here would be a write on a read path that cannot change the answer.
    if (wallet === null) return { outcome: 'insufficient', balance: 0 };

    const result = await this.wallets.debitAtomically({
      transactionId: this.ids.uuid(),
      walletId: wallet.id,
      amountCredits: params.amountCredits,
      providerReference: params.providerReference,
      reason: params.reason,
      metadata: params.metadata,
      at: this.clock.now(),
    });

    if (result.outcome === 'debited') {
      await this.publish({
        eventType: WalletEvents.Debited,
        conversationId: wallet.conversationId,
        payload: {
          walletId: wallet.id,
          userId: wallet.userId,
          credits: params.amountCredits,
          balanceAfter: result.balanceAfter,
          reason: params.reason,
          providerReference: params.providerReference,
          ...params.metadata,
        },
      });
    }

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: {
        userId: params.userId,
        credits: params.amountCredits,
        reason: params.reason,
        reference: params.providerReference,
      },
      action:
        result.outcome === 'debited'
          ? 'Debited the visibility fee'
          : result.outcome === 'insufficient'
            ? 'Refused the debit: the balance is below the fee'
            : 'Debit already recorded for this reference; no second charge',
      output: result,
    });

    return result;
  }

  /**
   * Grants a newly onboarded vendor their starting credits (TDR §25.12).
   *
   * This is the wallet's second creation point. A brand-new vendor has never recharged, so there
   * is nothing to find — the wallet is materialised here so the grant has somewhere to land, and
   * the vendor is solvent for their first leads without ever seeing a payment screen.
   *
   * Idempotent by the ledger, not by a flag: `onboarding:<vendorId>` is unique, so however many
   * times `seller.onboarded` is redelivered, exactly one grant exists.
   */
  async grantOnboardingCredits(params: {
    userId: string;
    conversationId: string;
    vendorId: string;
    amountCredits: number;
  }): Promise<{ outcome: 'credited'; balanceAfter: number } | { outcome: 'duplicate' }> {
    const wallet = await this.ensureWallet(params.userId, params.conversationId);
    const providerReference = onboardingGrantReference(params.vendorId);

    const result = await this.wallets.grantAtomically({
      transactionId: this.ids.uuid(),
      walletId: wallet.id,
      amountCredits: params.amountCredits,
      providerReference,
      reason: ONBOARDING_GRANT_REASON,
      metadata: { grant: 'onboarding', triggeredBy: 'seller.onboarded', vendorId: params.vendorId },
      at: this.clock.now(),
    });

    if (result.outcome === 'credited') {
      await this.publish({
        eventType: WalletEvents.OnboardingCredited,
        conversationId: params.conversationId,
        payload: {
          walletId: wallet.id,
          userId: wallet.userId,
          credits: params.amountCredits,
          balanceAfter: result.balanceAfter,
          providerReference,
        },
      });
    }

    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:OnboardingGrant`,
      input: { userId: params.userId, vendorId: params.vendorId, credits: params.amountCredits },
      action:
        result.outcome === 'credited'
          ? 'Granted the onboarding credits'
          : 'Onboarding grant already given for this vendor; ignored the redelivery',
      output: result,
    });

    return result;
  }

  private async publish(params: {
    eventType: string;
    conversationId?: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const event: DomainEvent = {
      eventId: this.ids.uuid(),
      eventType: params.eventType,
      timestamp: this.clock.now(),
      producer: 'WalletService',
      ...(params.conversationId !== undefined ? { conversationId: params.conversationId } : {}),
      payload: params.payload,
    };

    await this.events.publish(event);
  }
}
