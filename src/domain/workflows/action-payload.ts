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

/**
 * Prefix marking a suggested option that carries no workflow reference.
 *
 * Distinct from {@link PREFIX} so {@link decodeActionPayload} rejects it outright: the routing
 * layer must never mistake a suggestion for a reference to a live workflow instance.
 */
const REPLAY_PREFIX = 'mmr';

/**
 * Encodes an option the AI suggested rather than a workflow offered.
 *
 * Such an option has nothing deterministic to point at, so tapping it re-enters the pipeline as
 * if the user had typed the option's words. That is the whole trick: the model can propose any
 * next step it likes and still cannot mint a button that routes somewhere undefined, because the
 * payload grants no authority — the text does the work, and the text is subject to the same
 * understanding and routing as anything else the user says.
 */
export function encodeReplayPayload(label: string): string {
  const encoded = `${REPLAY_PREFIX}${DELIMITER}${label.replace(new RegExp(`\\${DELIMITER}`, 'g'), '/')}`;

  // Truncated rather than rejected: a suggestion is cosmetic, and losing the tail of a long
  // label is better than failing to compose the reply it belongs to.
  return Buffer.byteLength(encoded, 'utf8') > MAX_PAYLOAD_BYTES
    ? encoded.slice(0, MAX_PAYLOAD_BYTES)
    : encoded;
}

/** The label a replay payload carries, or null when it is not one. */
export function decodeReplayPayload(raw: string): string | null {
  if (!raw.startsWith(`${REPLAY_PREFIX}${DELIMITER}`)) return null;

  const label = raw.slice(REPLAY_PREFIX.length + DELIMITER.length).trim();
  return label.length > 0 ? label : null;
}

export function isReplayPayload(raw: string | null): boolean {
  return raw !== null && decodeReplayPayload(raw) !== null;
}
