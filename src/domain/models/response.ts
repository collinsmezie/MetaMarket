/**
 * Canonical outbound response model (MCOS §13).
 *
 * Workflows produce this shape and never a provider payload. Adapters render it into
 * WhatsApp interactive messages, SMS text, TwiML, or a USSD menu.
 */

export interface Media {
  readonly type: 'image' | 'audio' | 'video' | 'document';
  /** Publicly reachable URL, or a storage key the outbound adapter can resolve. */
  readonly url: string;
  readonly mimeType?: string;
  readonly caption?: string;
  readonly filename?: string;
}

/**
 * An interactive affordance offered to the user.
 *
 * `payload` is minted by the platform and echoed back verbatim by the channel, so it is
 * the deterministic route home to the workflow that offered it. Encoding the workflow id
 * here is what keeps resumption free of AI guesswork (MCOS §12 Stage 13, §15 Layer 1).
 */
export interface Action {
  readonly type: string;
  readonly title: string;
  readonly payload: string;
  readonly description?: string;
}

export interface Response {
  readonly text?: string;
  readonly media?: readonly Media[];
  readonly actions?: readonly Action[];
  /**
   * Non-user-facing hints for the outbound adapter and for observability,
   * e.g. which workflow composed this, or that it is a fallback envelope.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The single response returned when the platform cannot understand or cannot proceed
 * (Execution.md §2.5).
 *
 * This exists so that a total AI failure degrades into one honest, actionable message
 * rather than a generic greeting loop. It deliberately tells the user what to do next.
 */
export const FALLBACK_ENVELOPE: Response = {
  text: [
    'Hello! Welcome to MetaMarket. I want to make sure I help you with the right thing.',
    '',
    'Are you looking to buy something, or do you want to list your business so buyers can find you?',
  ].join('\n'),
  metadata: { fallback: true, reason: 'understanding_failed' },
};

export function isFallbackResponse(response: Response): boolean {
  return response.metadata?.fallback === true;
}

/** Builds a fallback response that records *why* it was produced, for later diagnosis. */
export function fallbackWithReason(reason: string): Response {
  return {
    ...FALLBACK_ENVELOPE,
    metadata: { ...FALLBACK_ENVELOPE.metadata, reason },
  };
}

export function textResponse(text: string, metadata?: Record<string, unknown>): Response {
  return metadata ? { text, metadata } : { text };
}
