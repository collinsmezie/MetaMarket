import { Injectable } from '@nestjs/common';
import { Prisma, type PendingClarification as Row } from '@prisma/client';
import { PrismaService } from '../../../adapters/outbound/persistence/prisma.service';
import {
  canTransitionClarification,
  IllegalClarificationTransition,
  type PendingClarification,
  type PendingClarificationStatus,
} from '../../domain/pending-clarification';
import {
  ActiveClarificationExistsError,
  type ClarificationRepositoryPort,
  type CreateClarificationInput,
} from '../../ports/clarification.repository.port';

/**
 * Durable clarification store (MCOS TDR §25A). The partial unique index
 * `pending_clarifications_one_active_per_conversation` (migration SQL) is what makes the
 * one-active-question invariant hold under concurrency; the application only interprets it.
 */
@Injectable()
export class PrismaClarificationRepository implements ClarificationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateClarificationInput): Promise<PendingClarification> {
    try {
      const row = await this.prisma.pendingClarification.create({
        data: {
          clarificationId: input.clarificationId,
          conversationId: input.conversationId,
          originatingTurnId: input.originatingTurnId,
          question: input.question,
          targetActionIds: [...input.targetActionIds],
          targetIntentIds: [...input.targetIntentIds],
          blocking: input.blocking,
          status: 'WAITING_FOR_USER',
          askedAt: input.askedAt,
          expiresAt: input.expiresAt,
          expectedResolution: input.expectedResolution,
          contextSnapshotId: input.contextSnapshotId,
          issueKey: input.issueKey,
        },
      });
      return toDomain(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findActive(input.conversationId);
        throw new ActiveClarificationExistsError(
          input.conversationId,
          existing?.clarificationId ?? 'unknown',
        );
      }
      throw error;
    }
  }

  async findActive(conversationId: string): Promise<PendingClarification | null> {
    const row = await this.prisma.pendingClarification.findFirst({
      where: { conversationId, status: 'WAITING_FOR_USER' },
      orderBy: { askedAt: 'desc' },
    });
    return row === null ? null : toDomain(row);
  }

  async findById(clarificationId: string): Promise<PendingClarification | null> {
    const row = await this.prisma.pendingClarification.findUnique({ where: { clarificationId } });
    return row === null ? null : toDomain(row);
  }

  async transition(params: {
    clarificationId: string;
    expectedVersion: number;
    to: PendingClarificationStatus;
    at: Date;
    answerMessageIds?: readonly string[];
    answerTurnId?: string | null;
  }): Promise<PendingClarification | null> {
    const current = await this.findById(params.clarificationId);
    if (current === null) return null;
    if (!canTransitionClarification(current.status, params.to)) {
      throw new IllegalClarificationTransition(params.clarificationId, current.status, params.to);
    }

    const { count } = await this.prisma.pendingClarification.updateMany({
      where: { clarificationId: params.clarificationId, version: params.expectedVersion },
      data: {
        status: params.to,
        version: { increment: 1 },
        ...(params.answerMessageIds !== undefined ? { answerMessageIds: [...params.answerMessageIds] } : {}),
        ...(params.answerTurnId !== undefined ? { answerTurnId: params.answerTurnId } : {}),
        ...(params.to === 'RESOLVED' ||
        params.to === 'EXPIRED' ||
        params.to === 'CANCELLED' ||
        params.to === 'SUPERSEDED'
          ? { resolvedAt: params.at }
          : {}),
        ...(params.to === 'WAITING_FOR_USER' ? { attemptCount: { increment: 1 } } : {}),
      },
    });

    if (count === 0) return null;
    return this.findById(params.clarificationId);
  }

  async historyForIssue(
    conversationId: string,
    issueKey: string,
    limit: number,
  ): Promise<readonly PendingClarification[]> {
    const rows = await this.prisma.pendingClarification.findMany({
      where: { conversationId, issueKey },
      orderBy: { askedAt: 'desc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async listForConversation(conversationId: string, limit: number): Promise<readonly PendingClarification[]> {
    const rows = await this.prisma.pendingClarification.findMany({
      where: { conversationId },
      orderBy: { askedAt: 'desc' },
      take: limit,
    });
    return rows.map(toDomain);
  }
}

function toDomain(row: Row): PendingClarification {
  return {
    clarificationId: row.clarificationId,
    conversationId: row.conversationId,
    originatingTurnId: row.originatingTurnId,
    question: row.question,
    targetActionIds: row.targetActionIds,
    targetIntentIds: row.targetIntentIds,
    blocking: row.blocking,
    status: row.status,
    askedAt: row.askedAt,
    answerMessageIds: row.answerMessageIds,
    answerTurnId: row.answerTurnId,
    resolvedAt: row.resolvedAt,
    expiresAt: row.expiresAt,
    attemptCount: row.attemptCount,
    expectedResolution: row.expectedResolution,
    contextSnapshotId: row.contextSnapshotId,
    issueKey: row.issueKey,
    version: row.version,
  };
}
