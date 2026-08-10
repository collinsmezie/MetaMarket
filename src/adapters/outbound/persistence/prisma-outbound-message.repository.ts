import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Channel } from '../../../domain/models/channel';
import { nextOutboundAttemptAt, type OutboundMessage, type OutboundMessageStatus } from '../../../domain/models/outbound-message';
import type { Response } from '../../../domain/models/response';
import type {
  EnqueuedOutboundMessage,
  OutboundMessageRepositoryPort,
} from '../../../domain/ports/outbound/outbound-message-repository.port';
import { PrismaService } from './prisma.service';

/** Row shape returned by the raw claim, which bypasses Prisma's field mapping. */
interface OutboundRow {
  id: string;
  channel: string;
  address: string;
  conversation_id: string;
  response: Prisma.JsonValue;
  status: string;
  attempts: number;
  last_error: string | null;
  provider_message_id: string | null;
  next_attempt_at: Date;
  created_at: Date;
  sent_at: Date | null;
}

@Injectable()
export class PrismaOutboundMessageRepository implements OutboundMessageRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes the message and reports whether the conversation already owes the user something.
   *
   * Both in one transaction so the backlog answer cannot be stale by the time the caller acts
   * on it — two replies composed concurrently for one conversation must not both conclude they
   * are first in line.
   */
  async enqueue(params: {
    id: string;
    channel: Channel;
    address: string;
    conversationId: string;
    response: Response;
    at: Date;
  }): Promise<EnqueuedOutboundMessage> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.outboundMessage.create({
        data: {
          id: params.id,
          channel: params.channel,
          address: params.address,
          conversationId: params.conversationId,
          response: params.response as unknown as Prisma.InputJsonValue,
          nextAttemptAt: nextOutboundAttemptAt(1, params.at),
          createdAt: params.at,
        },
      });

      const older = await tx.outboundMessage.count({
        where: {
          conversationId: params.conversationId,
          status: 'pending',
          id: { not: row.id },
          createdAt: { lte: row.createdAt },
        },
      });

      return { message: this.toDomain(row), hasBacklog: older > 0 };
    });
  }

  async markSent(id: string, params: { providerMessageId?: string; at: Date }): Promise<void> {
    await this.prisma.outboundMessage.update({
      where: { id },
      data: {
        status: 'sent',
        sentAt: params.at,
        attempts: { increment: 1 },
        lastError: null,
        ...(params.providerMessageId !== undefined ? { providerMessageId: params.providerMessageId } : {}),
      },
    });
  }

  async scheduleRetry(id: string, params: { error: string; nextAttemptAt: Date }): Promise<void> {
    await this.prisma.outboundMessage.update({
      where: { id },
      data: {
        status: 'pending',
        attempts: { increment: 1 },
        lastError: params.error.slice(0, 1_000),
        nextAttemptAt: params.nextAttemptAt,
      },
    });
  }

  async markFailed(id: string, params: { error: string }): Promise<void> {
    await this.prisma.outboundMessage.update({
      where: { id },
      data: { status: 'failed', attempts: { increment: 1 }, lastError: params.error.slice(0, 1_000) },
    });
  }

  /**
   * The standard Postgres work-queue claim, leased rather than status-flagged.
   *
   * `FOR UPDATE SKIP LOCKED` inside the subquery is what makes concurrent sweepers safe: each
   * takes rows the others cannot see, so no message is delivered twice. Pushing `next_attempt_at`
   * out by the lease is the claim itself — a worker that dies holding rows leaves them to become
   * due again on their own.
   */
  async claimDue(params: {
    batchSize: number;
    now: Date;
    leaseMs: number;
  }): Promise<readonly OutboundMessage[]> {
    const leaseUntil = new Date(params.now.getTime() + params.leaseMs);

    const rows = await this.prisma.$queryRaw<OutboundRow[]>`
      UPDATE outbound_messages
      SET next_attempt_at = ${leaseUntil}
      WHERE id IN (
        SELECT id FROM outbound_messages
        WHERE status = 'pending' AND next_attempt_at <= ${params.now}
        ORDER BY created_at ASC
        LIMIT ${params.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;

    // The UPDATE ... RETURNING gives no ordering guarantee; the sweep depends on oldest-first to
    // keep each conversation's replies in the order they were composed.
    return rows
      .map((row) => this.toDomain(row))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async purgeSent(params: { sentBefore: Date; limit: number }): Promise<number> {
    const stale = await this.prisma.outboundMessage.findMany({
      where: { status: 'sent', sentAt: { lt: params.sentBefore } },
      select: { id: true },
      take: params.limit,
    });

    if (stale.length === 0) return 0;

    const { count } = await this.prisma.outboundMessage.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });

    return count;
  }

  private toDomain(row: OutboundRow | Record<string, unknown>): OutboundMessage {
    // Prisma's typed client and the raw claim disagree on field naming, so normalise both here
    // rather than maintaining two mappers.
    const value = row as Record<string, unknown>;
    const pick = <T>(camel: string, snake: string): T => (value[camel] ?? value[snake]) as T;

    return {
      id: value.id as string,
      channel: value.channel as Channel,
      address: value.address as string,
      conversationId: pick<string>('conversationId', 'conversation_id'),
      response: (value.response ?? {}) as Response,
      status: value.status as OutboundMessageStatus,
      attempts: value.attempts as number,
      lastError: pick<string | null>('lastError', 'last_error') ?? null,
      providerMessageId: pick<string | null>('providerMessageId', 'provider_message_id') ?? null,
      nextAttemptAt: pick<Date>('nextAttemptAt', 'next_attempt_at'),
      createdAt: pick<Date>('createdAt', 'created_at'),
      sentAt: pick<Date | null>('sentAt', 'sent_at') ?? null,
    };
  }
}
