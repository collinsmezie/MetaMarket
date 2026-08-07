import {
  InMemoryWalletRepository,
  RecordingEventPublisher,
  RecordingStageLogger,
  SequentialIdGenerator,
} from '@test/fakes';
import type { VirtualAccount, Wallet } from '../../domain/models/credit';
import type {
  PaymentProviderPort,
  ProvisioningResult,
} from '../../domain/ports/outbound/payment-provider.port';
import { ProvisioningError } from '../../domain/ports/outbound/payment-provider.port';
import type {
  VirtualAccountRepositoryPort,
  WalletRepositoryPort,
} from '../../domain/ports/outbound/wallet-repository.port';
import { WalletService } from './wallet.service';

const NOW = new Date('2026-08-07T10:00:00Z');

const baseWallet: Wallet = {
  id: 'wallet_1',
  userId: '+2348012345678',
  conversationId: 'conv_1',
  currency: 'NGN',
  balanceCredits: 18,
  providerCustomerCode: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const existingAccount: VirtualAccount = {
  id: 'va_1',
  walletId: baseWallet.id,
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

const provisioned: ProvisioningResult = {
  providerAccountId: '99',
  accountNumber: '9988776655',
  accountName: 'konnet - Collins',
  bankName: 'Wema Bank',
  providerReference: 'prov_ref',
  customerCode: 'CUS_new',
};

function build(
  options: {
    wallet?: Wallet | null;
    account?: VirtualAccount | null;
    provisionThrows?: Error;
  } = {},
) {
  const seed = options.wallet === undefined ? baseWallet : options.wallet;
  // Ledger-backed, so the exactly-once and never-negative guarantees are actually exercised
  // rather than stubbed away.
  const ledger = new InMemoryWalletRepository(seed === null ? [] : [seed]);
  const created: VirtualAccount[] = [];
  const provisionCalls: { customerReference: string; existingCustomerCode?: string | null }[] = [];
  let customerCodeUpdates = 0;

  const wallets: WalletRepositoryPort = {
    ...ledger,
    findById: ledger.findById.bind(ledger),
    findByUserId: ledger.findByUserId.bind(ledger),
    create: ledger.create.bind(ledger),
    async updateProviderCustomerCode(walletId, code) {
      customerCodeUpdates += 1;
      return ledger.updateProviderCustomerCode(walletId, code);
    },
    async creditAtomically() {
      return { outcome: 'credited', balanceAfter: 0 };
    },
    debitAtomically: ledger.debitAtomically.bind(ledger),
    grantAtomically: ledger.grantAtomically.bind(ledger),
  };

  const accounts: VirtualAccountRepositoryPort = {
    async findActiveByWalletId() {
      return options.account === undefined ? null : options.account;
    },
    async findByAccountNumber() {
      return null;
    },
    async create(params) {
      const account: VirtualAccount = { ...existingAccount, ...params, status: 'active' };
      created.push(account);
      return account;
    },
  };

  const provider: PaymentProviderPort = {
    async provisionDedicatedAccount(params) {
      provisionCalls.push(params);
      if (options.provisionThrows !== undefined) throw options.provisionThrows;
      return provisioned;
    },
  };

  const events = new RecordingEventPublisher();
  const logger = new RecordingStageLogger();

  const service = new WalletService(
    wallets,
    accounts,
    provider,
    events,
    logger,
    { now: () => NOW },
    new SequentialIdGenerator(),
  );

  return {
    service,
    events,
    logger,
    ledger,
    created,
    provisionCalls,
    getCustomerCodeUpdates: () => customerCodeUpdates,
  };
}

describe('WalletService.ensureWallet', () => {
  it('returns the existing wallet without creating another', async () => {
    const { service, events } = build();

    const wallet = await service.ensureWallet(baseWallet.userId, 'conv_1');

    expect(wallet.id).toBe(baseWallet.id);
    expect(events.types()).not.toContain('wallet.created');
  });

  it('creates a wallet on first contact and announces it', async () => {
    const { service, events } = build({ wallet: null });

    const wallet = await service.ensureWallet('+2348099999999', 'conv_2');

    expect(wallet.balanceCredits).toBe(0);
    expect(events.types()).toContain('wallet.created');
  });
});

describe('WalletService.getRechargeView', () => {
  it('reuses the persisted funding account rather than provisioning again', async () => {
    // The business invariant: one permanent account per user.
    const { service, provisionCalls } = build({ account: existingAccount });

    const view = await service.getRechargeView({ userId: baseWallet.userId, conversationId: 'conv_1' });

    expect(view).toEqual({
      status: 'ready',
      balanceCredits: 18,
      bankName: 'Paystack-Titan',
      accountNumber: '8134567892',
      accountName: 'konnet - Collins',
    });
    expect(provisionCalls).toHaveLength(0);
  });

  it('provisions once when no account exists yet', async () => {
    const { service, created, events, provisionCalls } = build({ account: null });

    const view = await service.getRechargeView({ userId: baseWallet.userId, conversationId: 'conv_1' });

    expect(view.status).toBe('ready');
    expect(provisionCalls).toHaveLength(1);
    expect(created[0].accountNumber).toBe('9988776655');
    expect(events.types()).toContain('wallet.funding_account.provisioned');
  });

  it('caches the provider customer code so a second customer is never created', async () => {
    const { service, getCustomerCodeUpdates } = build({ account: null });

    await service.getRechargeView({ userId: baseWallet.userId, conversationId: 'conv_1' });

    expect(getCustomerCodeUpdates()).toBe(1);
  });

  it('degrades to unavailable when provisioning fails, keeping the real balance (E1)', async () => {
    // A Paystack outage must not throw into the conversation turn: that would hand the user
    // the generic fallback envelope and lose their balance from the reply.
    const { service, logger } = build({
      account: null,
      provisionThrows: new ProvisioningError('Paystack timed out', true),
    });

    const view = await service.getRechargeView({ userId: baseWallet.userId, conversationId: 'conv_1' });

    expect(view).toEqual({ status: 'unavailable', balanceCredits: 18, reason: 'provisioning_failed' });
    expect(logger.failures.length).toBeGreaterThan(0);
  });

  it('degrades on an unexpected error too, not just a typed one', async () => {
    const { service } = build({ account: null, provisionThrows: new Error('socket hang up') });

    const view = await service.getRechargeView({ userId: baseWallet.userId, conversationId: 'conv_1' });

    expect(view.status).toBe('unavailable');
  });

  it('never throws out of the recharge view', async () => {
    const { service } = build({ account: null, provisionThrows: new Error('boom') });

    await expect(
      service.getRechargeView({ userId: baseWallet.userId, conversationId: 'conv_1' }),
    ).resolves.toBeDefined();
  });
});

/**
 * Spending (TDR §25.6). The rules that matter are the ones a vendor would notice: they are
 * never charged twice for one lead, never charged for something they cannot afford, and their
 * balance never goes below zero.
 */
describe('WalletService.debit', () => {
  const FEE = 100;
  const REFERENCE = 'delivery:req_1:vendor_1';

  const debit = (reference = REFERENCE, credits = FEE) => ({
    userId: baseWallet.userId,
    amountCredits: credits,
    reason: 'profile_delivered_to_customer',
    providerReference: reference,
    metadata: { requestId: 'req_1' },
  });

  it('debits a solvent wallet and announces it', async () => {
    const { service, events, ledger } = build({ wallet: { ...baseWallet, balanceCredits: 250 } });

    const result = await service.debit(debit());

    expect(result).toEqual({ outcome: 'debited', balanceAfter: 150 });
    expect(events.types()).toContain('wallet.debited');
    expect(ledger.wallets.get(baseWallet.id)?.balanceCredits).toBe(150);
  });

  it('refuses when the balance is below the fee, and reports the balance it refused on', async () => {
    // The vendor is told what they actually have, so the missed-lead message is not a guess.
    const { service, events } = build({ wallet: { ...baseWallet, balanceCredits: 40 } });

    const result = await service.debit(debit());

    expect(result).toEqual({ outcome: 'insufficient', balance: 40 });
    expect(events.types()).not.toContain('wallet.debited');
  });

  it('treats a vendor with no wallet as insolvent rather than creating one', async () => {
    // A read path must not mint state; the answer is the same either way.
    const { service, ledger } = build({ wallet: null });

    const result = await service.debit(debit());

    expect(result).toEqual({ outcome: 'insufficient', balance: 0 });
    expect(ledger.wallets.size).toBe(0);
  });

  it('charges once for one lead however many times the debit is retried', async () => {
    const { service, ledger } = build({ wallet: { ...baseWallet, balanceCredits: 250 } });

    await service.debit(debit());
    const retry = await service.debit(debit());

    expect(retry).toEqual({ outcome: 'duplicate' });
    expect(ledger.wallets.get(baseWallet.id)?.balanceCredits).toBe(150);
  });

  it('never lets a balance go negative, even when the fee is spent repeatedly', async () => {
    const { service, ledger } = build({ wallet: { ...baseWallet, balanceCredits: 150 } });

    await service.debit(debit('delivery:a'));
    await service.debit(debit('delivery:b'));
    await service.debit(debit('delivery:c'));

    expect(ledger.wallets.get(baseWallet.id)?.balanceCredits).toBe(50);
  });
});

describe('WalletService.grantOnboardingCredits', () => {
  const grant = (vendorId = 'vendor_1') => ({
    userId: '+2348099999999',
    conversationId: 'conv_9',
    vendorId,
    amountCredits: 2_000,
  });

  it('creates the wallet a brand-new vendor does not have yet, and funds it', async () => {
    // The grant is the wallet's second creation point: a vendor who has never recharged still
    // has to be solvent for their first lead.
    const { service, events } = build({ wallet: null });

    const result = await service.grantOnboardingCredits(grant());

    expect(result).toEqual({ outcome: 'credited', balanceAfter: 2_000 });
    expect(events.types()).toContain('wallet.created');
    expect(events.types()).toContain('wallet.onboarding_credited');
  });

  it('grants once no matter how many times seller.onboarded is redelivered', async () => {
    const { service, ledger } = build({ wallet: null });

    await service.grantOnboardingCredits(grant());
    const replay = await service.grantOnboardingCredits(grant());

    expect(replay).toEqual({ outcome: 'duplicate' });
    expect([...ledger.wallets.values()][0].balanceCredits).toBe(2_000);
  });

  it('keys the grant on the vendor, so two vendors are each funded', async () => {
    const { service, ledger } = build({ wallet: null });

    await service.grantOnboardingCredits(grant('vendor_1'));
    await service.grantOnboardingCredits({ ...grant('vendor_2'), userId: '+2348099999999' });

    // Same user in this contrived case, so the balance is the proof both grants landed.
    expect([...ledger.wallets.values()][0].balanceCredits).toBe(4_000);
  });
});
