import { Inject, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AppConfigService } from '../../config/app-config.service';
import type { PaymentNotification } from '../../domain/models/credit';
import {
  CREDIT_FAILURE_REASONS,
  MAX_NOTIFICATION_ATTEMPTS,
  toCredits,
  WalletEvents,
} from '../../domain/models/credit';
import type {
  HandlePaymentNotificationPort,
  HandlePaymentNotificationResult,
  PaymentNotificationInput,
} from '../../domain/ports/inbound/handle-payment-notification.port';
import {
  EVENT_PUBLISHER,
  type DomainEvent,
  type EventPublisherPort,
} from '../../domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import {
  PAYMENT_NOTIFICATION_REPOSITORY,
  VIRTUAL_ACCOUNT_REPOSITORY,
  WALLET_REPOSITORY,
  type PaymentNotificationRepositoryPort,
  type VirtualAccountRepositoryPort,
  type WalletRepositoryPort,
} from '../../domain/ports/outbound/wallet-repository.port';
import { WalletNotifier } from './wallet-notifier.service';

const COMPONENT = 'Wallet';
const STAGE = 'PaymentProcessor';

/** Notifications credited per sweep. */
const BATCH_SIZE = 20;

/** How often the backlog is swept, as a safety net behind the inline dispatch. */
const SWEEP_INTERVAL_MS = 10_000;

/** How long a `processing` row may sit before it is assumed abandoned and released. */
const STALE_CLAIM_MS = 5 * 60 * 1000;

/**
 * Converts payment notifications into credits, exactly once
 * (Konnet Credits Recharge TDR §9.2, §17, §18).
 *
 * Intake and crediting are separated on purpose. The webhook path does one write and returns,
 * so a slow database can never become a provider retry storm; crediting then happens off the
 * hot path, where it can afford to be careful. The same split the Evidence Service uses, for
 * the same reason: persist the raw fact first, interpret afterwards.
 */
@Injectable()
export class PaymentProcessor implements HandlePaymentNotificationPort {
  private sweeping = false;

  constructor(
    @Inject(PAYMENT_NOTIFICATION_REPOSITORY)
    private readonly notifications: PaymentNotificationRepositoryPort,
    @Inject(VIRTUAL_ACCOUNT_REPOSITORY) private readonly accounts: VirtualAccountRepositoryPort,
    @Inject(WALLET_REPOSITORY) private readonly wallets: WalletRepositoryPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly notifier: WalletNotifier,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Webhook intake — the only database write on the hot path.
   *
   * A duplicate delivery is a normal outcome, not an error: providers retry, and the unique
   * index on the event id is what stops a retry becoming a second credit.
   */
  async handle(input: PaymentNotificationInput): Promise<HandlePaymentNotificationResult> {
    const startedAt = Date.now();

    const { recorded } = await this.notifications.record({
      id: this.ids.uuid(),
      eventType: input.eventType,
      eventId: input.eventId,
      providerReference: input.providerReference,
      accountNumber: input.accountNumber,
      amountKobo: input.amountKobo,
      currency: input.currency,
    });

    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Intake`,
      input: {
        eventType: input.eventType,
        accountNumber: input.accountNumber,
        amountKobo: input.amountKobo,
      },
      action: recorded
        ? 'Recorded the payment notification for crediting'
        : 'Ignored a duplicate payment notification already recorded',
      output: { recorded, providerReference: input.providerReference },
      durationMs: Date.now() - startedAt,
    });

    if (!recorded) return { duplicate: true };

    // Credit promptly without making the webhook wait; the sweep is the durability backstop.
    void this.processPending().catch(() => undefined);

    return { duplicate: false };
  }

  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;

    try {
      // Recover anything a crashed worker left claimed before taking new work.
      const released = await this.notifications.releaseStale(
        new Date(this.clock.now().getTime() - STALE_CLAIM_MS),
        BATCH_SIZE,
      );

      if (released > 0) {
        this.logger.stage({
          component: COMPONENT,
          stage: `${STAGE}:Sweep`,
          input: { staleAfterMs: STALE_CLAIM_MS },
          action: 'Released abandoned notifications back for crediting',
          output: { released },
        });
      }

      await this.processPending();
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Sweep`,
        input: {},
        action: 'Payment sweep failed; will retry on the next interval',
        error,
      });
    } finally {
      this.sweeping = false;
    }
  }

  /** Claims and credits a batch. Exposed so tests can drain deterministically. */
  async processPending(): Promise<{ credited: number; duplicates: number; failed: number }> {
    const claimed = await this.notifications.claimNext(BATCH_SIZE);
    if (claimed.length === 0) return { credited: 0, duplicates: 0, failed: 0 };

    let credited = 0;
    let duplicates = 0;
    let failed = 0;

    for (const notification of claimed) {
      const outcome = await this.credit(notification);
      if (outcome === 'credited') credited += 1;
      else if (outcome === 'duplicate') duplicates += 1;
      else failed += 1;
    }

    return { credited, duplicates, failed };
  }

  /** Credits one notification, or records precisely why it could not be credited. */
  private async credit(notification: PaymentNotification): Promise<'credited' | 'duplicate' | 'failed'> {
    const startedAt = Date.now();

    try {
      // The wallet is resolved only from the account number the money arrived on, so nothing
      // in the payload can nominate a wallet (TDR §19).
      const account = await this.accounts.findByAccountNumber(notification.accountNumber);

      if (account === null) {
        return this.fail(notification, CREDIT_FAILURE_REASONS.unmatchedAccount, {
          accountNumber: notification.accountNumber,
        });
      }

      const wallet = await this.wallets.findById(account.walletId);

      if (wallet === null) {
        // The account exists but its wallet does not — reconcilable, never a phantom credit.
        return this.fail(notification, CREDIT_FAILURE_REASONS.unmatchedAccount, {
          accountNumber: notification.accountNumber,
          walletId: account.walletId,
        });
      }

      const { credits, remnantKobo } = toCredits(notification.amountKobo, this.config.credits.koboPerCredit);

      if (credits === 0) {
        // Below one credit. Recorded rather than silently swallowed: it is the user's money.
        return this.fail(notification, CREDIT_FAILURE_REASONS.belowMinimum, {
          amountKobo: notification.amountKobo,
          remnantKobo,
          koboPerCredit: this.config.credits.koboPerCredit,
        });
      }

      const result = await this.wallets.creditAtomically({
        transactionId: this.ids.uuid(),
        walletId: wallet.id,
        amountCredits: credits,
        amountKobo: notification.amountKobo,
        providerReference: notification.providerReference,
        eventId: notification.eventId,
        reason: notification.eventType,
        metadata: {
          remnantKobo,
          currency: notification.currency,
          koboPerCredit: this.config.credits.koboPerCredit,
        },
        notificationId: notification.id,
        at: this.clock.now(),
      });

      if (result.outcome === 'duplicate') {
        await this.notifications.markProcessed(notification.id, this.clock.now());

        this.logger.stage({
          component: COMPONENT,
          stage: STAGE,
          input: { providerReference: notification.providerReference },
          action: 'Payment was already credited by another delivery; no second credit applied',
          output: { duplicate: true },
        });

        return 'duplicate';
      }

      await this.events.publish(
        this.event(WalletEvents.Credited, wallet.conversationId, {
          walletId: wallet.id,
          userId: wallet.userId,
          credits,
          amountKobo: notification.amountKobo,
          balanceAfter: result.balanceAfter,
          providerReference: notification.providerReference,
        }),
      );

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: {
          accountNumber: notification.accountNumber,
          amountKobo: notification.amountKobo,
        },
        action: `Credited ${credits} credit(s) to the wallet`,
        output: { balanceAfter: result.balanceAfter, remnantKobo },
        durationMs: Date.now() - startedAt,
      });

      // Best-effort and deliberately last: the money is committed either way.
      await this.notifier.notifyCredited({
        userId: wallet.userId,
        conversationId: wallet.conversationId,
        credits,
        amountKobo: notification.amountKobo,
        balanceAfter: result.balanceAfter,
      });

      return 'credited';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Out of attempts: park it for human reconciliation rather than looping forever.
      if (notification.attempts >= MAX_NOTIFICATION_ATTEMPTS) {
        await this.fail(notification, CREDIT_FAILURE_REASONS.attemptsExhausted, { error: message });
        return 'failed';
      }

      // Leave it claimed; the stale-claim sweep will release it for another attempt.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { notificationId: notification.id, attempt: notification.attempts },
        action: 'Crediting failed; the notification will be retried by the sweep',
        error,
      });

      return 'failed';
    }
  }

  /** Records a terminal failure and publishes the reconciliation event. */
  private async fail(
    notification: PaymentNotification,
    reason: string,
    detail: Record<string, unknown>,
  ): Promise<'failed'> {
    await this.notifications.markFailed(notification.id, reason);

    await this.events.publish(
      this.event(WalletEvents.CreditFailed, undefined, {
        accountNumber: notification.accountNumber,
        providerReference: notification.providerReference,
        amountKobo: notification.amountKobo,
        reason,
        ...detail,
      }),
    );

    this.logger.stageFailed({
      component: COMPONENT,
      stage: STAGE,
      input: {
        accountNumber: notification.accountNumber,
        amountKobo: notification.amountKobo,
      },
      action: `Payment could not be credited (${reason}); recorded for reconciliation`,
      error: new Error(reason),
    });

    return 'failed';
  }

  private event(
    eventType: string,
    conversationId: string | undefined,
    payload: Record<string, unknown>,
  ): DomainEvent {
    return {
      eventId: this.ids.uuid(),
      eventType,
      timestamp: this.clock.now(),
      producer: 'PaymentProcessor',
      ...(conversationId !== undefined ? { conversationId } : {}),
      payload,
    };
  }
}
