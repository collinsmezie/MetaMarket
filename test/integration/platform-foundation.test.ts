import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { OutboxEventPublisher } from '../../src/adapters/outbound/events/outbox-event-publisher';
import { PrismaService } from '../../src/adapters/outbound/persistence/prisma.service';
import { RedisDistributedLockAdapter } from '../../src/adapters/outbound/persistence/redis-distributed-lock.adapter';
import { RedisService } from '../../src/adapters/outbound/persistence/redis.service';
import { AppConfigModule } from '../../src/config/config.module';
import { RequestContextStore, runIdForTurn } from '../../src/platform/correlation/request-context';
import {
  correlatedEvent,
  EventHandlerRegistry,
  type CorrelatedDomainEvent,
} from '../../src/platform/events/domain-event';
import { OutboxConsumerWorker } from '../../src/platform/events/outbox-consumer.worker';
import { PrismaTraceRecorder } from '../../src/platform/observability/prisma-trace-recorder';
import { TraceQueryService } from '../../src/platform/observability/trace-query.service';
import { LeaderLock } from '../../src/platform/scheduling/leader-lock';

/**
 * Phase 1 foundation against real Postgres and Redis.
 *
 * What is proven here cannot be proven with fakes: `FOR UPDATE SKIP LOCKED` claiming, the
 * `(event_id, consumer)` exactly-once ledger surviving a handler failure and a retry, the
 * correlation stamp travelling from AsyncLocalStorage into the outbox row, and the leader lock
 * genuinely excluding a concurrent sweep.
 */
describe('Platform foundation (traces, correlated outbox, durable consumption)', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let locks: RedisDistributedLockAdapter;
  let publisher: OutboxEventPublisher;
  let traces: PrismaTraceRecorder;
  let queries: TraceQueryService;

  beforeAll(async () => {
    process.env.OUTBOX_CONSUMER_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [
        PrismaService,
        RedisService,
        RedisDistributedLockAdapter,
        PrismaTraceRecorder,
        TraceQueryService,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    redis = moduleRef.get(RedisService);
    locks = moduleRef.get(RedisDistributedLockAdapter);
    traces = moduleRef.get(PrismaTraceRecorder);
    queries = moduleRef.get(TraceQueryService);
    publisher = new OutboxEventPublisher(prisma, new EventEmitter2());
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.eventConsumption.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.promptExecution.deleteMany();
    await prisma.traceStep.deleteMany();
    await prisma.orchestrationRun.deleteMany();
  });

  afterAll(async () => {
    await prisma.eventConsumption.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.promptExecution.deleteMany();
    await prisma.traceStep.deleteMany();
    await prisma.orchestrationRun.deleteMany();
    await prisma.$disconnect();
    await redis.onModuleDestroy();
  });

  it('persists a run with steps and prompt executions and derives measured metrics', async () => {
    const turnId = randomUUID();
    const runId = runIdForTurn(turnId);
    const conversationId = randomUUID();
    const t0 = new Date('2026-09-12T10:00:00.000Z');

    await traces.startRun({
      runId,
      conversationId,
      turnId,
      correlationId: 'corr_run',
      messageIds: ['m1'],
      channel: 'web',
      startedAt: t0,
    });

    await traces.startStep({
      runId,
      requestId: 'req_idce',
      parentRequestId: 'req_root',
      correlationId: 'corr_run',
      conversationId,
      turnId,
      component: 'IDCE',
      componentVersion: '1.6',
      stage: 'understand.idce',
      schemaVersion: '1.0',
      startedAt: t0,
      inputSummary: { assembled_text: 'I need a wall socket', api_key: 'must-be-redacted' },
    });
    await traces.finishStep({
      requestId: 'req_idce',
      status: 'SUCCESS',
      completedAt: new Date(t0.getTime() + 300),
      decision: { reason_codes: ['EXPLICIT_BUY'], confidence: 0.97 },
      outputSummary: { intents: 1 },
      persistedRecordIds: ['intent_1'],
      promptExecutionIds: [],
      retryCount: 0,
      error: null,
    });

    const execution = (id: string, createdOffset: number, latencyMs: number) => ({
      id,
      requestId: `req_${id}`,
      parentRequestId: 'req_idce',
      correlationId: 'corr_run',
      conversationId,
      turnId,
      runId,
      component: 'IDCE',
      componentVersion: '1.6',
      promptId: 'idce.runtime.discover',
      promptVersion: '1.0.0',
      schemaId: 'https://metamarket.local/schemas/idce-resolution-1.0.json',
      schemaVersion: '1.0',
      modelProvider: 'openai',
      modelName: 'gpt-4o',
      inputHash: 'h',
      input: { text: 'x' },
      output: { ok: true },
      rawOutput: null,
      status: 'SUCCESS' as const,
      validationErrors: [],
      repairAttempts: 0,
      providerAttempts: 1,
      failedProviders: [],
      latencyMs,
      usage: { inputTokens: 1, outputTokens: 1 },
      decisionSummary: null,
      sharedInvocation: false,
      createdAt: new Date(t0.getTime() + createdOffset),
    });

    // Two parallel calls (both finish around +200), then one sequential call.
    await traces.recordPromptExecution(execution(randomUUID(), 200, 200));
    await traces.recordPromptExecution(execution(randomUUID(), 210, 200));
    await traces.recordPromptExecution(execution(randomUUID(), 400, 150));

    await traces.completeRun({
      runId,
      status: 'COMPLETED',
      completedAt: new Date(t0.getTime() + 450),
      finalResponse: { text: 'Found vendors' },
      error: null,
    });

    const view = await queries.run(runId);
    expect(view).not.toBeNull();
    expect(view!.run.status).toBe('COMPLETED');
    expect(view!.metrics.llmCallCount).toBe(3);
    expect(view!.metrics.parallelLlmWidth).toBe(2);
    expect(view!.metrics.sequentialLlmDepth).toBe(2);
    expect(view!.metrics.totalTurnLatencyMs).toBe(450);
    expect(view!.steps).toHaveLength(1);
    expect(view!.steps[0]!.latencyMs).toBe(300);

    // Secrets never reach the trace store.
    const stored = await prisma.traceStep.findUniqueOrThrow({ where: { requestId: 'req_idce' } });
    expect(JSON.stringify(stored.inputSummary)).not.toContain('must-be-redacted');
    expect(JSON.stringify(stored.inputSummary)).toContain('[redacted]');
  });

  it('stamps correlation, turn and run ids onto outbox rows from the ambient context', async () => {
    const turnId = randomUUID();
    const conversationId = randomUUID();

    await RequestContextStore.root({ correlationId: 'corr_outbox' }, () =>
      RequestContextStore.extend({ conversationId, turnId, runId: runIdForTurn(turnId) }, () =>
        publisher.publish(
          correlatedEvent({
            eventId: randomUUID(),
            eventType: 'MessageReceived',
            producer: 'MCOS',
            occurredAt: new Date(),
            payload: { messageId: 'm1' },
            aggregate: { type: 'Conversation', id: conversationId },
          }),
        ),
      ),
    );

    const row = await prisma.outboxEvent.findFirstOrThrow({ where: { conversationId } });
    expect(row.correlationId).toBe('corr_outbox');
    expect(row.turnId).toBe(turnId);
    expect(row.runId).toBe(`turn:${turnId}`);
    expect(row.eventVersion).toBe('1.0');
    expect(row.aggregateType).toBe('Conversation');
  });

  it('consumes each event exactly once per handler across failures, retries and re-ticks', async () => {
    const registry = new EventHandlerRegistry();
    const seenByA: string[] = [];
    const seenByB: string[] = [];
    let bFailuresLeft = 1;

    registry.register({
      name: 'handler-a',
      eventTypes: ['VendorResponded'],
      handle: async (event: CorrelatedDomainEvent) => {
        seenByA.push(event.eventId);
      },
    });
    registry.register({
      name: 'handler-b',
      eventTypes: '*',
      handle: async (event) => {
        if (bFailuresLeft > 0) {
          bFailuresLeft -= 1;
          throw new Error('transient failure');
        }
        seenByB.push(event.eventId);
      },
    });

    const worker = new OutboxConsumerWorker(prisma, registry, locks);
    const eventId = randomUUID();

    await publisher.publish(
      correlatedEvent({
        eventId,
        eventType: 'VendorResponded',
        producer: 'FULFILMENT',
        occurredAt: new Date(),
        payload: { vendorId: 'v1' },
      }),
    );

    // Tick 1: A succeeds, B fails → event stays unconsumed, A's consumption is recorded.
    expect(await worker.tick()).toBe(1);
    expect(seenByA).toEqual([eventId]);
    expect(seenByB).toEqual([]);
    let row = await prisma.outboxEvent.findFirstOrThrow({ where: { eventId } });
    expect(row.consumedAt).toBeNull();
    expect(row.consumptionAttempts).toBe(1);

    // Tick 2: only B runs (A is already in the ledger), and the event becomes consumed.
    expect(await worker.tick()).toBe(1);
    expect(seenByA).toEqual([eventId]);
    expect(seenByB).toEqual([eventId]);
    row = await prisma.outboxEvent.findFirstOrThrow({ where: { eventId } });
    expect(row.consumedAt).not.toBeNull();

    const consumptions = await prisma.eventConsumption.findMany({
      where: { eventId },
      orderBy: { consumer: 'asc' },
    });
    expect(consumptions.map((c) => [c.consumer, c.status])).toEqual([
      ['handler-a', 'CONSUMED'],
      ['handler-b', 'CONSUMED'],
    ]);

    // Tick 3: nothing left to claim.
    expect(await worker.tick()).toBe(0);
    worker.onModuleDestroy();
  });

  it('handlers observe the persisted correlation context of the event they consume', async () => {
    const registry = new EventHandlerRegistry();
    let observed: { correlationId?: string; runId?: string | null; component?: string | null } = {};
    registry.register({
      name: 'context-probe',
      eventTypes: ['ObservationRecorded'],
      handle: async () => {
        const context = RequestContextStore.current();
        observed = {
          correlationId: context?.correlationId,
          runId: context?.runId,
          component: context?.component,
        };
      },
    });
    const worker = new OutboxConsumerWorker(prisma, registry, locks);

    await RequestContextStore.root({ correlationId: 'corr_probe' }, () =>
      RequestContextStore.extend({ runId: 'turn:probe' }, () =>
        publisher.publish(
          correlatedEvent({
            eventId: randomUUID(),
            eventType: 'ObservationRecorded',
            producer: 'EVIDENCE',
            occurredAt: new Date(),
            payload: {},
          }),
        ),
      ),
    );

    await worker.tick();
    expect(observed).toEqual({
      correlationId: 'corr_probe',
      runId: 'turn:probe',
      component: 'context-probe',
    });
    worker.onModuleDestroy();
  });

  it('leader lock lets exactly one concurrent sweeper run', async () => {
    const leader = new LeaderLock(locks, `test:${randomUUID()}`);
    let concurrent = 0;
    let peak = 0;

    const sweep = () =>
      leader.runExclusively('sweeper', 5_000, async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 50));
        concurrent -= 1;
        return 'ran';
      });

    const results = await Promise.all([sweep(), sweep(), sweep()]);
    expect(results.filter((result) => result === 'ran')).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(2);
    expect(peak).toBe(1);
  });
});
