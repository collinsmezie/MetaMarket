import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Channel } from '../../../domain/models/channel';
import { isChannel } from '../../../domain/models/channel';
import type {
  Conversation,
  ConversationMemory,
  HistoryEntry,
  HistoryRole,
  MemoryFact,
} from '../../../domain/models/conversation';
import type { ConversationRepositoryPort } from '../../../domain/ports/outbound/conversation-repository.port';
import { EMPTY_REGISTRY } from '../../../domain/models/workflow-instance';
import { PrismaService } from './prisma.service';

/**
 * PostgreSQL persistence for the conversation aggregate.
 *
 * The workflow registry is loaded separately by the workflow repository, so a conversation
 * read stays cheap on the hot path; callers assemble the two.
 */
@Injectable()
export class PrismaConversationRepository implements ConversationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findById(conversationId: string): Promise<Conversation | null> {
    const row = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { memoryFacts: true },
    });

    return row === null ? null : this.toDomain(row, row.memoryFacts);
  }

  /**
   * One conversation per user across every channel (MCOS §24).
   *
   * Uses an upsert rather than find-then-create because two webhooks for a first-time user
   * can arrive concurrently; the unique index on `userId` makes the upsert the arbiter.
   */
  async findOrCreateByUser(params: {
    userId: string;
    channel: Channel;
  }): Promise<{ conversation: Conversation; created: boolean }> {
    const existing = await this.prisma.conversation.findUnique({
      where: { userId: params.userId },
      include: { memoryFacts: true },
    });

    if (existing !== null) {
      return { conversation: this.toDomain(existing, existing.memoryFacts), created: false };
    }

    try {
      const row = await this.prisma.conversation.create({
        data: { userId: params.userId, lastChannel: params.channel },
        include: { memoryFacts: true },
      });
      return { conversation: this.toDomain(row, row.memoryFacts), created: true };
    } catch (error) {
      // A concurrent first message won the race; read what it created.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const row = await this.prisma.conversation.findUniqueOrThrow({
          where: { userId: params.userId },
          include: { memoryFacts: true },
        });
        return { conversation: this.toDomain(row, row.memoryFacts), created: false };
      }
      throw error;
    }
  }

  async loadRecentHistory(conversationId: string, limit: number): Promise<readonly HistoryEntry[]> {
    // Take the newest `limit` rows, then restore chronological order for the reader.
    const rows = await this.prisma.historyEntry.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return rows.reverse().map((row) => ({
      id: row.id,
      role: row.role as HistoryRole,
      content: row.content,
      channel: this.toChannel(row.channel),
      timestamp: row.timestamp,
      ...(row.workflowId !== null ? { workflowId: row.workflowId } : {}),
    }));
  }

  async appendHistory(conversationId: string, entry: HistoryEntry): Promise<void> {
    await this.prisma.historyEntry.create({
      data: {
        id: entry.id,
        conversationId,
        role: entry.role,
        content: entry.content,
        channel: entry.channel,
        workflowId: entry.workflowId ?? null,
        timestamp: entry.timestamp,
      },
    });
  }

  /**
   * Replaces the memory snapshot.
   *
   * Facts are upserted rather than deleted and re-inserted so that concurrent writers
   * updating different keys do not clobber each other.
   */
  async updateMemory(conversationId: string, memory: ConversationMemory): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { memorySummary: memory.summary },
      }),
      ...Object.entries(memory.facts).map(([key, fact]) =>
        this.prisma.conversationMemoryFact.upsert({
          where: { conversationId_key: { conversationId, key } },
          create: {
            conversationId,
            key,
            value: fact.value as Prisma.InputJsonValue,
            confidence: fact.confidence,
            source: fact.source,
          },
          update: {
            value: fact.value as Prisma.InputJsonValue,
            confidence: fact.confidence,
            source: fact.source,
          },
        }),
      ),
    ]);
  }

  async touch(conversationId: string, channel: Channel, at: Date): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastChannel: channel, updatedAt: at },
    });
  }

  private toDomain(
    row: {
      id: string;
      userId: string;
      lastChannel: string;
      memorySummary: string;
      createdAt: Date;
      updatedAt: Date;
    },
    facts: readonly {
      key: string;
      value: Prisma.JsonValue;
      confidence: number;
      source: string;
      updatedAt: Date;
    }[],
  ): Conversation {
    const memoryFacts: Record<string, MemoryFact> = {};
    for (const fact of facts) {
      memoryFacts[fact.key] = {
        value: fact.value,
        confidence: fact.confidence,
        source: fact.source,
        updatedAt: fact.updatedAt,
      };
    }

    return {
      id: row.id,
      userId: row.userId,
      // Loaded on demand by the context manager; kept out of the aggregate read.
      history: [],
      memory: { facts: memoryFacts, summary: row.memorySummary },
      workflowRegistry: EMPTY_REGISTRY,
      lastChannel: this.toChannel(row.lastChannel),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Guards the boundary between an unconstrained text column and the Channel union.
   *
   * A row written by an older deployment that knew a channel this one does not must not
   * silently become an invalid Channel value inside the domain.
   */
  private toChannel(value: string): Channel {
    if (!isChannel(value)) {
      throw new Error(
        `Stored channel "${value}" is not a channel this deployment understands. ` +
          'This usually means a rollback past a migration that added a channel.',
      );
    }
    return value;
  }
}
