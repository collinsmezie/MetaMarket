import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Wallet, WalletDebitResult } from '../../../domain/models/credit';
import type { WalletRepositoryPort } from '../../../domain/ports/outbound/wallet-repository.port';
import { PrismaService } from './prisma.service';

/** Prisma's unique-constraint violation. The mechanism behind exactly-once crediting. */
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class PrismaWalletRepository implements WalletRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Wallet | null> {
    const row = await this.prisma.creditWallet.findUnique({ where: { id } });
    return row === null ? null : this.toDomain(row);
  }

  async findByUserId(userId: string): Promise<Wallet | null> {
    const row = await this.prisma.creditWallet.findUnique({ where: { userId } });
    return row === null ? null : this.toDomain(row);
  }

  /**
   * Creates the wallet, adopting a concurrent create rather than failing.
   *
   * Two messages from the same user can land on two pods simultaneously; the unique index on
   * `userId` is the arbiter and the loser reads what the winner wrote.
   */
  async create(params: { id: string; userId: string; conversationId: string }): Promise<Wallet> {
    try {
      const row = await this.prisma.creditWallet.create({
        data: { id: params.id, userId: params.userId, conversationId: params.conversationId },
      });
      return this.toDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        const existing = await this.prisma.creditWallet.findUniqueOrThrow({
          where: { userId: params.userId },
        });
        return this.toDomain(existing);
      }
      throw error;
    }
  }

  async updateProviderCustomerCode(walletId: string, customerCode: string): Promise<Wallet> {
    const row = await this.prisma.creditWallet.update({
      where: { id: walletId },
      data: { providerCustomerCode: customerCode },
    });
    return this.toDomain(row);
  }

  /**
   * Exactly-once crediting (TDR §18).
   *
   * The ordering inside the transaction is the correctness argument, not an implementation
   * detail:
   *
   *  1. Lock the wallet row (`FOR UPDATE`). Two *different* payments to the same wallet then
   *     serialise, so the balance stays arithmetically consistent under any interleaving.
   *  2. Insert the ledger row **first**. Its unique `providerReference`/`eventId` is what makes
   *     the operation exactly-once: a concurrent duplicate loses here and commits nothing.
   *  3. Only then increment the balance and settle the notification.
   *
   * Because the unique constraint guards the money row rather than the notification row, a
   * crash anywhere after step 2 is safe to replay — the replay's insert fails and the balance
   * is never incremented twice.
   */
  async creditAtomically(params: {
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
  }): Promise<{ outcome: 'credited'; balanceAfter: number } | { outcome: 'duplicate' }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialises concurrent credits to the same wallet.
        await tx.$queryRaw`SELECT id FROM credit_wallets WHERE id = ${params.walletId}::uuid FOR UPDATE`;

        await tx.creditTransaction.create({
          data: {
            id: params.transactionId,
            walletId: params.walletId,
            type: 'credit',
            amountCredits: params.amountCredits,
            amountKobo: params.amountKobo,
            providerReference: params.providerReference,
            eventId: params.eventId,
            reason: params.reason,
            metadata: params.metadata as Prisma.InputJsonValue,
          },
        });

        const wallet = await tx.creditWallet.update({
          where: { id: params.walletId },
          data: { balanceCredits: { increment: params.amountCredits } },
        });

        await tx.paymentNotification.update({
          where: { id: params.notificationId },
          data: { status: 'credited', processedAt: params.at, lastError: null },
        });

        return { outcome: 'credited' as const, balanceAfter: wallet.balanceCredits };
      });
    } catch (error) {
      // The duplicate path: another delivery of this same payment already credited it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        return { outcome: 'duplicate' };
      }
      throw error;
    }
  }

  /**
   * Exactly-once debiting (TDR §25.5).
   *
   * The same three-step argument as `creditAtomically`, with the balance check folded inside the
   * lock:
   *
   *  1. Lock the wallet row. Concurrent debits to the same wallet serialise, so two leads cannot
   *     both read a balance of 100 and both spend it.
   *  2. Refuse if the balance is short — inside the transaction, so the answer cannot go stale
   *     between the check and the decrement. This is why the balance can never go negative: it
   *     is a database property, not a caller's discipline.
   *  3. Insert the ledger row before decrementing, so a retried debit loses on the unique
   *     `providerReference` and commits nothing.
   */
  async debitAtomically(params: {
    transactionId: string;
    walletId: string;
    amountCredits: number;
    providerReference: string;
    reason: string;
    metadata: Readonly<Record<string, unknown>>;
    at: Date;
  }): Promise<WalletDebitResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ balance_credits: number }[]>`
          SELECT balance_credits FROM credit_wallets WHERE id = ${params.walletId}::uuid FOR UPDATE
        `;

        const balance = locked[0]?.balance_credits ?? 0;

        if (balance < params.amountCredits) {
          return { outcome: 'insufficient' as const, balance };
        }

        await tx.creditTransaction.create({
          data: {
            id: params.transactionId,
            walletId: params.walletId,
            type: 'debit',
            amountCredits: params.amountCredits,
            // No Naira moved; see the schema comment on the column.
            amountKobo: null,
            providerReference: params.providerReference,
            eventId: null,
            reason: params.reason,
            metadata: params.metadata as Prisma.InputJsonValue,
          },
        });

        const wallet = await tx.creditWallet.update({
          where: { id: params.walletId },
          data: { balanceCredits: { decrement: params.amountCredits } },
        });

        return { outcome: 'debited' as const, balanceAfter: wallet.balanceCredits };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        return { outcome: 'duplicate' };
      }
      throw error;
    }
  }

  /**
   * The onboarding grant (TDR §25.12): a credit the platform mints rather than receives.
   *
   * Identical ordering to `creditAtomically` minus the notification settle, because there is no
   * payment to settle. The unique `providerReference` (`onboarding:<vendorId>`) is what makes a
   * redelivered `seller.onboarded` a no-op instead of a second 2,000 credits.
   */
  async grantAtomically(params: {
    transactionId: string;
    walletId: string;
    amountCredits: number;
    providerReference: string;
    reason: string;
    metadata: Readonly<Record<string, unknown>>;
    at: Date;
  }): Promise<{ outcome: 'credited'; balanceAfter: number } | { outcome: 'duplicate' }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM credit_wallets WHERE id = ${params.walletId}::uuid FOR UPDATE`;

        await tx.creditTransaction.create({
          data: {
            id: params.transactionId,
            walletId: params.walletId,
            type: 'credit',
            amountCredits: params.amountCredits,
            amountKobo: null,
            providerReference: params.providerReference,
            eventId: null,
            reason: params.reason,
            metadata: params.metadata as Prisma.InputJsonValue,
          },
        });

        const wallet = await tx.creditWallet.update({
          where: { id: params.walletId },
          data: { balanceCredits: { increment: params.amountCredits } },
        });

        return { outcome: 'credited' as const, balanceAfter: wallet.balanceCredits };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        return { outcome: 'duplicate' };
      }
      throw error;
    }
  }

  private toDomain(row: {
    id: string;
    userId: string;
    conversationId: string;
    currency: string;
    balanceCredits: number;
    providerCustomerCode: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Wallet {
    return {
      id: row.id,
      userId: row.userId,
      conversationId: row.conversationId,
      currency: row.currency,
      balanceCredits: row.balanceCredits,
      providerCustomerCode: row.providerCustomerCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
