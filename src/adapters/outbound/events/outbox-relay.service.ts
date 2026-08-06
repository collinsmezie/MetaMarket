import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import type { DomainEvent } from '../../../domain/ports/outbound/event-publisher.port';
import { PrismaService } from '../persistence/prisma.service';

/** How often unpublished events are swept. */
const RELAY_INTERVAL_MS = 5_000;

/** Batch size per sweep, bounding the work a single tick can do. */
const BATCH_SIZE = 100;

/**
 * Attempts before an event is parked for investigation.
 *
 * Retrying forever would turn one poisonous event into a permanent hot loop that starves
 * healthy events behind it.
 */
const MAX_ATTEMPTS = 10;

/**
 * Delivers outbox events that were not dispatched successfully at write time.
 *
 * This is what makes the outbox a guarantee rather than an optimisation: a crash between
 * committing state and notifying subscribers is recovered on the next sweep.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  /** Prevents overlapping sweeps when a batch outlives the interval. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
  ) {}

  @Interval(RELAY_INTERVAL_MS)
  async relayPending(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const pending = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null, attempts: { lt: MAX_ATTEMPTS } },
        orderBy: { occurredAt: 'asc' },
        take: BATCH_SIZE,
      });

      for (const row of pending) await this.relayOne(row);
    } catch (error) {
      this.logger.error(`Outbox sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async relayOne(row: {
    id: string;
    eventId: string;
    eventType: string;
    producer: string;
    conversationId: string | null;
    workflowId: string | null;
    vendorId: string | null;
    customerId: string | null;
    requestId: string | null;
    payload: Prisma.JsonValue;
    occurredAt: Date;
    attempts: number;
  }): Promise<void> {
    const event: DomainEvent = {
      eventId: row.eventId,
      eventType: row.eventType,
      timestamp: row.occurredAt,
      producer: row.producer,
      ...(row.conversationId !== null ? { conversationId: row.conversationId } : {}),
      ...(row.workflowId !== null ? { workflowId: row.workflowId } : {}),
      ...(row.vendorId !== null ? { vendorId: row.vendorId } : {}),
      ...(row.customerId !== null ? { customerId: row.customerId } : {}),
      ...(row.requestId !== null ? { requestId: row.requestId } : {}),
      payload: (row.payload ?? {}) as Record<string, unknown>,
    };

    try {
      await this.emitter.emitAsync(event.eventType, event);
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { publishedAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = row.attempts + 1;

      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { attempts, lastError: message },
      });

      if (attempts >= MAX_ATTEMPTS) {
        // Surfaced loudly: a permanently stuck event means some subsystem is missing data.
        this.logger.error(
          `Outbox event ${row.eventId} (${row.eventType}) exhausted ${MAX_ATTEMPTS} delivery attempts and will no longer be retried: ${message}`,
        );
      }
    }
  }
}
