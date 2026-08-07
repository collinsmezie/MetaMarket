import { RecordingEventPublisher, RecordingStageLogger, SequentialIdGenerator } from '@test/fakes';
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
  let stored: Wallet | null = options.wallet === undefined ? baseWallet : options.wallet;
  const created: VirtualAccount[] = [];
  const provisionCalls: { customerReference: string; existingCustomerCode?: string | null }[] = [];
  let customerCodeUpdates = 0;

  const wallets: WalletRepositoryPort = {
    async findById() {
      return stored;
    },
    async findByUserId() {
      return stored;
    },
    async create(params) {
      stored = { ...baseWallet, id: params.id, userId: params.userId, balanceCredits: 0 };
      return stored;
    },
    async updateProviderCustomerCode(_walletId, code) {
      customerCodeUpdates += 1;
      stored = { ...(stored as Wallet), providerCustomerCode: code };
      return stored;
    },
    async creditAtomically() {
      return { outcome: 'credited', balanceAfter: 0 };
    },
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
