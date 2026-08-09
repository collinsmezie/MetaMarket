import { decodeActionPayload, encodeActionPayload } from './action-payload';

/**
 * Vendor answers to a fanned-out request (Vendor Fan-Out TDR §8).
 *
 * The second reserved, non-instance workflow id, alongside `system` (system-actions.ts). The two
 * exist for opposite reasons and it is worth keeping them apart: a `system` button *starts* a new
 * objective, while a `vendor-response` button *answers* a distribution that already happened. A
 * vendor tapping "Yes, I have it" is performing a marketplace action, not opening a conversation,
 * so no workflow instance is minted for it.
 *
 * `vendor-response` cannot collide with a real instance id because instance ids are UUIDs.
 */

export const VENDOR_RESPONSE_WORKFLOW_ID = 'vendor-response';

const ACCEPT = 'accept';
const DECLINE = 'decline';

export interface VendorResponseAction {
  readonly requestId: string;
  readonly accepted: boolean;
}

/** Mints the button payload carried out to the vendor and echoed back verbatim on a tap. */
export function encodeVendorResponse(params: { requestId: string; accepted: boolean }): string {
  return encodeActionPayload({
    workflowId: VENDOR_RESPONSE_WORKFLOW_ID,
    action: params.accepted ? ACCEPT : DECLINE,
    value: params.requestId,
  });
}

/**
 * Reads a vendor's answer out of an interactive payload.
 *
 * Returns null for anything else — an ordinary workflow payload, a `system` action, a payload the
 * platform did not mint, or a `vendor-response` payload missing its request id. Null means "route
 * this turn normally", never "fail": the one thing that must never happen is an arbitrary tap
 * being read as an accept, because an accept spends the vendor's credits.
 */
export function resolveVendorResponse(interactivePayload: string | null): VendorResponseAction | null {
  if (interactivePayload === null) return null;

  const decoded = decodeActionPayload(interactivePayload);
  if (decoded === null || decoded.workflowId !== VENDOR_RESPONSE_WORKFLOW_ID) return null;
  if (decoded.action !== ACCEPT && decoded.action !== DECLINE) return null;
  if (decoded.value === undefined || decoded.value.length === 0) return null;

  return { requestId: decoded.value, accepted: decoded.action === ACCEPT };
}
