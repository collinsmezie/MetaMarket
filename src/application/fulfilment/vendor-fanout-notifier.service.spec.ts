import { RecordingEventPublisher, RecordingStageLogger, SequentialIdGenerator } from '@test/fakes';
import type { Response } from '../../domain/models/response';
import type { Vendor } from '../../domain/models/vendor';
import type {
  ChannelNotifierRegistryPort,
  DeliveryResult,
  DeliveryTarget,
} from '../../domain/ports/outbound/channel-notifier.port';
import type { ConversationContextManager } from '../conversation/conversation-context.manager';
import { VendorFanoutNotifier } from './vendor-fanout-notifier.service';

const NOW = new Date('2026-08-07T10:00:00Z');

const VENDOR: Vendor = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '+2348012345678',
  conversationId: '22222222-2222-4222-8222-222222222222',
  businessName: 'Top Hardware',
  location: { city: 'Aba', state: 'Abia', country: 'Nigeria', confidence: 1 },
  status: 'active',
  conversationSummary: '',
  onboardedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

function build(options: { supported?: boolean; result?: DeliveryResult; throws?: Error } = {}) {
  const sent: { address: string; response: Response }[] = [];
  const recorded: string[] = [];

  const notifiers = {
    supports: () => options.supported ?? true,
    forChannel: () => ({
      channel: 'whatsapp',
      async send(target: DeliveryTarget, response: Response) {
        if (options.throws !== undefined) throw options.throws;
        sent.push({ address: target.address, response });
        return options.result ?? { delivered: true, providerMessageId: 'wamid.1' };
      },
    }),
  } as unknown as ChannelNotifierRegistryPort;

  const context = {
    async recordAssistantTurn(params: { content: string }) {
      recorded.push(params.content);
    },
  } as unknown as ConversationContextManager;

  const events = new RecordingEventPublisher();
  const logger = new RecordingStageLogger();

  const notifier = new VendorFanoutNotifier(
    notifiers,
    events,
    logger,
    { now: () => NOW },
    new SequentialIdGenerator(),
    context,
  );

  return { notifier, sent, recorded, events, logger };
}

const ask = (overrides: Partial<Parameters<VendorFanoutNotifier['notifyVendor']>[0]> = {}) => ({
  requestId: REQUEST_ID,
  deliveryId: 'delivery_1',
  vendor: VENDOR,
  capabilityName: 'Hammers',
  customerCity: 'Aba',
  fee: 100,
  ...overrides,
});

/**
 * The vendor ask (TDR §9.1).
 *
 * Two properties carry the feature. The buttons must carry payloads the intake can resolve —
 * get that wrong and the vendor's tap goes nowhere. And nothing here may throw: the ask fires
 * after the customer's request is committed, so a vendor with an unreachable phone must not be
 * able to break someone else's search.
 */
describe('VendorFanoutNotifier', () => {
  it('asks the vendor with interactive buttons carrying resolvable payloads', async () => {
    const { notifier, sent } = build();

    await notifier.notifyVendor(ask());

    expect(sent[0].address).toBe(VENDOR.userId);
    expect(sent[0].response.actions).toEqual([
      {
        type: 'vendor_response',
        title: 'Yes, I have it',
        payload: `mm|vendor-response|accept_have|${REQUEST_ID}`,
      },
      {
        type: 'vendor_response',
        title: 'I can get it',
        payload: `mm|vendor-response|accept_get|${REQUEST_ID}`,
      },
      {
        type: 'vendor_response',
        title: "No, I don't have it",
        payload: `mm|vendor-response|decline|${REQUEST_ID}`,
      },
    ]);
  });

  it('names the capability and customer location', async () => {
    const { notifier, sent } = build();

    await notifier.notifyVendor(ask());

    const text = sent[0].response.text ?? '';
    expect(text).toContain('Hammers');
    expect(text).toContain('in Aba');
    expect(text).toContain('1. Yes, I have it');
  });

  it('falls back to the vendor city when the customer did not give one', async () => {
    const { notifier, sent } = build();

    await notifier.notifyVendor(ask({ customerCity: null }));

    expect(sent[0].response.text).toContain('in Aba');
  });

  it('publishes vendor.notified only once the ask actually reached the vendor', async () => {
    // The event means "was asked". A later timeout is only interpretable as silence if the
    // question was heard.
    const { notifier, events } = build();

    await notifier.notifyVendor(ask());

    expect(events.types()).toContain('vendor.notified');
  });

  it('publishes nothing when the channel rejects the ask, and does not throw', async () => {
    const { notifier, events, logger } = build({
      result: { delivered: false, error: 'outside the 24-hour window' },
    });

    await expect(notifier.notifyVendor(ask())).resolves.toBeUndefined();

    expect(events.types()).not.toContain('vendor.notified');
    expect(logger.failures).toHaveLength(1);
  });

  it('degrades without throwing when no WhatsApp notifier is registered', async () => {
    const { notifier, events, logger } = build({ supported: false });

    await expect(notifier.notifyVendor(ask())).resolves.toBeUndefined();

    expect(events.types()).not.toContain('vendor.notified');
    expect(logger.failures).toHaveLength(1);
  });

  it('swallows an unexpected throw: the customer request is already committed', async () => {
    const { notifier, logger } = build({ throws: new Error('socket hang up') });

    await expect(notifier.notifyVendor(ask())).resolves.toBeUndefined();
    expect(logger.failures).toHaveLength(1);
  });

  it('records the ask in the vendor conversation so their tap has context behind it', async () => {
    const { notifier, recorded } = build();

    await notifier.notifyVendor(ask());

    expect(recorded[0]).toContain('Hammers');
  });
});
