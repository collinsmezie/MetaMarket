import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import type { DomainEvent, EventPublisherPort } from '../../../domain/ports/outbound/event-publisher.port';
import { PrismaService } from '../persistence/prisma.service';

/**
 * Transactional-outbox event publisher (Execution.md §2.6).
 *
 * Every event is durably recorded before it is dispatched. Publishing straight to an
 * in-memory bus would lose marketplace evidence whenever the process died between
 * committing a workflow transition and notifying subscribers — and evidence is the input to
 * all downstream learning.
 *
 * In-process dispatch happens immediately for responsiveness; the relay
 * ({@link OutboxRelay}) is the safety net that guarantees eventual delivery.
 */
@Injectable()
export class OutboxEventPublisher implements EventPublisherPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: EventEmitter2,
  ) {}

  async publish<TPayload>(event: DomainEvent<TPayload>): Promise<void> {
    await this.publishAll([event as DomainEvent]);
  }

  async publishAll(events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) return;

    await this.prisma.outboxEvent.createMany({
      data: events.map((event) => ({
        eventId: event.eventId,
        eventType: event.eventType,
        producer: event.producer,
        conversationId: event.conversationId ?? null,
        workflowId: event.workflowId ?? null,
        vendorId: event.vendorId ?? null,
        customerId: event.customerId ?? null,
        requestId: event.requestId ?? null,
        payload: event.payload as Prisma.InputJsonValue,
        occurredAt: event.timestamp,
      })),
      // A retried turn can re-emit an event that is already recorded; that is not an error.
      skipDuplicates: true,
    });

    await this.dispatch(events);
  }

  /**
   * Dispatches to in-process subscribers and marks the events published.
   *
   * A dispatch failure deliberately does not throw: the row stays unpublished and the relay
   * retries it, rather than failing the user's turn over a subscriber's bug.
   */
  private async dispatch(events: readonly DomainEvent[]): Promise<void> {
    const delivered: string[] = [];

    for (const event of events) {
      try {
        await this.emitter.emitAsync(event.eventType, event);
        delivered.push(event.eventId);
      } catch {
        // Left unpublished on purpose; OutboxRelay will pick it up.
      }
    }

    if (delivered.length > 0) {
      await this.prisma.outboxEvent.updateMany({
        where: { eventId: { in: delivered } },
        data: { publishedAt: new Date() },
      });
    }
  }
}
