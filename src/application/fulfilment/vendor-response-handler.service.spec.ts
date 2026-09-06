import { makeConversation, RecordingStageLogger } from '@test/fakes';
import type { Vendor } from '../../domain/models/vendor';
import type { VendorRepositoryPort } from '../../domain/ports/outbound/vendor-repository.port';
import { encodeVendorResponse } from '../../domain/workflows/vendor-response';
import type { RequestDistributionService } from './request-distribution.service';
import { VendorResponseHandler } from './vendor-response-handler.service';

const NOW = new Date('2026-08-07T10:00:00Z');
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

const VENDOR: Vendor = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '+2348012345678',
  conversationId: '22222222-2222-4222-8222-222222222222',
  businessName: 'Top Hardware',
  contactPhone: '+2348012345678',
  location: null,
  status: 'active',
  conversationSummary: '',
  onboardedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

function build(options: { vendor?: Vendor | null; outcome?: { revealed: boolean } | null } = {}) {
  const calls: { requestId: string; vendorId: string; accepted: boolean }[] = [];

  const vendors = {
    async findByUserId() {
      return options.vendor === undefined ? VENDOR : options.vendor;
    },
  } as unknown as VendorRepositoryPort;

  const distribution = {
    async recordVendorResponse(params: { requestId: string; vendorId: string; accepted: boolean }) {
      calls.push(params);
      return options.outcome === undefined ? { revealed: params.accepted } : options.outcome;
    },
  } as unknown as RequestDistributionService;

  const logger = new RecordingStageLogger();

  return { handler: new VendorResponseHandler(vendors, logger, distribution), calls, logger };
}

const conversation = makeConversation({ userId: VENDOR.userId });

const accept = encodeVendorResponse({ requestId: REQUEST_ID, accepted: true });
const decline = encodeVendorResponse({ requestId: REQUEST_ID, accepted: false });

/**
 * The vendor reply intake (TDR §9.2).
 *
 * The one thing that must never happen is an arbitrary tap being recorded as an accept, because
 * an accept spends the vendor's credits and reveals them to a stranger. Everything the handler
 * does not positively recognise returns null and routes normally.
 */
describe('VendorResponseHandler', () => {
  it('records an acceptance and tells the vendor they are in', async () => {
    const { handler, calls } = build();

    const reply = await handler.tryHandle({ conversation, interactivePayload: accept });

    expect(calls).toEqual([{ requestId: REQUEST_ID, vendorId: VENDOR.id, accepted: true }]);
    expect(reply?.text).toContain("You're in");
  });

  it('records a decline and says so without implying they were shown', async () => {
    const { handler, calls } = build();

    const reply = await handler.tryHandle({ conversation, interactivePayload: decline });

    expect(calls[0].accepted).toBe(false);
    expect(reply?.text).toContain('not available this time');
  });

  it('acknowledges an accept that could not be paid for, without repeating the reason', async () => {
    // recordVendorResponse has already sent the full missed-lead push with the recharge button.
    const { handler } = build({ outcome: { revealed: false } });

    const reply = await handler.tryHandle({ conversation, interactivePayload: accept });

    expect(reply?.text).toContain("wasn't shared this time");
    expect(reply?.text).not.toContain('visibility fee');
  });

  it('tells a vendor tapping a stale button that the request has closed, and changes nothing', async () => {
    const { handler } = build({ outcome: null });

    const reply = await handler.tryHandle({ conversation, interactivePayload: accept });

    expect(reply?.text).toContain('no longer open');
  });

  it('is inert when tapped from a conversation with no vendor behind it', async () => {
    // The identity comes from the conversation, never the payload, so a leaked button cannot
    // touch the delivery it names.
    const { handler, calls, logger } = build({ vendor: null });

    const reply = await handler.tryHandle({ conversation, interactivePayload: accept });

    expect(calls).toHaveLength(0);
    expect(reply?.text).toBe('This link is no longer active.');
    expect(logger.failures).toHaveLength(1);
  });

  it('declines to handle anything that is not a vendor response', async () => {
    const { handler, calls } = build();

    for (const payload of [null, 'mm|system|recharge', 'mm|vendor-response|confirm|x', 'yes please']) {
      expect(await handler.tryHandle({ conversation, interactivePayload: payload })).toBeNull();
    }

    expect(calls).toHaveLength(0);
  });
});
