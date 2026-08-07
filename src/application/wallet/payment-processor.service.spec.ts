import { RecordingEventPublisher, RecordingStageLogger, SequentialIdGenerator } from '@test/fakes';
import type { AppConfigService } from '../../config/app-config.service';
import type { PaymentNotification, VirtualAccount, Wallet } from '../../domain/models/credit';
import type {
  PaymentNotificationRepositoryPort,
  VirtualAccountRepositoryPort,
  WalletRepositoryPort,
} from '../../domain/ports/outbound/wallet-repository.port';
import { PaymentProcessor } from './payment-processor.service';
import type { WalletNotifier } from './wallet-notifier.service';

/**
 * Covers the failure table in the TDR (§17). Every row is a way real money can go wrong, so
 * each gets a test: nothing may crash, nothing may double-credit, and nothing may lose a
 * payment silently.
 */

const NOW = new Date('2026-08-07T10:00:00Z');
const KOBO_PER_CREDIT = 10_000; // ₦100

const wallet: Wallet = {
  id: 'wallet_1',
  userId: '+2348012345678',
  conversationId: 'conv_1',
  currency: 'NGN',
  balanceCredits: 18,
  providerCustomerCode: 'CUS_x',
  createdAt: NOW,
  updatedAt: NOW,
};

const account: VirtualAccount = {
  id: 'va_1',
  walletId: wallet.id,
  provider: 'paystack',
  providerAccountId: '1',
  accountNumber: '8134567892',
  accountName: 'konnet - Collins',
  bankName: 'Paystack-Titan',
  providerReference: 'ref_1',
  status: 'active',
  createdAt: NOW,
  updatedAt: NOW,
};

const notification = (overrides: Partial<PaymentNotification> = {}): PaymentNotification => ({
  id: 'notif_1',
  provider: 'paystack',
  eventType: 'dedicated_account.credit',
  eventId: 'evt_1',
  providerReference: 'trf_1',
  accountNumber: account.accountNumber,
  amountKobo: 500_000,
  currency: 'NGN',
  status: 'processing',
  attempts: 1,
  lastError: null,
  receivedAt: NOW,
  processedAt: null,
  ...overrides,
});

function build(
  options: {
    claimed?: readonly PaymentNotification[];
    accountLookup?: VirtualAccount | null;
    walletLookup?: Wallet | null;
    creditOutcome?: { outcome: 'credited'; balanceAfter: number } | { outcome: 'duplicate' };
    creditThrows?: Error;
    recordResult?: boolean;
  } = {},
) {
  const failures: { id: string; reason: string }[] = [];
  const processed: string[] = [];
  const notified: { credits: number; balanceAfter: number }[] = [];
  const recorded: unknown[] = [];

  const notifications: PaymentNotificationRepositoryPort = {
    async record(input) {
      recorded.push(input);
      const ok = options.recordResult ?? true;
      return { recorded: ok, notification: ok ? notification() : notification() };
    },
    async claimNext() {
      return options.claimed ?? [];
    },
    async markProcessed(id) {
      processed.push(id);
    },
    async markFailed(id, reason) {
      failures.push({ id, reason });
    },
    async releaseStale() {
      return 0;
    },
    async findById() {
      return null;
    },
  };

  const accounts: VirtualAccountRepositoryPort = {
    async findActiveByWalletId() {
      return null;
    },
    async findByAccountNumber() {
      return options.accountLookup === undefined ? account : options.accountLookup;
    },
    async create() {
      throw new Error('not used');
    },
  };

  const wallets: WalletRepositoryPort = {
    async findById() {
      return options.walletLookup === undefined ? wallet : options.walletLookup;
    },
    async findByUserId() {
      return wallet;
    },
    async create() {
      return wallet;
    },
    async updateProviderCustomerCode() {
      return wallet;
    },
    async debitAtomically() {
      throw new Error('crediting does not spend');
    },
    async grantAtomically() {
      throw new Error('crediting does not grant');
    },
    async creditAtomically() {
      if (options.creditThrows !== undefined) throw options.creditThrows;
      return options.creditOutcome ?? { outcome: 'credited', balanceAfter: 68 };
    },
  };

  const events = new RecordingEventPublisher();
  const logger = new RecordingStageLogger();

  const notifier = {
    async notifyCredited(params: { credits: number; balanceAfter: number }) {
      notified.push({ credits: params.credits, balanceAfter: params.balanceAfter });
    },
  } as unknown as WalletNotifier;

  const config = { credits: { nairaPerCredit: 100, koboPerCredit: KOBO_PER_CREDIT } } as AppConfigService;

  const processor = new PaymentProcessor(
    notifications,
    accounts,
    wallets,
    events,
    logger,
    { now: () => NOW },
    new SequentialIdGenerator(),
    notifier,
    config,
  );

  return { processor, events, logger, failures, processed, notified, recorded };
}

describe('PaymentProcessor intake', () => {
  it('records a new notification and reports it as fresh', async () => {
    const { processor, recorded } = build();

    const result = await processor.handle({
      provider: 'paystack',
      eventType: 'dedicated_account.credit',
      eventId: 'evt_1',
      providerReference: 'trf_1',
      accountNumber: account.accountNumber,
      amountKobo: 500_000,
      currency: 'NGN',
    });

    expect(result.duplicate).toBe(false);
    expect(recorded).toHaveLength(1);
  });

  it('reports a duplicate delivery without crediting again (E5)', async () => {
    const { processor } = build({ recordResult: false });

    const result = await processor.handle({
      provider: 'paystack',
      eventType: 'dedicated_account.credit',
      eventId: 'evt_1',
      providerReference: 'trf_1',
      accountNumber: account.accountNumber,
      amountKobo: 500_000,
      currency: 'NGN',
    });

    expect(result.duplicate).toBe(true);
  });
});

describe('PaymentProcessor crediting', () => {
  it('credits the wallet, publishes the event and confirms to the user', async () => {
    const { processor, events, notified } = build({ claimed: [notification()] });

    const result = await processor.processPending();

    expect(result).toEqual({ credited: 1, duplicates: 0, failed: 0 });
    expect(events.types()).toContain('wallet.credited');
    expect(notified).toEqual([{ credits: 50, balanceAfter: 68 }]);
  });

  it('treats a duplicate ledger insert as already credited (E6)', async () => {
    // The exactly-once guarantee: a replay loses the unique-constraint race and commits nothing.
    const { processor, events, notified, processed } = build({
      claimed: [notification()],
      creditOutcome: { outcome: 'duplicate' },
    });

    const result = await processor.processPending();

    expect(result.duplicates).toBe(1);
    expect(events.types()).not.toContain('wallet.credited');
    expect(notified).toHaveLength(0);
    expect(processed).toEqual(['notif_1']);
  });

  it('fails a payment to an unknown account without crashing (E7)', async () => {
    const { processor, events, failures } = build({
      claimed: [notification()],
      accountLookup: null,
    });

    const result = await processor.processPending();

    expect(result.failed).toBe(1);
    expect(failures[0].reason).toBe('unmatched_account');
    // Reconciliation surface rather than a lost payment.
    expect(events.types()).toContain('wallet.credit.failed');
  });

  it('fails rather than phantom-crediting when the wallet is gone (E13)', async () => {
    const { processor, failures } = build({ claimed: [notification()], walletLookup: null });

    await processor.processPending();

    expect(failures[0].reason).toBe('unmatched_account');
  });

  it('records an amount below one credit instead of swallowing it (E8)', async () => {
    const { processor, events, failures } = build({
      claimed: [notification({ amountKobo: 5_000 })], // ₦50 at ₦100/credit
    });

    await processor.processPending();

    expect(failures[0].reason).toBe('below_minimum');

    const failed = events.events.find((event) => event.eventType === 'wallet.credit.failed');
    // The user's money is recorded, not lost.
    expect((failed?.payload as Record<string, unknown>).remnantKobo).toBe(5_000);
  });

  it('leaves a transient failure for the sweep to retry (E9)', async () => {
    const { processor, failures } = build({
      claimed: [notification({ attempts: 1 })],
      creditThrows: new Error('database unavailable'),
    });

    const result = await processor.processPending();

    expect(result.failed).toBe(1);
    // Not dead-lettered yet: it still has attempts left.
    expect(failures).toHaveLength(0);
  });

  it('dead-letters once attempts are exhausted (E12)', async () => {
    const { processor, failures } = build({
      claimed: [notification({ attempts: 5 })],
      creditThrows: new Error('still failing'),
    });

    await processor.processPending();

    expect(failures[0].reason).toBe('attempts_exhausted');
  });

  it('does nothing when there is no backlog', async () => {
    const { processor } = build({ claimed: [] });

    expect(await processor.processPending()).toEqual({ credited: 0, duplicates: 0, failed: 0 });
  });

  it('floors a partial credit and records the remnant', async () => {
    const { processor, events, notified } = build({
      claimed: [notification({ amountKobo: 505_000 })], // ₦5,050
    });

    await processor.processPending();

    expect(notified[0].credits).toBe(50);

    const credited = events.events.find((event) => event.eventType === 'wallet.credited');
    expect((credited?.payload as Record<string, unknown>).credits).toBe(50);
  });

  it('credits each of several claimed notifications', async () => {
    const { processor } = build({
      claimed: [notification({ id: 'n1', eventId: 'e1' }), notification({ id: 'n2', eventId: 'e2' })],
    });

    expect((await processor.processPending()).credited).toBe(2);
  });
});
