import { Injectable } from '@nestjs/common';
import { Prisma, type LogicalTurn as LogicalTurnRow, type TurnQueueEntry as QueueRow } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../adapters/outbound/persistence/prisma.service';
import type { Channel } from '../../../domain/models/channel';

import { hardDeadlineFor, quietDeadlineFor } from '../../domain/assembly-policy';
import {
  assembleText,
  assemblyReasonFor,
  orderMessages,
  type BoundaryReason,
  type ConversationTurnSummary,
  type LogicalTurn,
  type TurnMessage,
  type TurnQueueEntry,
} from '../../domain/logical-turn';
import type {
  AcceptMessageInput,
  AcceptMessageOutcome,
  CompleteTurnInput,
  LogicalTurnRepositoryPort,
  OpenTurnRow,
} from '../../ports/logical-turn.repository.port';

/**
 * Atomic append/seal/enqueue/claim protocol on PostgreSQL (MCOS TDR §5A.3.4, §5A.10, §5A.11).
 *
 * Correctness rests on three database facts, not on application scheduling:
 *  1. the open turn is read `FOR UPDATE` inside the accepting transaction, so two replicas
 *     cannot both append to (or both seal) the same turn;
 *  2. a partial unique index allows at most one OPEN turn per conversation, so two "first"
 *     messages arriving together cannot open two turns — the loser retries and appends;
 *  3. sealing and claiming are single compare-and-set UPDATEs; a zero-row result means another
 *     worker won and the caller must reload, never duplicate.
 */

const ACCEPT_RETRIES = 3;

interface OpenTurnSql {
  turn_id: string;
  channel: string;
  revision: number;
  message_ids: string[];
  messages: Prisma.JsonValue;
  first_message_at: Date;
  quiet_deadline_at: Date;
  hard_deadline_at: Date;
}

@Injectable()
export class PrismaLogicalTurnRepository implements LogicalTurnRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async acceptMessage(input: AcceptMessageInput): Promise<AcceptMessageOutcome> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < ACCEPT_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction((tx) => this.acceptInTransaction(tx, input));
      } catch (error) {
        // P2002 on the partial unique index: a concurrent first message opened the turn between
        // our read and our insert. Retrying re-reads it under lock and appends instead.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Turn assembly could not accept the message');
  }

  private async acceptInTransaction(
    tx: Prisma.TransactionClient,
    input: AcceptMessageInput,
  ): Promise<AcceptMessageOutcome> {
    const openRows = await tx.$queryRaw<OpenTurnSql[]>`
      SELECT turn_id, channel, revision, message_ids, messages, first_message_at, quiet_deadline_at, hard_deadline_at
      FROM logical_turns
      WHERE conversation_id = ${input.conversationId}::uuid AND status = 'OPEN'
      FOR UPDATE
    `;
    const openSql = openRows[0] ?? null;
    const open: OpenTurnRow | null =
      openSql === null
        ? null
        : {
            turnId: openSql.turn_id,
            channel: openSql.channel as Channel,
            revision: openSql.revision,
            messageCount: openSql.message_ids.length,
            firstMessageAt: openSql.first_message_at,
            quietDeadlineAt: openSql.quiet_deadline_at,
            hardDeadlineAt: openSql.hard_deadline_at,
            lastText: lastTextOf(openSql.messages),
          };

    const decision = input.decide(open);
    const message = input.message;
    const sealedTurnIds: string[] = [];
    let cancelledTurnId: string | null = null;
    let turn: LogicalTurnRow;

    switch (decision.action) {
      case 'OPEN_NEW':
      case 'OPEN_NEW_SEALED': {
        turn = await this.createTurn(
          tx,
          input,
          [message],
          decision.reason,
          decision.action === 'OPEN_NEW_SEALED',
          null,
        );
        if (decision.action === 'OPEN_NEW_SEALED') sealedTurnIds.push(turn.turnId);
        break;
      }

      case 'APPEND':
      case 'UNCERTAIN': {
        if (openSql === null) {
          // Policy asked to append but nothing is open: degrade to opening a turn.
          turn = await this.createTurn(tx, input, [message], 'FIRST_MESSAGE', false, null);
          break;
        }
        const messages = orderMessages([...parseMessages(openSql.messages), message]);
        turn = await tx.logicalTurn.update({
          where: { turnId: openSql.turn_id },
          data: {
            messageIds: messages.map((entry) => entry.messageId),
            messages: toJson(messages),
            assembledText: assembleText(messages),
            lastMessageAt: messages[messages.length - 1]!.receivedAt,
            quietDeadlineAt: decision.newQuietDeadlineAt,
            revision: { increment: 1 },
          },
        });
        break;
      }

      case 'SEAL_OPEN_THEN_NEW': {
        if (openSql !== null) {
          await this.sealRow(tx, openSql, message.receivedAt, decision.reason);
          sealedTurnIds.push(openSql.turn_id);
        }
        turn = await this.createTurn(tx, input, [message], decision.reason, decision.newTurnSealed, null);
        if (decision.newTurnSealed) sealedTurnIds.push(turn.turnId);
        break;
      }

      case 'CANCEL_OPEN_THEN_NEW': {
        if (openSql !== null) {
          await tx.logicalTurn.update({
            where: { turnId: openSql.turn_id },
            data: {
              status: 'CANCELLED',
              revision: { increment: 1 },
              error: {
                code: 'RETRACTED_BEFORE_EXECUTION',
                message: 'User retracted the request before it ran',
              },
            },
          });
          cancelledTurnId = openSql.turn_id;
        }
        turn = await this.createTurn(tx, input, [message], decision.reason, false, cancelledTurnId);
        break;
      }
    }

    await tx.inboundMessage.updateMany({ where: { id: message.messageId }, data: { turnId: turn.turnId } });

    return { turn: toDomain(turn), decision, sealedTurnIds, cancelledTurnId };
  }

  private async createTurn(
    tx: Prisma.TransactionClient,
    input: AcceptMessageInput,
    messages: readonly TurnMessage[],
    boundaryReason: BoundaryReason,
    sealed: boolean,
    supersedesTurnId: string | null,
  ): Promise<LogicalTurnRow> {
    const first = messages[0]!;
    const hardDeadlineAt = hardDeadlineFor(first.receivedAt, input.limits);
    return tx.logicalTurn.create({
      data: {
        turnId: randomUUID(),
        conversationId: input.conversationId,
        channel: input.channel,
        status: sealed ? 'SEALED' : 'OPEN',
        messageIds: messages.map((entry) => entry.messageId),
        messages: toJson(messages),
        assembledText: assembleText(messages),
        assemblyReason: sealed ? assemblyReasonFor(messages.length) : null,
        boundaryReason,
        firstMessageAt: first.receivedAt,
        lastMessageAt: messages[messages.length - 1]!.receivedAt,
        quietDeadlineAt: quietDeadlineFor(first.receivedAt, input.limits, hardDeadlineAt),
        hardDeadlineAt,
        sealedAt: sealed ? first.receivedAt : null,
        correlationId: input.correlationId,
        supersedesTurnId,
      },
    });
  }

  private async sealRow(
    tx: Prisma.TransactionClient,
    open: OpenTurnSql,
    at: Date,
    reason: BoundaryReason,
  ): Promise<void> {
    await tx.logicalTurn.update({
      where: { turnId: open.turn_id },
      data: {
        status: 'SEALED',
        sealedAt: at,
        assemblyReason: assemblyReasonFor(open.message_ids.length),
        boundaryReason: reason,
        revision: { increment: 1 },
      },
    });
  }

  async sealIfDue(turnId: string, revision: number, now: Date, reason: BoundaryReason): Promise<boolean> {
    const row = await this.prisma.logicalTurn.findUnique({ where: { turnId }, select: { messageIds: true } });
    const assemblyReason = assemblyReasonFor(row?.messageIds.length ?? 1);
    const updated = await this.prisma.$executeRaw`
      UPDATE logical_turns
      SET status = 'SEALED', sealed_at = ${now}, revision = revision + 1,
          assembly_reason = ${assemblyReason}, boundary_reason = ${reason}, updated_at = ${now}
      WHERE turn_id = ${turnId}::uuid
        AND status = 'OPEN'
        AND revision = ${revision}
        AND quiet_deadline_at <= ${now}
    `;
    return updated === 1;
  }

  async findOverdueOpenTurns(
    now: Date,
    limit: number,
  ): Promise<readonly { turnId: string; revision: number }[]> {
    const rows = await this.prisma.logicalTurn.findMany({
      where: { status: 'OPEN', quietDeadlineAt: { lte: now } },
      select: { turnId: true, revision: true },
      orderBy: { quietDeadlineAt: 'asc' },
      take: limit,
    });
    return rows;
  }

  async enqueue(turnId: string): Promise<TurnQueueEntry | null> {
    for (let attempt = 0; attempt < ACCEPT_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<{ status: string; conversation_id: string }[]>`
            SELECT status, conversation_id FROM logical_turns WHERE turn_id = ${turnId}::uuid FOR UPDATE
          `;
          const turn = rows[0];
          if (turn === undefined) return null;

          const existing = await tx.turnQueueEntry.findUnique({ where: { turnId } });
          if (existing !== null) return toQueueDomain(existing);
          if (turn.status !== 'SEALED') return null;

          const [{ next }] = await tx.$queryRaw<{ next: number }[]>`
            SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM turn_queue WHERE conversation_id = ${turn.conversation_id}::uuid
          `;

          const entry = await tx.turnQueueEntry.create({
            data: { conversationId: turn.conversation_id, turnId, sequence: Number(next), status: 'QUEUED' },
          });
          await tx.logicalTurn.update({
            where: { turnId },
            data: { status: 'ENQUEUED', revision: { increment: 1 } },
          });
          return toQueueDomain(entry);
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }
    return this.queueEntry(turnId);
  }

  async claimNext(workerId: string, conversationId?: string): Promise<TurnQueueEntry | null> {
    const scoped = conversationId ?? null;
    const rows = await this.prisma.$queryRaw<QueueRow[]>`
      UPDATE turn_queue
      SET status = 'CLAIMED', claimed_at = now(), claimed_by = ${workerId}, attempts = attempts + 1
      WHERE queue_id = (
        SELECT q.queue_id FROM turn_queue q
        WHERE q.status = 'QUEUED'
          AND (${scoped}::uuid IS NULL OR q.conversation_id = ${scoped}::uuid)
          AND NOT EXISTS (
            SELECT 1 FROM turn_queue p
            WHERE p.conversation_id = q.conversation_id AND p.status IN ('CLAIMED', 'PROCESSING')
          )
          AND NOT EXISTS (
            SELECT 1 FROM turn_queue e
            WHERE e.conversation_id = q.conversation_id AND e.status = 'QUEUED' AND e.sequence < q.sequence
          )
        ORDER BY q.created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING queue_id AS "queueId", conversation_id AS "conversationId", turn_id AS "turnId", sequence, status,
                created_at AS "createdAt", claimed_at AS "claimedAt", claimed_by AS "claimedBy",
                started_at AS "startedAt", completed_at AS "completedAt", attempts, last_error AS "lastError"
    `;
    const row = rows[0];
    return row === undefined ? null : toQueueDomain(row);
  }

  async markProcessing(turnId: string, runId: string, contextSnapshotId: string, at: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.logicalTurn.update({
        where: { turnId },
        data: {
          status: 'PROCESSING',
          processingStartedAt: at,
          runId,
          contextSnapshotId,
          revision: { increment: 1 },
        },
      }),
      this.prisma.turnQueueEntry.updateMany({
        where: { turnId },
        data: { status: 'PROCESSING', startedAt: at },
      }),
    ]);
  }

  async complete(input: CompleteTurnInput): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.logicalTurn.update({
        where: { turnId: input.turnId },
        data: {
          status: input.status,
          committedAt: input.completedAt,
          summary:
            input.summary === null ? Prisma.JsonNull : (input.summary as unknown as Prisma.InputJsonValue),
          error: input.error === null ? Prisma.JsonNull : input.error,
          revision: { increment: 1 },
        },
      }),
      this.prisma.turnQueueEntry.updateMany({
        where: { turnId: input.turnId },
        data: {
          status: input.status,
          completedAt: input.completedAt,
          lastError: input.error?.message ?? null,
        },
      }),
    ]);
  }

  async requeue(turnId: string, error: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.turnQueueEntry.updateMany({
        where: { turnId },
        data: { status: 'QUEUED', claimedAt: null, claimedBy: null, startedAt: null, lastError: error },
      }),
      this.prisma.logicalTurn.update({
        where: { turnId },
        data: { status: 'ENQUEUED', runId: null, revision: { increment: 1 } },
      }),
    ]);
  }

  async recoverStaleClaims(staleBefore: Date, maxAttempts: number): Promise<number> {
    const stale = await this.prisma.turnQueueEntry.findMany({
      where: {
        status: { in: ['CLAIMED', 'PROCESSING'] },
        claimedAt: { lt: staleBefore },
        attempts: { lt: maxAttempts },
      },
      select: { turnId: true },
    });
    if (stale.length === 0) return 0;
    const ids = stale.map((entry) => entry.turnId);
    await this.prisma.$transaction([
      this.prisma.turnQueueEntry.updateMany({
        where: { turnId: { in: ids } },
        data: { status: 'QUEUED', claimedAt: null, claimedBy: null, startedAt: null },
      }),
      this.prisma.logicalTurn.updateMany({
        where: { turnId: { in: ids } },
        data: { status: 'ENQUEUED', revision: { increment: 1 } },
      }),
    ]);
    return ids.length;
  }

  async findById(turnId: string): Promise<LogicalTurn | null> {
    const row = await this.prisma.logicalTurn.findUnique({ where: { turnId } });
    return row === null ? null : toDomain(row);
  }

  async findByMessageId(messageId: string): Promise<LogicalTurn | null> {
    const message = await this.prisma.inboundMessage.findUnique({
      where: { id: messageId },
      select: { turnId: true },
    });
    if (message?.turnId == null) return null;
    return this.findById(message.turnId);
  }

  async listForConversation(conversationId: string, limit: number): Promise<readonly LogicalTurn[]> {
    const rows = await this.prisma.logicalTurn.findMany({
      where: { conversationId },
      orderBy: { firstMessageAt: 'desc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async latestSummaryBefore(
    conversationId: string,
    beforeFirstMessageAt: Date,
  ): Promise<ConversationTurnSummary | null> {
    const row = await this.prisma.logicalTurn.findFirst({
      where: {
        conversationId,
        status: { in: ['COMMITTED', 'WAITING_USER', 'FAILED'] },
        firstMessageAt: { lt: beforeFirstMessageAt },
        summary: { not: Prisma.JsonNull },
      },
      orderBy: { firstMessageAt: 'desc' },
      select: { summary: true },
    });
    return (row?.summary as ConversationTurnSummary | null | undefined) ?? null;
  }

  async queueEntry(turnId: string): Promise<TurnQueueEntry | null> {
    const row = await this.prisma.turnQueueEntry.findUnique({ where: { turnId } });
    return row === null ? null : toQueueDomain(row);
  }
}

function toJson(messages: readonly TurnMessage[]): Prisma.InputJsonValue {
  return messages.map((message) => ({
    ...message,
    receivedAt: message.receivedAt.toISOString(),
  })) as unknown as Prisma.InputJsonValue;
}

function parseMessages(value: Prisma.JsonValue): TurnMessage[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const entry = raw as Record<string, unknown>;
    return {
      messageId: String(entry.messageId),
      channel: String(entry.channel) as Channel,
      senderId: String(entry.senderId),
      text: typeof entry.text === 'string' ? entry.text : '',
      receivedAt: new Date(String(entry.receivedAt)),
      providerEventId: typeof entry.providerEventId === 'string' ? entry.providerEventId : null,
      interactivePayload: typeof entry.interactivePayload === 'string' ? entry.interactivePayload : null,
    };
  });
}

function lastTextOf(value: Prisma.JsonValue): string {
  const messages = parseMessages(value);
  return messages[messages.length - 1]?.text ?? '';
}

function toDomain(row: LogicalTurnRow): LogicalTurn {
  return {
    turnId: row.turnId,
    conversationId: row.conversationId,
    channel: row.channel as Channel,
    status: row.status,
    messageIds: row.messageIds,
    messages: parseMessages(row.messages),
    assembledText: row.assembledText,
    assemblyReason: (row.assemblyReason as LogicalTurn['assemblyReason']) ?? null,
    boundaryReason: row.boundaryReason as BoundaryReason,
    firstMessageAt: row.firstMessageAt,
    lastMessageAt: row.lastMessageAt,
    quietDeadlineAt: row.quietDeadlineAt,
    hardDeadlineAt: row.hardDeadlineAt,
    sealedAt: row.sealedAt,
    processingStartedAt: row.processingStartedAt,
    committedAt: row.committedAt,
    assemblyVersion: row.assemblyVersion,
    revision: row.revision,
    runId: row.runId,
    contextSnapshotId: row.contextSnapshotId,
    correlationId: row.correlationId,
    supersedesTurnId: row.supersedesTurnId,
    correctsTurnId: row.correctsTurnId,
    summary: (row.summary as ConversationTurnSummary | null) ?? null,
    error: (row.error as { code: string; message: string } | null) ?? null,
  };
}

function toQueueDomain(row: QueueRow): TurnQueueEntry {
  return {
    queueId: row.queueId,
    conversationId: row.conversationId,
    turnId: row.turnId,
    sequence: row.sequence,
    status: row.status,
    createdAt: row.createdAt,
    claimedAt: row.claimedAt,
    claimedBy: row.claimedBy,
    completedAt: row.completedAt,
    attempts: row.attempts,
  };
}
