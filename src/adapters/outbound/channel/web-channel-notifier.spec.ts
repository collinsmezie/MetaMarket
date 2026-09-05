import { FrozenClock, RecordingStageLogger } from '@test/fakes';
import type { Response } from '../../../domain/models/response';
import type { DeliveryTarget } from '../../../domain/ports/outbound/channel-notifier.port';
import { WebChannelNotifier } from './web-channel-notifier.adapter';
import type { WebStreamEvent, WebStreamHub } from './web-stream.hub';

const TARGET: DeliveryTarget = {
  channel: 'web',
  address: 'web:sess_1',
  conversationId: 'conv_1',
};

const REPLY: Response = { text: 'here are your matches', metadata: { workflowId: 'wf_9' } };

/** Stands in for Redis pub/sub: records what was published and how many heard it. */
class FakeHub {
  readonly published: WebStreamEvent[] = [];

  constructor(private readonly receivers: number | Error) {}

  async publish(event: WebStreamEvent): Promise<number> {
    if (this.receivers instanceof Error) throw this.receivers;
    this.published.push(event);
    return this.receivers;
  }
}

function build(receivers: number | Error) {
  const hub = new FakeHub(receivers);
  const logger = new RecordingStageLogger();
  const notifier = new WebChannelNotifier(hub as unknown as WebStreamHub, logger, new FrozenClock());

  return { hub, logger, notifier };
}

describe('WebChannelNotifier', () => {
  it('reports delivery when a client is listening', async () => {
    const { hub, notifier } = build(1);

    const result = await notifier.send(TARGET, REPLY);

    expect(result).toEqual({ delivered: true, messageCount: 1 });
    expect(hub.published).toHaveLength(1);

    const [event] = hub.published;
    expect(event.kind).toBe('message');
    if (event.kind !== 'message') return;
    expect(event.response).toEqual(REPLY);
    expect(event.workflowId).toBe('wf_9');
  });

  it('reports a retryable failure when nobody is listening, so the reply is queued not lost', async () => {
    const { notifier } = build(0);

    const result = await notifier.send(TARGET, REPLY);

    // The decorator queues on exactly this shape; reporting delivered here would drop every
    // reply that landed while the browser was closed.
    expect(result.delivered).toBe(false);
    expect(result.retryable).toBe(true);
  });

  it('treats a publish failure as retryable, because nothing was published to duplicate', async () => {
    const { notifier, logger } = build(new Error('redis unreachable'));

    const result = await notifier.send(TARGET, REPLY);

    expect(result.delivered).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toBe('redis unreachable');
    expect(logger.failures.length).toBeGreaterThan(0);
  });

  it('publishes a typing indicator without queueing it', async () => {
    const { hub, notifier } = build(1);

    await notifier.indicateTyping({ channel: 'web', address: TARGET.address, conversationId: 'conv_1' });

    expect(hub.published.map((event) => event.kind)).toEqual(['typing']);
  });

  it('swallows a typing failure, because a late hint is worse than none', async () => {
    const { notifier } = build(new Error('redis unreachable'));

    await expect(
      notifier.indicateTyping({ channel: 'web', address: TARGET.address, conversationId: 'conv_1' }),
    ).resolves.toBeUndefined();
  });
});
