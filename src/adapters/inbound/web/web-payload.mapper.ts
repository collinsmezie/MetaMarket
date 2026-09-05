import { randomUUID } from 'node:crypto';
import type { IncomingMessage, MessagePart } from '../../../domain/models/incoming-message';
import { PROVIDER_MESSAGE_ID_KEY } from '../../../domain/models/incoming-message';
import { resolveWebIdentity } from '../../../domain/models/user-identity';

/**
 * Translates web client requests into canonical messages (ADR-001 inbound adapter).
 *
 * Pure functions, no business logic and no AI calls, per Execution.md §2.1 — the mirror of
 * `whatsapp-payload.mapper`, and the only place that understands the web client's shape.
 */

export interface WebMessageBody {
  /** Stable per browser session. Also the idempotency scope for `clientMessageId`. */
  readonly sessionId?: string;
  /**
   * Optional phone number. Supplying it is what makes a user who starts in the browser and
   * continues on WhatsApp one conversation rather than two.
   */
  readonly phone?: string;
  readonly text?: string;
  /**
   * Payload from a tapped action, echoed back verbatim. Carries the originating workflow id,
   * which is the deterministic route home (MCOS §15 Layer 1) — so it must never be
   * synthesised by the client.
   */
  readonly actionPayload?: string;
  readonly actionTitle?: string;
  /**
   * Client-generated id, unique per composed message and stable across retries. Without it a
   * double-submit or a network retry runs the turn twice, which can duplicate a workflow or
   * double-charge a vendor.
   */
  readonly clientMessageId?: string;
}

export type WebMappingResult =
  { readonly ok: true; readonly message: IncomingMessage } | { readonly ok: false; readonly reason: string };

/**
 * Maps a request body, or explains why it cannot be mapped.
 *
 * Returns a reason rather than throwing so the controller can answer 400 with something the
 * client can act on. Media is deliberately unsupported: `MediaPart` carries a provider media
 * handle that a channel-specific downloader resolves, and no web downloader is registered —
 * accepting an upload here would queue media processing that could never complete.
 */
export function mapWebMessage(body: WebMessageBody, receivedAt: Date): WebMappingResult {
  const sessionId = body.sessionId?.trim();
  if (sessionId === undefined || sessionId.length === 0) {
    return { ok: false, reason: 'sessionId is required.' };
  }

  const parts = mapParts(body);
  if (parts.length === 0) {
    return { ok: false, reason: 'Provide either text or actionPayload.' };
  }

  const userId = resolveWebIdentity({ phone: body.phone, sessionId });

  return {
    ok: true,
    message: {
      id: randomUUID(),
      // Resolved to the platform conversation by the context manager, keyed on userId.
      conversationId: '',
      userId,
      channel: 'web',
      timestamp: receivedAt,
      parts,
      metadata: {
        // Scoped by session so two visitors cannot collide on the same client-side counter,
        // and so dedup still works when the client omits the id entirely.
        [PROVIDER_MESSAGE_ID_KEY]:
          body.clientMessageId !== undefined ? `web:${sessionId}:${body.clientMessageId}` : null,
        provider: 'web',
        sessionId,
      },
    },
  };
}

function mapParts(body: WebMessageBody): readonly MessagePart[] {
  const parts: MessagePart[] = [];

  const payload = body.actionPayload?.trim();
  if (payload !== undefined && payload.length > 0) {
    parts.push({
      type: 'button_reply',
      payload,
      title: body.actionTitle?.trim() ?? '',
    });
  }

  const text = body.text?.trim();
  if (text !== undefined && text.length > 0) {
    parts.push({ type: 'text', text });
  }

  return parts;
}
