import type {
  CreditFailureReason,
  PaymentNotification,
  VirtualAccount,
  Wallet,
  WalletDebitResult,
} from '../../models/credit';

/**
 * Persistence for the credits aggregate (Konnet Credits Recharge TDR §8.3).
 *
 * Every method that creates a uniquely-constrained row must tolerate losing a race and return
 * the persisted row instead of throwing. That is not defensive coding — it is how the
 * exactly-once guarantee is expressed: correctness comes from the database's unique indexes,
 * not from application-level checks that a concurrent worker could interleave with.
 */

export const WALLET_REPOSITORY = Symbol('WalletRepository');
export const VIRTUAL_ACCOUNT_REPOSITORY = Symbol('VirtualAccountRepository');
export const PAYMENT_NOTIFICATION_REPOSITORY = Symbol('PaymentNotificationRepository');

export interface WalletRepositoryPort {
  findById(id: string): Promise<Wallet | null>;

  findByUserId(userId: string): Promise<Wallet | null>;

  /** Creates the wallet, returning the existing row if a concurrent create won. */
  create(params: { id: string; userId: string; conversationId: string }): Promise<Wallet>;

  updateProviderCustomerCode(walletId: string, customerCode: string): Promise<Wallet>;

  /**
   * The exactly-once credit (TDR §18).
   *
   * The whole operation — ledger insert, balance increment, notification settle — happens
   * inside one database transaction owned by the adapter. It is a single port method rather
   * than three, so no transaction handle ever crosses the hexagonal boundary and no caller can
   * accidentally perform half of it.
   *
   * Returns `duplicate` when the ledger's unique `providerReference`/`eventId` already exists,
   * which is the signal that another delivery of the same payment already credited it.
   */
  creditAtomically(params: {
    transactionId: string;
    walletId: string;
    amountCredits: number;
    amountKobo: number;
    providerReference: string | null;
    eventId: string | null;
    reason: string;
    metadata: Readonly<Record<string, unknown>>;
    notificationId: string;
    at: Date;
  }): Promise<{ outcome: 'credited'; balanceAfter: number } | { outcome: 'duplicate' }>;

  /**
   * The exactly-once debit (TDR §25.5) — the mirror of `creditAtomically`.
   *
   * Same discipline: one adapter-owned transaction, the ledger's unique `providerReference` is
   * what makes a retry a no-op, and no transaction handle crosses the boundary.
   *
   * The never-negative invariant is a property of the database rather than of the caller: the
   * balance check and the decrement share a transaction with the wallet row locked, so no
   * interleaving can spend the same credits twice. A caller cannot get this wrong by forgetting
   * to check first, because checking first is not what makes it safe.
   */
  debitAtomically(params: {
    transactionId: string;
    walletId: string;
    amountCredits: number;
    /** Deterministic per billable event; this is the exactly-once key. */
    providerReference: string;
    reason: string;
    metadata: Readonly<Record<string, unknown>>;
    at: Date;
  }): Promise<WalletDebitResult>;

  /**
   * The exactly-once grant (TDR §25.12) — a credit with no payment behind it.
   *
   * Distinct from `creditAtomically` because there is no PaymentNotification to settle: a grant
   * is minted by the platform, not received from a bank. Same unique-reference guarantee, so a
   * redelivered `seller.onboarded` cannot hand out a second 2,000 credits.
   */
  grantAtomically(params: {
    transactionId: string;
    walletId: string;
    amountCredits: number;
    providerReference: string;
    reason: string;
    metadata: Readonly<Record<string, unknown>>;
    at: Date;
  }): Promise<{ outcome: 'credited'; balanceAfter: number } | { outcome: 'duplicate' }>;
}

export interface VirtualAccountRepositoryPort {
  findActiveByWalletId(walletId: string): Promise<VirtualAccount | null>;

  /** The only way a wallet is resolved during crediting; an attacker cannot name a wallet. */
  findByAccountNumber(accountNumber: string): Promise<VirtualAccount | null>;

  /** Creates the account, returning the persisted row if a concurrent provision won. */
  create(params: {
    id: string;
    walletId: string;
    providerAccountId: string | null;
    accountNumber: string;
    accountName: string;
    bankName: string;
    providerReference: string | null;
  }): Promise<VirtualAccount>;
}

export interface PaymentNotificationRepositoryPort {
  /**
   * Idempotent intake.
   *
   * Returns `recorded: false` when the event id or provider reference is already known — a
   * duplicate webhook delivery, which must never become a second credit.
   */
  record(input: {
    id: string;
    eventType: string;
    eventId: string;
    providerReference: string;
    accountNumber: string;
    amountKobo: number;
    currency: string;
  }): Promise<{ recorded: boolean; notification: PaymentNotification | null }>;

  /**
   * Atomically moves up to `batchSize` notifications from `received` to `processing`.
   *
   * The claim is what makes several workers safe: exactly one of them can transition a given
   * row, so a notification is credited by one worker only.
   */
  claimNext(batchSize: number): Promise<readonly PaymentNotification[]>;

  markProcessed(id: string, at: Date): Promise<void>;

  markFailed(id: string, reason: CreditFailureReason | string): Promise<void>;

  /** Returns a stuck `processing` row to `received` so the sweep can retry it after a crash. */
  releaseStale(olderThan: Date, limit: number): Promise<number>;

  findById(id: string): Promise<PaymentNotification | null>;
}
