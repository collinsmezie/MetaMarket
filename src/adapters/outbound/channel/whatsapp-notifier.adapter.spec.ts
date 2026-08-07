import { RecordingStageLogger } from '@test/fakes';
import type { AppConfigService } from '../../../config/app-config.service';
import type { DeliveryTarget } from '../../../domain/ports/outbound/channel-notifier.port';
import { WhatsAppNotifier } from './whatsapp-notifier.adapter';

const TARGET: DeliveryTarget = {
  channel: 'whatsapp',
  address: '+2348012345678',
  conversationId: 'conv_1',
};

const config = {
  whatsapp: {
    accessToken: 'token',
    phoneNumberId: '123',
    graphApiVersion: 'v21.0',
  },
} as unknown as AppConfigService;

/** A `fetch` that plays a scripted sequence of outcomes, one per call. */
function scriptedFetch(steps: readonly (Error | { status: number; body?: unknown })[]) {
  const calls: unknown[] = [];

  const impl = async (_url: string, init: { body: string }) => {
    const step = steps[Math.min(calls.length, steps.length - 1)];
    calls.push(JSON.parse(init.body));

    if (step instanceof Error) throw step;

    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.body ?? { messages: [{ id: 'wamid.ok' }] },
    };
  };

  return { impl, calls };
}

/** Builds the shape undici produces: a bare TypeError with the real reason in `cause`. */
function fetchFailure(code: string, aggregate = false): Error {
  const inner = Object.assign(new Error(''), { code });
  const cause = aggregate ? Object.assign(new AggregateError([inner], ''), { code }) : inner;
  return Object.assign(new TypeError('fetch failed'), { cause });
}

function build(steps: readonly (Error | { status: number; body?: unknown })[]) {
  const logger = new RecordingStageLogger();
  const notifier = new WhatsAppNotifier(config, logger);
  const { impl, calls } = scriptedFetch(steps);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = impl;

  return { notifier, calls, logger };
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * The last mile (observed in production, 2026-08-07).
 *
 * A reply lost here is a user who asked something and got silence — there is no queue behind
 * this to try again. Two properties matter: transient faults must not lose the message, and an
 * ambiguous fault must not duplicate it.
 */
describe('WhatsAppNotifier delivery', () => {
  it('recovers from a transient connection failure', async () => {
    // Exactly the production failure: no IPv6 route, AAAA record, ETIMEDOUT on connect.
    const { notifier, calls } = build([fetchFailure('ETIMEDOUT', true), { status: 200 }]);

    const result = await notifier.send(TARGET, { text: 'hello' });

    expect(result.delivered).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('gives up after the attempt budget and reports the real reason', async () => {
    const { notifier, calls } = build([fetchFailure('ECONNREFUSED')]);

    const result = await notifier.send(TARGET, { text: 'hello' });

    expect(result.delivered).toBe(false);
    expect(calls).toHaveLength(3);
    // "fetch failed" alone is what made this untriageable in the first place.
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('names the underlying cause rather than the bare fetch error', async () => {
    const { notifier } = build([fetchFailure('ENOTFOUND')]);

    const result = await notifier.send(TARGET, { text: 'hello' });

    expect(result.error).toContain('WhatsApp send failed');
    expect(result.error).toContain('ENOTFOUND');
  });

  it('retries a 429, which Meta answered and definitively did not accept', async () => {
    const { notifier, calls } = build([{ status: 429 }, { status: 200 }]);

    const result = await notifier.send(TARGET, { text: 'hello' });

    expect(result.delivered).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('retries a 5xx', async () => {
    const { notifier, calls } = build([{ status: 503 }, { status: 200 }]);

    expect((await notifier.send(TARGET, { text: 'hello' })).delivered).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('never retries a 4xx decision, which would only burn quota', async () => {
    // Outside the 24-hour service window, bad token, invalid recipient: all final.
    const { notifier, calls } = build([
      { status: 400, body: { error: { message: 'Message failed to send outside the allowed window' } } },
    ]);

    const result = await notifier.send(TARGET, { text: 'hello' });

    expect(result.delivered).toBe(false);
    expect(calls).toHaveLength(1);
    expect(result.error).toContain('outside the allowed window');
  });

  it('never retries an ambiguous mid-flight failure, which could duplicate the message', async () => {
    // A reset socket may mean Meta accepted and delivered. WhatsApp offers no idempotency key,
    // and sending a vendor two deduction notices is worse than sending none.
    const { notifier, calls } = build([fetchFailure('ECONNRESET')]);

    expect((await notifier.send(TARGET, { text: 'hello' })).delivered).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('never retries our own client-side timeout, for the same reason', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
      code: 'ETIMEDOUT',
    });
    const { notifier, calls } = build([timeout]);

    expect((await notifier.send(TARGET, { text: 'hello' })).delivered).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('reports missing credentials without attempting a call', async () => {
    const logger = new RecordingStageLogger();
    const bare = new WhatsAppNotifier(
      { whatsapp: { graphApiVersion: 'v21.0' } } as unknown as AppConfigService,
      logger,
    );

    const result = await bare.send(TARGET, { text: 'hello' });

    expect(result.delivered).toBe(false);
    expect(result.error).toContain('WHATSAPP_ACCESS_TOKEN');
  });
});

describe('WhatsAppNotifier send deadline', () => {
  it('stops retrying before it could outlive the conversation lock', async () => {
    // The lock TTL is 30s and delivery runs inside the turn that holds it. Retrying past the
    // lock would let a second worker take the conversation while this one is still writing.
    const slowFailure = async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      throw fetchFailure('ETIMEDOUT');
    };

    const calls: number[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async () => {
      calls.push(Date.now());
      return slowFailure();
    };

    const notifier = new WhatsAppNotifier(config, new RecordingStageLogger());
    const started = Date.now();

    const result = await notifier.send(TARGET, { text: 'hello' });

    expect(result.delivered).toBe(false);
    // Well inside CONVERSATION_LOCK_TTL_MS, and it did genuinely retry.
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(calls.length).toBeGreaterThan(1);
  });
});
