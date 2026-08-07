import { encodeActionPayload } from './action-payload';
import { encodeVendorResponse, resolveVendorResponse } from './vendor-response';

const REQUEST_ID = 'b7df6ac8-66f8-47fb-8333-cf1c214ea62e';

/**
 * The payload that carries a vendor's answer home (TDR §8).
 *
 * An accept spends the vendor's credits, so the asymmetry here is deliberate: anything the
 * platform did not mint must resolve to null, and null must mean "route normally" rather than
 * "assume decline". Reading a stray tap as either answer would be a real cost to a real vendor.
 */
describe('vendor response payloads', () => {
  it('round-trips an accept', () => {
    const payload = encodeVendorResponse({ requestId: REQUEST_ID, accepted: true });

    expect(payload).toBe(`mm|vendor-response|accept|${REQUEST_ID}`);
    expect(resolveVendorResponse(payload)).toEqual({ requestId: REQUEST_ID, accepted: true });
  });

  it('round-trips a decline', () => {
    const payload = encodeVendorResponse({ requestId: REQUEST_ID, accepted: false });

    expect(resolveVendorResponse(payload)).toEqual({ requestId: REQUEST_ID, accepted: false });
  });

  it('stays well inside the channel payload limit', () => {
    // Meta caps button ids at 256 bytes and rejects the message outright above it.
    expect(Buffer.byteLength(encodeVendorResponse({ requestId: REQUEST_ID, accepted: true }))).toBeLessThan(
      100,
    );
  });

  it('ignores a payload belonging to a real workflow instance', () => {
    const payload = encodeActionPayload({ workflowId: REQUEST_ID, action: 'accept', value: REQUEST_ID });

    expect(resolveVendorResponse(payload)).toBeNull();
  });

  it('ignores a system action', () => {
    expect(resolveVendorResponse('mm|system|recharge')).toBeNull();
  });

  it('ignores an action that is neither accept nor decline', () => {
    expect(resolveVendorResponse(`mm|vendor-response|confirm|${REQUEST_ID}`)).toBeNull();
  });

  it('ignores a payload with no request id, rather than answering for an unknown request', () => {
    expect(resolveVendorResponse('mm|vendor-response|accept')).toBeNull();
  });

  it('ignores text a user typed that merely looks like a payload', () => {
    expect(resolveVendorResponse('vendor-response accept please')).toBeNull();
    expect(resolveVendorResponse(null)).toBeNull();
  });
});
