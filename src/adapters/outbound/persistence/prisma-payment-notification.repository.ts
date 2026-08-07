import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaymentNotification, PaymentNotificationStatus } from '../../../domain/models/credit';
import type { PaymentNotificationRepositoryPort } from '../../../domain/ports/outbound/wallet-repository.port';
import { PrismaService } from './prisma.service';

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class PrismaPaymentNotificationRepository implements PaymentNotificationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent intake — the first line of defence against double-crediting.
   *
   * Relies on the unique indexes on `eventId` and `providerReference` rather than a preceding
   * read, so two concurrent deliveries of the same payment cannot both be recorded.
   */
  async record(input: {
    id: string;
    eventType: string;
    eventId: string;
    providerReference: string;
    accountNumber: string;
    amountKobo: number;
    currency: string;
  }): Promise<{ recorded: boolean; notification: PaymentNotification | null }> {
    try {
      const row = await this.prisma.paymentNotification.create({
        data: {
          id: input.id,
          eventType: input.eventType,
          eventId: input.eventId,
          providerReference: input.providerReference,
          accountNumber: input.accountNumber,
          amountKobo: input.amountKobo,
          currency: input.currency,
        },
      });

      return { recorded: true, notification: this.toDomain(row) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        const existing = await this.prisma.paymentNotification.findFirst({
          where: {
            OR: [{ eventId: input.eventId }, { providerReference: input.providerReference }],
          },
        });

        return { recorded: false, notification: existing === null ? null : this.toDomain(existing) };
      }
      throw error;
    }
  }

  /**
   * Atomically claims a batch for processing.
   *
   * A single `UPDATE ... RETURNING` over a `FOR UPDATE SKIP LOCKED` subquery — the standard
   * Postgres work-queue claim. Both halves matter:
   *
   *  - `SKIP LOCKED` makes concurrent workers take *disjoint* rows rather than contending for
   *    the same one.
   *  - `RETURNING` yields exactly the rows this statement transitioned, so a worker can never
   *    be handed a row another worker claimed.
   *
   * A read-then-update-then-read sequence looks equivalent and is not: between the update and
   * the re-read, both workers see the row as `processing` and both proceed. The unique index
   * on the ledger would still prevent a double credit, but two workers would duplicate the
   * work and race on the notification's status.
   */
  async claimNext(batchSize: number): Promise<readonly PaymentNotification[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        provider: string;
        event_type: string;
        event_id: string;
        provider_reference: string;
        account_number: string;
        amount_kobo: number;
        currency: string;
        status: string;
        attempts: number;
        last_error: string | null;
        received_at: Date;
        processed_at: Date | null;
      }[]
    >`
      UPDATE payment_notifications
      SET status = 'processing', attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM payment_notifications
        WHERE status = 'received'
        ORDER BY received_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, provider, event_type, event_id, provider_reference, account_number,
                amount_kobo, currency, status, attempts, last_error, received_at, processed_at
    `;

    return rows.map((row) =>
      this.toDomain({
        id: row.id,
        provider: row.provider,
        eventType: row.event_type,
        eventId: row.event_id,
        providerReference: row.provider_reference,
        accountNumber: row.account_number,
        amountKobo: row.amount_kobo,
        currency: row.currency,
        status: row.status,
        attempts: row.attempts,
        lastError: row.last_error,
        receivedAt: row.received_at,
        processedAt: row.processed_at,
      }),
    );
  }

  async markProcessed(id: string, at: Date): Promise<void> {
    await this.prisma.paymentNotification.update({
      where: { id },
      data: { status: 'credited', processedAt: at, lastError: null },
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.prisma.paymentNotification.update({
      where: { id },
      data: { status: 'failed', lastError: reason, processedAt: new Date() },
    });
  }

  /**
   * Returns notifications stuck in `processing` to `received`.
   *
   * A worker that crashed mid-credit would otherwise leave the payment permanently claimed and
   * never credited. The idempotency keys make the retry safe.
   */
  async releaseStale(olderThan: Date, limit: number): Promise<number> {
    const stale = await this.prisma.paymentNotification.findMany({
      where: { status: 'processing', receivedAt: { lte: olderThan } },
      take: limit,
      select: { id: true },
    });

    if (stale.length === 0) return 0;

    const result = await this.prisma.paymentNotification.updateMany({
      where: { id: { in: stale.map((row) => row.id) }, status: 'processing' },
      data: { status: 'received' },
    });

    return result.count;
  }

  async findById(id: string): Promise<PaymentNotification | null> {
    const row = await this.prisma.paymentNotification.findUnique({ where: { id } });
    return row === null ? null : this.toDomain(row);
  }

  private toDomain(row: {
    id: string;
    provider: string;
    eventType: string;
    eventId: string;
    providerReference: string;
    accountNumber: string;
    amountKobo: number;
    currency: string;
    status: string;
    attempts: number;
    lastError: string | null;
    receivedAt: Date;
    processedAt: Date | null;
  }): PaymentNotification {
    return {
      id: row.id,
      provider: row.provider,
      eventType: row.eventType,
      eventId: row.eventId,
      providerReference: row.providerReference,
      accountNumber: row.accountNumber,
      amountKobo: row.amountKobo,
      currency: row.currency,
      status: row.status as PaymentNotificationStatus,
      attempts: row.attempts,
      lastError: row.lastError,
      receivedAt: row.receivedAt,
      processedAt: row.processedAt,
    };
  }
}
