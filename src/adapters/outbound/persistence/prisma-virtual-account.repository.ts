import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { VirtualAccount, VirtualAccountStatus } from '../../../domain/models/credit';
import type { VirtualAccountRepositoryPort } from '../../../domain/ports/outbound/wallet-repository.port';
import { PrismaService } from './prisma.service';

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class PrismaVirtualAccountRepository implements VirtualAccountRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveByWalletId(walletId: string): Promise<VirtualAccount | null> {
    const row = await this.prisma.virtualAccount.findFirst({
      where: { walletId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });

    return row === null ? null : this.toDomain(row);
  }

  async findByAccountNumber(accountNumber: string): Promise<VirtualAccount | null> {
    const row = await this.prisma.virtualAccount.findUnique({ where: { accountNumber } });
    return row === null ? null : this.toDomain(row);
  }

  /**
   * Persists a provisioned account, adopting a concurrent provision rather than failing.
   *
   * Two simultaneous "Recharge" messages could both reach Paystack. Whichever write lands
   * first owns the account; the loser reads it back, so the user still ends up with exactly one
   * permanent account as the business invariant requires.
   */
  async create(params: {
    id: string;
    walletId: string;
    providerAccountId: string | null;
    accountNumber: string;
    accountName: string;
    bankName: string;
    providerReference: string | null;
  }): Promise<VirtualAccount> {
    try {
      const row = await this.prisma.virtualAccount.create({
        data: {
          id: params.id,
          walletId: params.walletId,
          providerAccountId: params.providerAccountId,
          accountNumber: params.accountNumber,
          accountName: params.accountName,
          bankName: params.bankName,
          providerReference: params.providerReference,
        },
      });

      return this.toDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        // Either the same account number or the same provisioning reference already landed.
        const existing =
          (await this.prisma.virtualAccount.findUnique({
            where: { accountNumber: params.accountNumber },
          })) ?? (await this.prisma.virtualAccount.findFirst({ where: { walletId: params.walletId } }));

        if (existing !== null) return this.toDomain(existing);
      }
      throw error;
    }
  }

  private toDomain(row: {
    id: string;
    walletId: string;
    provider: string;
    providerAccountId: string | null;
    accountNumber: string;
    accountName: string;
    bankName: string;
    providerReference: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): VirtualAccount {
    return {
      id: row.id,
      walletId: row.walletId,
      provider: row.provider,
      providerAccountId: row.providerAccountId,
      accountNumber: row.accountNumber,
      accountName: row.accountName,
      bankName: row.bankName,
      providerReference: row.providerReference,
      status: row.status as VirtualAccountStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
