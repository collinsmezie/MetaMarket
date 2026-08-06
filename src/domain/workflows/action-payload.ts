/**
 * Encoding for interactive action payloads.
 *
 * Every button and list row the platform sends carries the id of the workflow that offered
 * it. When the user taps it, the Workflow Manager resumes that exact instance with zero
 * semantic guesswork (MCOS §12 Stage 13, §15 Layer 1).
 *
 * The format is a delimited string rather than JSON because channels cap payload length
 * hard — Meta allows 256 bytes for a button id.
 */

const DELIMITER = '|';
const PREFIX = 'mm';

/** Meta's limit for interactive reply ids; other channels are more generous. */
export const MAX_PAYLOAD_BYTES = 256;

export interface ActionPayload {
  readonly workflowId: string;
  /** What the tap means to the workflow, e.g. `select_vendor`, `confirm_location`. */
  readonly action: string;
  /** Optional value the action operates on, e.g. the chosen vendor id. */
  readonly value?: string;
}

export class PayloadTooLongError extends Error {
  constructor(readonly encoded: string) {
    super(
      `Encoded action payload is ${Buffer.byteLength(encoded, 'utf8')} bytes, exceeding the ${MAX_PAYLOAD_BYTES}-byte channel limit: "${encoded}"`,
    );
    this.name = 'PayloadTooLongError';
  }
}

export function encodeActionPayload(payload: ActionPayload): string {
  for (const [field, value] of Object.entries(payload)) {
    if (typeof value === 'string' && value.includes(DELIMITER)) {
      throw new Error(`Action payload field "${field}" must not contain "${DELIMITER}": "${value}"`);
    }
  }

  const parts = [PREFIX, payload.workflowId, payload.action];
  if (payload.value !== undefined) parts.push(payload.value);

  const encoded = parts.join(DELIMITER);

  // Fail at compose time rather than letting the channel silently reject the message.
  if (Buffer.byteLength(encoded, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new PayloadTooLongError(encoded);
  }

  return encoded;
}

/**
 * Parses a payload echoed back by a channel.
 *
 * Returns null for anything the platform did not mint — users can send arbitrary text that
 * happens to arrive in a reply field, and that must not be trusted as a workflow reference.
 */
export function decodeActionPayload(raw: string): ActionPayload | null {
  if (!raw.startsWith(`${PREFIX}${DELIMITER}`)) return null;

  const parts = raw.split(DELIMITER);
  if (parts.length < 3 || parts.length > 4) return null;

  const [, workflowId, action, value] = parts;
  if (workflowId.length === 0 || action.length === 0) return null;

  return value === undefined || value.length === 0 ? { workflowId, action } : { workflowId, action, value };
}
