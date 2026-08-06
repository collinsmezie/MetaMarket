import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Artifact, ArtifactSource } from '../../../domain/models/artifact';
import type { Channel } from '../../../domain/models/channel';
import { isChannel } from '../../../domain/models/channel';
import type { IncomingMessage, MessagePart } from '../../../domain/models/incoming-message';
import { PROVIDER_MESSAGE_ID_KEY } from '../../../domain/models/incoming-message';
import type { MessageRepositoryPort } from '../../../domain/ports/outbound/message-repository.port';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaMessageRepository implements MessageRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes the message, treating a unique-constraint violation on `providerMessageId` as a
   * duplicate delivery rather than an error.
   *
   * Relying on the index instead of a preceding read is what makes this correct when Meta
   * delivers the same webhook twice concurrently to two pods.
   */
  async saveIncoming(message: IncomingMessage): Promise<boolean> {
    const providerMessageId = message.metadata[PROVIDER_MESSAGE_ID_KEY];

    try {
      await this.prisma.inboundMessage.create({
        data: {
          id: message.id,
          conversationId: message.conversationId,
          userId: message.userId,
          channel: message.channel,
          providerMessageId: typeof providerMessageId === 'string' ? providerMessageId : null,
          parts: message.parts as unknown as Prisma.InputJsonValue,
          metadata: message.metadata as Prisma.InputJsonValue,
          receivedAt: message.timestamp,
        },
      });

      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  async findById(messageId: string): Promise<IncomingMessage | null> {
    const row = await this.prisma.inboundMessage.findUnique({ where: { id: messageId } });
    if (row === null) return null;

    if (!isChannel(row.channel)) {
      throw new Error(`Stored message channel "${row.channel}" is not known to this deployment.`);
    }

    return {
      id: row.id,
      conversationId: row.conversationId,
      userId: row.userId,
      channel: row.channel as Channel,
      timestamp: row.receivedAt,
      parts: row.parts as unknown as readonly MessagePart[],
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    };
  }

  async appendArtifacts(messageId: string, artifacts: readonly Artifact[]): Promise<void> {
    if (artifacts.length === 0) return;

    await this.prisma.artifact.createMany({
      data: artifacts.map((artifact) => ({
        messageId,
        type: artifact.type,
        source: artifact.source,
        confidence: artifact.confidence,
        originPartIndex: artifact.originPartIndex ?? null,
        payload: this.toPayload(artifact),
      })),
    });
  }

  async loadArtifacts(messageId: string): Promise<readonly Artifact[]> {
    const rows = await this.prisma.artifact.findMany({
      where: { messageId },
      // Part order first so a multi-part message reads in the order the user sent it.
      orderBy: [{ originPartIndex: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => this.toDomain(row));
  }

  async markProcessed(messageId: string, at: Date): Promise<void> {
    await this.prisma.inboundMessage.update({
      where: { id: messageId },
      data: { processedAt: at },
    });
  }

  async isProcessed(messageId: string): Promise<boolean> {
    const row = await this.prisma.inboundMessage.findUnique({
      where: { id: messageId },
      select: { processedAt: true },
    });

    return row?.processedAt != null;
  }

  /**
   * Strips the fields promoted to their own columns, leaving the type-specific body.
   *
   * Storing them twice would let the column and the JSON drift apart, and the column is the
   * one queries filter on.
   */
  private toPayload(artifact: Artifact): Prisma.InputJsonValue {
    const promotedToColumns = new Set(['type', 'source', 'confidence', 'originPartIndex']);

    return Object.fromEntries(
      Object.entries(artifact).filter(([key]) => !promotedToColumns.has(key)),
    ) as Prisma.InputJsonValue;
  }

  private toDomain(row: {
    type: string;
    source: string;
    confidence: number;
    originPartIndex: number | null;
    payload: Prisma.JsonValue;
  }): Artifact {
    const base = {
      source: row.source as ArtifactSource,
      confidence: row.confidence,
      ...(row.originPartIndex !== null ? { originPartIndex: row.originPartIndex } : {}),
    };

    return { type: row.type, ...base, ...(row.payload as object) } as Artifact;
  }
}
