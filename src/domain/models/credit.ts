/**
 * Credits, wallets and funding (Konnet Credits Recharge TDR §8).
 *
 * The business invariant the whole feature rests on:
 *
 *   One User → One Konnet Account → One Permanent Virtual Account → One Credit Wallet
 *
 * Money is involved, so the rules here are deliberately unforgiving: conversion always floors,
 * the remnant is never discarded silently, and nothing in this file can throw.
 */

export interface CreditConversionResult {
  readonly credits: number;
  /**
   * `amountKobo % koboPerCredit`.
   *
   * Recorded rather than dropped: it is the user's money. It is written to the transaction
   * metadata and surfaced in logs so reconciliation can see exactly what was not converted.
   */
  readonly remnantKobo: number;
}

/**
 * Converts a received amount into whole credits.
 *
 * Total by construction — no input produces an exception, because this sits on the payment
 * webhook path where a throw would turn a received payment into a retry storm. Invalid or
 * nonsensical inputs yield zero credits, which the caller reports as `below_minimum` rather
 * than crediting something it cannot justify.
 *
 * Floors deliberately: a fractional credit cannot exist, and rounding up would let a user
 * mint value from rounding.
 */
export function toCredits(amountKobo: number, koboPerCredit: number): CreditConversionResult {
  const safeKobo = Number.isFinite(amountKobo) && amountKobo > 0 ? Math.floor(amountKobo) : 0;
  const safeRate = Number.isFinite(koboPerCredit) && koboPerCredit > 0 ? Math.floor(koboPerCredit) : 0;

  if (safeKobo === 0 || safeRate === 0) return { credits: 0, remnantKobo: 0 };

  return { credits: Math.floor(safeKobo / safeRate), remnantKobo: safeKobo % safeRate };
}

export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

/** Formats kobo as Naira for user-facing copy, e.g. 500000 → "₦5,000". */
export function koboToNairaLabel(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

export interface Wallet {
  readonly id: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly currency: string;
  readonly balanceCredits: number;
  readonly providerCustomerCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const VIRTUAL_ACCOUNT_STATUSES = ['active', 'failed', 'deactivated'] as const;

export type VirtualAccountStatus = (typeof VIRTUAL_ACCOUNT_STATUSES)[number];

export interface VirtualAccount {
  readonly id: string;
  readonly walletId: string;
  readonly provider: string;
  readonly providerAccountId: string | null;
  readonly accountNumber: string;
  readonly accountName: string;
  readonly bankName: string;
  readonly providerReference: string | null;
  readonly status: VirtualAccountStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const PAYMENT_NOTIFICATION_STATUSES = ['received', 'processing', 'credited', 'failed'] as const;

export type PaymentNotificationStatus = (typeof PAYMENT_NOTIFICATION_STATUSES)[number];

export interface PaymentNotification {
  readonly id: string;
  readonly provider: string;
  readonly eventType: string;
  readonly eventId: string;
  readonly providerReference: string;
  readonly accountNumber: string;
  readonly amountKobo: number;
  readonly currency: string;
  readonly status: PaymentNotificationStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

/**
 * Attempts before a notification is parked for human reconciliation.
 *
 * Retrying forever would turn one poisonous notification into a permanent hot loop that
 * starves healthy ones behind it (Execution.md §2.5).
 */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

/** Reasons a notification can fail, each a reconciliation surface rather than a lost payment. */
export const CREDIT_FAILURE_REASONS = {
  unmatchedAccount: 'unmatched_account',
  belowMinimum: 'below_minimum',
  attemptsExhausted: 'attempts_exhausted',
} as const;

export type CreditFailureReason = (typeof CREDIT_FAILURE_REASONS)[keyof typeof CREDIT_FAILURE_REASONS];

/**
 * The view behind the "Recharge" conversation turn.
 *
 * `unavailable` exists so a Paystack outage degrades into an honest sentence with the user's
 * real balance, rather than a fallback envelope or silence (Execution.md §2.5).
 */
export type RechargeView =
  | {
      readonly status: 'ready';
      readonly balanceCredits: number;
      readonly bankName: string;
      readonly accountNumber: string;
      readonly accountName: string;
    }
  | {
      readonly status: 'unavailable';
      readonly balanceCredits: number;
      readonly reason: 'provisioning_failed';
    };

/** Event names published by the wallet feature (TDR §14, §25.3). */
export const WalletEvents = {
  Created: 'wallet.created',
  FundingAccountProvisioned: 'wallet.funding_account.provisioned',
  Credited: 'wallet.credited',
  CreditFailed: 'wallet.credit.failed',
  Debited: 'wallet.debited',
  DebitInsufficient: 'wallet.debit.insufficient',
  DebitFailed: 'wallet.debit.failed',
  OnboardingCredited: 'wallet.onboarding_credited',
} as const;

/**
 * Reasons a credit is spent (TDR §25.3).
 *
 * Both are the same product — paid visibility — reached two ways: the platform pushed the
 * vendor's profile to a customer, or the vendor earned it by answering a fanned-out request.
 */
export const WALLET_DEBIT_REASONS = {
  /** Immediate delivery — the top-ranked vendor's profile went straight to the customer. */
  profileDelivery: 'profile_delivered_to_customer',
  /** A fanned-out vendor accepted the request and is about to become visible. */
  responseAccepted: 'responded_to_customer_request',
} as const;

export type WalletDebitReason = (typeof WALLET_DEBIT_REASONS)[keyof typeof WALLET_DEBIT_REASONS];

/** Reason recorded on the one-time grant every onboarded vendor receives (TDR §25.12). */
export const ONBOARDING_GRANT_REASON = 'onboarding_grant';

/**
 * The outcome of spending credits.
 *
 * `insufficient` carries the balance because the caller has to tell the vendor what they
 * actually have; re-reading it afterwards would race with a concurrent recharge and report a
 * number that was never the reason for the refusal.
 */
export type WalletDebitResult =
  | { readonly outcome: 'debited'; readonly balanceAfter: number }
  | { readonly outcome: 'insufficient'; readonly balance: number }
  | { readonly outcome: 'duplicate' };

/** The ledger key that makes an immediate delivery billable exactly once (TDR §25.6). */
export function deliveryDebitReference(requestId: string, vendorId: string): string {
  return `delivery:${requestId}:${vendorId}`;
}

/** The ledger key that makes an accepted response billable exactly once (TDR §25.6). */
export function responseDebitReference(requestId: string, vendorId: string): string {
  return `response:${requestId}:${vendorId}`;
}

/** The ledger key that makes the onboarding grant given exactly once (TDR §25.12). */
export function onboardingGrantReference(vendorId: string): string {
  return `onboarding:${vendorId}`;
}

/**
 * Deterministic synthetic email for a Paystack customer (TDR §19).
 *
 * Paystack requires an email; the platform only has an E.164 number. Deriving it from the
 * digits makes customer creation idempotent — the same user always maps to the same customer,
 * so a retried provisioning cannot create a second one.
 */
export function syntheticCustomerEmail(userId: string, domain = 'konnet.ng'): string {
  const digits = userId.replace(/\D/g, '');
  return `${digits.length > 0 ? digits : 'unknown'}@${domain}`;
}
