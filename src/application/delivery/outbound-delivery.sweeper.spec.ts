import { FrozenClock, InMemoryOutboundQueue, RecordingStageLogger } from '@test/fakes';
import { MAX_OUTBOUND_ATTEMPTS } from '../../domain/models/outbound-message';
import type { Response } from '../../domain/models/response';
import type {
  ChannelNotifierRegistryPort,
  DeliveryResult,
  DeliveryTarget,
} from '../../domain/ports/outbound/channel-notifier.port';
import { OutboundDeliverySweeper } from './outbound-delivery.sweeper';

const NOW = new Date('2026-08-07T10:00:00Z');

function build(options: { results?: DeliveryResult[]; supported?: boolean } = {}) {
  const queue = new InMemoryOutboundQueue();
  const sent: { target: DeliveryTarget; response: Response }[] = [];
  const results = options.results ?? [{ delivered: true, providerMessageId: 'wamid.1' }];

  const notifiers = {
    supports: () => options.supported ?? true,
    forChannel: () => ({
      channel: 'whatsapp',
      async send(target: DeliveryTarget, response: Response) {
        sent.push({ target, response });
        return results[Math.min(sent.length - 1, results.length - 1)];
      },
    }),
  } as unknown as ChannelNotifierRegistryPort;

  const logger = new RecordingStageLogger();
  const clock = new FrozenClock(NOW);

  const sweeper = new OutboundDeliverySweeper(queue, notifiers, logger, clock);

  const enqueue = async (conversationId: string, text: string) => {
    const { message } = await queue.enqueue({
      id: `msg_${queue.rows.length + 1}`,
      channel: 'whatsapp',
      address: '+2348012345678',
      conversationId,
      response: { text },
      at: NOW,
    });
    return message.id;
  };

  return { sweeper, queue, sent, logger, enqueue, clock };
}

/**
 * Draining the durable queue.
 *
 * This is the half that turns a channel outage into a delayed message rather than a lost one.
 * The ordering rule is the subtle part: a chat product that delivers the second reply while the
 * first is still stuck reads as broken, so a conversation stops at its first failure.
 */
describe('OutboundDeliverySweeper', () => {
  it('delivers a queued message and marks it sent', async () => {
    const { sweeper, queue, sent, enqueue } = build();
    const id = await enqueue('conv_1', 'delayed reply');

    const counts = await sweeper.drain();

    expect(counts.sent).toBe(1);
    expect(sent[0].response).toEqual({ text: 'delayed reply' });
    expect(queue.byId(id)).toMatchObject({ status: 'sent', providerMessageId: 'wamid.1' });
  });

  it('reschedules a retryable failure with backoff rather than dropping it', async () => {
    const { sweeper, queue, enqueue } = build({
      results: [{ delivered: false, error: 'ETIMEDOUT', retryable: true }],
    });
    const id = await enqueue('conv_1', 'delayed reply');

    const counts = await sweeper.drain();

    expect(counts.retried).toBe(1);
    const row = queue.byId(id);
    expect(row?.status).toBe('pending');
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('parks a message whose attempt budget is spent', async () => {
    const { sweeper, queue, enqueue } = build({
      results: [{ delivered: false, error: 'ETIMEDOUT', retryable: true }],
    });
    const id = await enqueue('conv_1', 'doomed');
    await queue.scheduleRetry(id, { error: 'x', nextAttemptAt: NOW });
    // One short of the budget, so this sweep is the last attempt.
    for (let i = 0; i < MAX_OUTBOUND_ATTEMPTS - 2; i += 1) {
      await queue.scheduleRetry(id, { error: 'x', nextAttemptAt: NOW });
    }

    const counts = await sweeper.drain();

    expect(counts.failed).toBe(1);
    expect(queue.byId(id)?.status).toBe('failed');
  });

  it('parks a permanent rejection immediately', async () => {
    const { sweeper, queue, enqueue } = build({
      results: [{ delivered: false, error: 'outside the 24-hour window', retryable: false }],
    });
    const id = await enqueue('conv_1', 'too late');

    await sweeper.drain();

    expect(queue.byId(id)?.status).toBe('failed');
  });

  it('stops a conversation at its first failure, so replies never overtake each other', async () => {
    const { sweeper, queue, sent, enqueue } = build({
      results: [{ delivered: false, error: 'ETIMEDOUT', retryable: true }],
    });
    const first = await enqueue('conv_1', 'first');
    const second = await enqueue('conv_1', 'second');

    await sweeper.drain();

    // Only the blocked one was attempted; the later reply was not sent ahead of it.
    expect(sent).toHaveLength(1);
    expect(queue.byId(first)?.attempts).toBe(1);
    expect(queue.byId(second)?.attempts).toBe(0);
  });

  it('keeps draining other conversations when one is stuck', async () => {
    const { sweeper, sent, enqueue } = build({
      results: [{ delivered: false, error: 'ETIMEDOUT', retryable: true }, { delivered: true }],
    });
    await enqueue('conv_1', 'stuck');
    await enqueue('conv_2', 'fine');

    const counts = await sweeper.drain();

    expect(sent).toHaveLength(2);
    expect(counts).toMatchObject({ retried: 1, sent: 1 });
  });

  it('delivers in composition order', async () => {
    const { sweeper, sent, enqueue } = build();
    await enqueue('conv_1', 'first');
    await enqueue('conv_1', 'second');
    await enqueue('conv_1', 'third');

    await sweeper.drain();

    expect(sent.map((entry) => entry.response.text)).toEqual(['first', 'second', 'third']);
  });

  it('leases what it claims, so a second sweeper takes nothing', async () => {
    const { sweeper, queue, enqueue, clock } = build({
      results: [{ delivered: false, error: 'ETIMEDOUT', retryable: true }],
    });
    await enqueue('conv_1', 'first');

    await sweeper.drain();

    const stillDue = await queue.claimDue({ batchSize: 10, now: clock.now(), leaseMs: 1_000 });
    expect(stillDue).toHaveLength(0);
  });

  it('parks a message for a channel nothing can deliver, instead of cycling it forever', async () => {
    const { sweeper, queue, enqueue } = build({ supported: false });
    const id = await enqueue('conv_1', 'orphan');

    await sweeper.drain();

    expect(queue.byId(id)?.status).toBe('failed');
  });

  it('survives a notifier that breaks its contract and throws', async () => {
    const { sweeper, queue, enqueue } = build();
    const id = await enqueue('conv_1', 'reply');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sweeper as any).notifiers.forChannel = () => ({
      channel: 'whatsapp',
      send: async () => {
        throw new Error('adapter blew up');
      },
    });

    await expect(sweeper.drain()).resolves.toBeDefined();
    expect(queue.byId(id)?.status).toBe('failed');
  });

  it('does nothing when the queue is empty', async () => {
    const { sweeper, sent } = build();

    expect(await sweeper.drain()).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });
});
