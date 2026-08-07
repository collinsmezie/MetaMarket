import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PrismaOutboundMessageRepository } from '../../src/adapters/outbound/persistence/prisma-outbound-message.repository';
import { PrismaService } from '../../src/adapters/outbound/persistence/prisma.service';
import { AppConfigModule } from '../../src/config/config.module';

/**
 * The durable outbound queue against real Postgres.
 *
 * Everything here is a property of the database rather than of the code: the `FOR UPDATE SKIP
 * LOCKED` lease, and the transactional backlog check that keeps two concurrently-composed
 * replies from both deciding they are first in line. An in-memory fake cannot prove either, and
 * those are exactly the two that would corrupt a user's conversation if they were wrong.
 */
describe('Outbound message queue', () => {
  let prisma: PrismaService;
  let queue: PrismaOutboundMessageRepository;

  const NOW = new Date('2026-08-07T10:00:00Z');
  const CONVERSATION = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [PrismaService, PrismaOutboundMessageRepository],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    queue = moduleRef.get(PrismaOutboundMessageRepository);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.outboundMessage.deleteMany();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.outboundMessage.deleteMany();
  });

  const enqueue = (text: string, at = NOW, conversationId = CONVERSATION) =>
    queue.enqueue({
      id: randomUUID(),
      channel: 'whatsapp',
      address: '+2348012345678',
      conversationId,
      response: { text },
      at,
    });

  it('round-trips the canonical response, including its actions', async () => {
    // Stored unrendered, so a fix to channel rendering also applies to messages already queued.
    const { message } = await queue.enqueue({
      id: randomUUID(),
      channel: 'whatsapp',
      address: '+2348012345678',
      conversationId: CONVERSATION,
      response: {
        text: 'Can you help?',
        actions: [{ type: 'vendor_response', title: 'Yes', payload: 'mm|vendor-response|accept|x' }],
      },
      at: NOW,
    });

    const [claimed] = await queue.claimDue({ batchSize: 10, now: NOW, leaseMs: 1_000 });

    expect(claimed.id).toBe(message.id);
    expect(claimed.response).toEqual({
      text: 'Can you help?',
      actions: [{ type: 'vendor_response', title: 'Yes', payload: 'mm|vendor-response|accept|x' }],
    });
  });

  it('reports no backlog for the first message of a conversation', async () => {
    expect((await enqueue('first')).hasBacklog).toBe(false);
  });

  it('reports a backlog while an earlier message is still pending', async () => {
    await enqueue('first');
    expect((await enqueue('second', new Date(NOW.getTime() + 1_000))).hasBacklog).toBe(true);
  });

  it('reports no backlog once the earlier message is delivered', async () => {
    const { message } = await enqueue('first');
    await queue.markSent(message.id, { at: NOW });

    expect((await enqueue('second', new Date(NOW.getTime() + 1_000))).hasBacklog).toBe(false);
  });

  it('does not see another conversation as a backlog', async () => {
    await enqueue('theirs', NOW, '22222222-2222-4222-8222-222222222222');
    expect((await enqueue('mine')).hasBacklog).toBe(false);
  });

  it('leases claimed rows so a concurrent sweeper takes nothing', async () => {
    await enqueue('first');
    await enqueue('second', new Date(NOW.getTime() + 1_000));

    const due = new Date(NOW.getTime() + 5_000);
    const first = await queue.claimDue({ batchSize: 10, now: due, leaseMs: 60_000 });
    const second = await queue.claimDue({ batchSize: 10, now: due, leaseMs: 60_000 });

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(0);
  });

  it('hands two concurrent sweepers disjoint rows, never the same message twice', async () => {
    // The property `FOR UPDATE SKIP LOCKED` exists for. Two pods sweeping at once must not both
    // deliver the same reply.
    for (let i = 0; i < 10; i += 1) await enqueue(`m${i}`, new Date(NOW.getTime() + i));

    const due = new Date(NOW.getTime() + 5_000);
    const [left, right] = await Promise.all([
      queue.claimDue({ batchSize: 10, now: due, leaseMs: 60_000 }),
      queue.claimDue({ batchSize: 10, now: due, leaseMs: 60_000 }),
    ]);

    const ids = [...left, ...right].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(10);
  });

  it('lets a lease expire so a crashed sweeper strands nothing', async () => {
    await enqueue('first');
    await queue.claimDue({ batchSize: 10, now: NOW, leaseMs: 30_000 });

    const later = new Date(NOW.getTime() + 31_000);
    expect(await queue.claimDue({ batchSize: 10, now: later, leaseMs: 30_000 })).toHaveLength(1);
  });

  it('claims oldest first, so replies keep the order they were composed', async () => {
    await enqueue('third', new Date(NOW.getTime() + 3_000));
    await enqueue('first', NOW);
    await enqueue('second', new Date(NOW.getTime() + 1_000));

    const claimed = await queue.claimDue({
      batchSize: 10,
      now: new Date(NOW.getTime() + 9_000),
      leaseMs: 1_000,
    });

    expect(claimed.map((row) => (row.response as { text: string }).text)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('does not claim a message whose backoff has not elapsed', async () => {
    const { message } = await enqueue('first');
    await queue.scheduleRetry(message.id, {
      error: 'ETIMEDOUT',
      nextAttemptAt: new Date(NOW.getTime() + 60_000),
    });

    expect(await queue.claimDue({ batchSize: 10, now: NOW, leaseMs: 1_000 })).toHaveLength(0);
  });

  it('never claims a parked message', async () => {
    const { message } = await enqueue('first');
    await queue.markFailed(message.id, { error: 'outside the 24-hour window' });

    expect(await queue.claimDue({ batchSize: 10, now: NOW, leaseMs: 1_000 })).toHaveLength(0);
  });

  it('counts attempts across retries so the budget is real', async () => {
    const { message } = await enqueue('first');
    await queue.scheduleRetry(message.id, { error: 'a', nextAttemptAt: NOW });
    await queue.scheduleRetry(message.id, { error: 'b', nextAttemptAt: NOW });

    const [claimed] = await queue.claimDue({ batchSize: 10, now: NOW, leaseMs: 1_000 });
    expect(claimed.attempts).toBe(2);
    expect(claimed.lastError).toBe('b');
  });

  it('purges delivered messages past retention but keeps parked ones for the operator', async () => {
    const { message: sent } = await enqueue('sent');
    const { message: failed } = await enqueue('failed', new Date(NOW.getTime() + 1));
    await queue.markSent(sent.id, { at: NOW });
    await queue.markFailed(failed.id, { error: 'permanent' });

    const removed = await queue.purgeSent({ sentBefore: new Date(NOW.getTime() + 1_000), limit: 100 });

    expect(removed).toBe(1);
    expect(await prisma.outboundMessage.count()).toBe(1);
  });
});
