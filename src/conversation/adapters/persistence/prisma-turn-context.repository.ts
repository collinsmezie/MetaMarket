import { Injectable } from '@nestjs/common';
import type { Prisma, TurnContextSnapshot as Row } from '@prisma/client';
import { PrismaService } from '../../../adapters/outbound/persistence/prisma.service';
import type { ConversationWorkingContext, TurnContextSnapshot } from '../../domain/turn-context';
import type { TurnContextRepositoryPort } from '../../ports/turn-context.repository.port';

@Injectable()
export class PrismaTurnContextRepository implements TurnContextRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(snapshot: TurnContextSnapshot): Promise<void> {
    await this.prisma.turnContextSnapshot.create({
      data: {
        id: snapshot.snapshotId,
        conversationId: snapshot.conversationId,
        turnId: snapshot.turnId,
        version: snapshot.version,
        snapshot: serialize(snapshot.context),
        createdAt: snapshot.createdAt,
      },
    });
  }

  async findById(snapshotId: string): Promise<TurnContextSnapshot | null> {
    const row = await this.prisma.turnContextSnapshot.findUnique({ where: { id: snapshotId } });
    return row === null ? null : toDomain(row);
  }

  async findByTurnId(turnId: string): Promise<TurnContextSnapshot | null> {
    const row = await this.prisma.turnContextSnapshot.findFirst({
      where: { turnId },
      orderBy: { createdAt: 'desc' },
    });
    return row === null ? null : toDomain(row);
  }
}

function serialize(context: ConversationWorkingContext): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(context)) as Prisma.InputJsonValue;
}

function toDomain(row: Row): TurnContextSnapshot {
  const context = row.snapshot as unknown as ConversationWorkingContext & {
    pendingClarification:
      (ConversationWorkingContext['pendingClarification'] & Record<string, unknown>) | null;
  };
  const pending = context.pendingClarification;
  return {
    snapshotId: row.id,
    conversationId: row.conversationId,
    turnId: row.turnId,
    version: row.version,
    context: {
      ...context,
      pendingClarification:
        pending === null
          ? null
          : {
              ...pending,
              askedAt: new Date(String(pending.askedAt)),
              resolvedAt: pending.resolvedAt === null ? null : new Date(String(pending.resolvedAt)),
              expiresAt: pending.expiresAt === null ? null : new Date(String(pending.expiresAt)),
            },
    },
    createdAt: row.createdAt,
  };
}
