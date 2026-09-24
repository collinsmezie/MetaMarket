import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../adapters/outbound/persistence/prisma.service';
import {
  DISTRIBUTED_LOCK,
  type DistributedLockPort,
} from '../../domain/ports/outbound/distributed-lock.port';
import { RequestContextStore } from '../correlation/request-context';
import { LeaderLock } from '../scheduling/leader-lock';
import {
  EVENT_HANDLER_REGISTRY,
  EventHandlerRegistry,
  type CorrelatedDomainEvent,
  type EventHandler,
} from './domain-event';

/**
 * Durable, cross-process event consumption (Overarching §18.7; Directive §22, §49.8).
 *
 * The transactional outbox guarantees an event is *recorded*; this worker guarantees every
 * registered handler *consumes* it exactly once, on whichever replica claims the row. Claims use
 * `FOR UPDATE SKIP LOCKED` so several replicas drain the outbox concurrently without contending,
 * and `(event_id, consumer)` rows make redelivery after a crash a no-op.
 *
 * Legacy `@OnEvent` subscribers continue to receive events through the in-process emitter during
 * migration; they are replaced by handlers registered here phase by phase.
 */

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 50;
const CLAIM_TTL_MS = 60_000;
const MAX_CONSUMPTION_ATTEMPTS = 10;

interface ClaimedRow {
  id: string;
  event_id: string;
  event_type: string;
  event_version: string;
  producer: string;
  conversation_id: string | null;
  workflow_id: string | null;
  vendor_id: string | null;
  customer_id: string | null;
  request_id: string | null;
  turn_id: string | null;
  run_id: string | null;
  correlation_id: string | null;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload: Prisma.JsonValue;
  occurred_at: Date;
}

@Injectable()
export class OutboxConsumerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxConsumerWorker.name);
  private readonly workerId = `${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private readonly leader: LeaderLock;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_HANDLER_REGISTRY) private readonly handlers: EventHandlerRegistry,
    @Inject(DISTRIBUTED_LOCK) locks: DistributedLockPort,
  ) {
    this.leader = new LeaderLock(locks);
  }

  onModuleInit(): void {
    if (process.env.OUTBOX_CONSUMER_DISABLED === 'true') return;
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** One drain pass. Exposed so tests and the live-test harness can drive it deterministically. */
  async tick(): Promise<number> {
    if (this.running || this.stopped) return 0;
    if (this.handlers.all().length === 0) return 0;
    this.running = true;

    try {
      const rows = await this.claim();
      for (const row of rows) await this.consume(row);
      return rows.length;
    } catch (error) {
      this.logger.error(
        `Outbox consumer tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async claim(): Promise<ClaimedRow[]> {
    // Rows are eligible when never consumed by all handlers (consumed_at null) and either
    // unclaimed or claimed longer ago than the TTL (a crashed replica).
    return this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE outbox_events
      SET claimed_at = now(), claimed_by = ${this.workerId}
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE consumed_at IS NULL
          AND consumption_attempts < ${MAX_CONSUMPTION_ATTEMPTS}
          AND (claimed_at IS NULL OR claimed_at < now() - (${CLAIM_TTL_MS} * interval '1 millisecond'))
        ORDER BY occurred_at ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, event_id, event_type, event_version, producer, conversation_id, workflow_id,
                vendor_id, customer_id, request_id, turn_id, run_id, correlation_id,
                aggregate_type, aggregate_id, payload, occurred_at
    `;
  }

  private async consume(row: ClaimedRow): Promise<void> {
    const event = toEvent(row);
    const handlers = this.handlers.handlersFor(event.eventType);

    if (handlers.length === 0) {
      await this.markConsumed(row.id);
      return;
    }

    const already = new Set(
      (
        await this.prisma.eventConsumption.findMany({
          where: { eventId: row.event_id, status: 'CONSUMED' },
          select: { consumer: true },
        })
      ).map((consumption) => consumption.consumer),
    );

    let allConsumed = true;

    for (const handler of handlers) {
      if (already.has(handler.name)) continue;
      const ok = await this.runHandler(handler, event, row);
      if (!ok) allConsumed = false;
    }

    if (allConsumed) {
      await this.markConsumed(row.id);
    } else {
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { consumptionAttempts: { increment: 1 }, claimedAt: null, claimedBy: null },
      });
    }
  }

  private async runHandler(
    handler: EventHandler,
    event: CorrelatedDomainEvent,
    row: ClaimedRow,
  ): Promise<boolean> {
    const persistedContext = {
      correlationId: event.correlationId,
      conversationId: event.conversationId ?? null,
      turnId: event.turnId ?? null,
      runId: event.runId ?? null,
      component: handler.name,
    };

    try {
      await RequestContextStore.resume(persistedContext, () => handler.handle(event));
      await this.prisma.eventConsumption.upsert({
        where: { eventId_consumer: { eventId: row.event_id, consumer: handler.name } },
        create: { eventId: row.event_id, consumer: handler.name, status: 'CONSUMED', consumedAt: new Date() },
        update: { status: 'CONSUMED', consumedAt: new Date(), error: null },
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.eventConsumption.upsert({
        where: { eventId_consumer: { eventId: row.event_id, consumer: handler.name } },
        create: {
          eventId: row.event_id,
          consumer: handler.name,
          status: 'FAILED',
          error: message,
          attempts: 1,
        },
        update: { status: 'FAILED', error: message, attempts: { increment: 1 } },
      });
      this.logger.warn(`Handler ${handler.name} failed for ${event.eventType} (${row.event_id}): ${message}`);
      return false;
    }
  }

  private async markConsumed(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { consumedAt: new Date(), claimedAt: null, claimedBy: null },
    });
  }

  /** Runs one tick under leader election; used by callers that want a single drain per cluster. */
  async tickExclusively(): Promise<number> {
    const result = await this.leader.runExclusively('outbox-consumer', CLAIM_TTL_MS, () => this.tick());
    return result ?? 0;
  }
}

function toEvent(row: ClaimedRow): CorrelatedDomainEvent {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    timestamp: row.occurred_at,
    producer: row.producer,
    correlationId: row.correlation_id ?? `corr_${row.event_id}`,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    ...(row.conversation_id !== null ? { conversationId: row.conversation_id } : {}),
    ...(row.workflow_id !== null ? { workflowId: row.workflow_id } : {}),
    ...(row.vendor_id !== null ? { vendorId: row.vendor_id } : {}),
    ...(row.customer_id !== null ? { customerId: row.customer_id } : {}),
    ...(row.request_id !== null ? { requestId: row.request_id } : {}),
    ...(row.turn_id !== null ? { turnId: row.turn_id } : {}),
    ...(row.run_id !== null ? { runId: row.run_id } : {}),
    ...(row.aggregate_type !== null && row.aggregate_id !== null
      ? { aggregate: { type: row.aggregate_type, id: row.aggregate_id } }
      : {}),
  };
}
