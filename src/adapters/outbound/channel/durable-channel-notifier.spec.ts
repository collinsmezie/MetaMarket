import { FrozenClock, InMemoryOutboundQueue, RecordingStageLogger, SequentialIdGenerator } from '@test/fakes';
import type { Response } from '../../../domain/models/response';
import type {
  ChannelNotifierPort,
  DeliveryResult,
  DeliveryTarget,
} from '../../../domain/ports/outbound/channel-notifier.port';
import type { OutboundMessageRepositoryPort } from '../../../domain/ports/outbound/outbound-message-repository.port';
import { DurableChannelNotifier } from './durable-channel-notifier';

const TARGET: DeliveryTarget = {
  channel: 'whatsapp',
  address: '+2348012345678',
  conversationId: 'conv_1',
};

const REPLY: Response = { text: 'here are your matches' };

class ScriptedNotifier implements ChannelNotifierPort {
  readonly channel = 'whatsapp' as const;
  readonly sent: Response[] = [];

  constructor(private readonly results: DeliveryResult[]) {}

  async send(_target: DeliveryTarget, response: Response): Promise<DeliveryResult> {
    this.sent.push(response);
    return this.results[Math.min(this.sent.length - 1, this.results.length - 1)];
  }
}

function build(
  results: DeliveryResult[],
  queue: OutboundMessageRepositoryPort = new InMemoryOutboundQueue(),
) {
  const inner = new ScriptedNotifier(results);
  const logger = new RecordingStageLogger();

  const notifier = new DurableChannelNotifier(
    inner,
    queue,
    logger,
    new FrozenClock(),
    new SequentialIdGenerator(),
  );

  return { notifier, inner, queue, logger };
}

/**
 * The write-ahead guarantee (2026-08-07: a reply was lost to a Graph API timeout).
 *
 * The row is written before the send is attempted, so the inline attempt is an optimisation and
 * the queue is the guarantee. The two properties that matter: nothing the platform decided to
 * say can be lost, and nothing can be said twice or out of order.
 */
describe('DurableChannelNotifier', () => {
  it('writes the message down before attempting to send it', async () => {
    const { notifier, queue } = build([{ delivered: true, providerMessageId: 'wamid.1' }]);

    await notifier.send(TARGET, REPLY);

    const rows = (queue as InMemoryOutboundQueue).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].response).toEqual(REPLY);
  });

  it('marks the row sent when the inline attempt succeeds', async () => {
    const { notifier, queue } = build([{ delivered: true, providerMessageId: 'wamid.1' }]);

    const result = await notifier.send(TARGET, REPLY);

    expect(result.delivered).toBe(true);
    expect((queue as InMemoryOutboundQueue).rows[0]).toMatchObject({
      status: 'sent',
      providerMessageId: 'wamid.1',
    });
  });

  it('queues a retryable failure instead of losing the reply', async () => {
    const { notifier, queue } = build([
      { delivered: false, error: 'fetch failed: ETIMEDOUT', retryable: true },
    ]);

    const result = await notifier.send(TARGET, REPLY);

    expect(result).toMatchObject({ delivered: false, queued: true });
    const row = (queue as InMemoryOutboundQueue).rows[0];
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(row.createdAt.getTime());
  });

  it('parks an ambiguous failure rather than risking a duplicate', async () => {
    // A reset socket may mean the message was delivered; no channel here has an idempotency
    // key, so a retry could send the user the same thing twice.
    const { notifier, queue } = build([
      { delivered: false, error: 'fetch failed: ECONNRESET', retryable: false },
    ]);

    const result = await notifier.send(TARGET, REPLY);

    expect(result.queued).toBeUndefined();
    expect((queue as InMemoryOutboundQueue).rows[0].status).toBe('failed');
  });

  it('treats an unknown retryability as not retryable', async () => {
    const { notifier, queue } = build([{ delivered: false, error: 'who knows' }]);

    await notifier.send(TARGET, REPLY);

    expect((queue as InMemoryOutboundQueue).rows[0].status).toBe('failed');
  });

  it('holds a reply back when the conversation is already owed an earlier one', async () => {
    // Sending now would put this in front of a message the user has not received, and a chat
    // that answers the second question first reads as broken.
    const queue = new InMemoryOutboundQueue();
    const { notifier, inner } = build(
      [{ delivered: false, error: 'ETIMEDOUT', retryable: true }, { delivered: true }],
      queue,
    );

    await notifier.send(TARGET, { text: 'first' });
    const second = await notifier.send(TARGET, { text: 'second' });

    expect(second).toEqual({ delivered: false, queued: true });
    // Only the first was ever handed to the channel.
    expect(inner.sent).toEqual([{ text: 'first' }]);
    expect(queue.rows.map((row) => row.status)).toEqual(['pending', 'pending']);
  });

  it('does not hold a reply back for an unrelated conversation', async () => {
    const queue = new InMemoryOutboundQueue();
    const { notifier, inner } = build(
      [{ delivered: false, error: 'ETIMEDOUT', retryable: true }, { delivered: true }],
      queue,
    );

    await notifier.send(TARGET, { text: 'first' });
    await notifier.send({ ...TARGET, conversationId: 'conv_2' }, { text: 'other' });

    expect(inner.sent).toHaveLength(2);
  });

  it('still sends when the queue write fails, rather than swallowing the reply', async () => {
    // The database is the durability mechanism, so there is nothing to fall back to — but an
    // unsendable message is strictly worse than an unlogged one.
    const broken = {
      enqueue: async () => {
        throw new Error('database down');
      },
    } as unknown as OutboundMessageRepositoryPort;

    const { notifier, inner, logger } = build([{ delivered: true }], broken);

    const result = await notifier.send(TARGET, REPLY);

    expect(result.delivered).toBe(true);
    expect(inner.sent).toHaveLength(1);
    expect(logger.failures).toHaveLength(1);
  });

  it('never fails a delivered message over bookkeeping', async () => {
    const queue = new InMemoryOutboundQueue();
    queue.markSent = async () => {
      throw new Error('write failed');
    };

    const { notifier, logger } = build([{ delivered: true }], queue);

    await expect(notifier.send(TARGET, REPLY)).resolves.toMatchObject({ delivered: true });
    expect(logger.failures).toHaveLength(1);
  });
});
