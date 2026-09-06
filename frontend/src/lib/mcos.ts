import { getApiBase } from './api';

/**
 * Client for the MCOS web channel.
 *
 * Deliberately thin. MCOS owns every conversational decision — whether this turn is a buyer
 * search or a vendor onboarding, what to ask next, which buttons to offer — exactly as it does
 * for WhatsApp. The browser's job is to carry text up and render what comes back down. Any
 * branching on intent in here would be a second, divergent copy of the conversation logic.
 */

/** Mirrors the canonical `Action` (MCOS §13). `payload` is opaque and echoed back verbatim. */
export interface McosAction {
  type: string;
  title: string;
  payload: string;
  description?: string;
}

export interface McosMedia {
  type: 'image' | 'audio' | 'video' | 'document';
  url: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
}

export interface McosVendor {
  vendorId: string;
  vendorName: string;
  location: string;
  phone?: string | null;
  matchedConcept?: string | null;
  description?: string | null;
  rating?: string | null;
  score?: number;
}

export interface McosResponse {
  text?: string;
  media?: McosMedia[];
  actions?: McosAction[];
  /**
   * Non-user-facing hints. `vendors` carries matched sellers as data so this client can render
   * cards; WhatsApp receives the same sellers in the message text.
   */
  metadata?: Record<string, unknown> & { vendors?: McosVendor[] };
}

export interface McosStreamMessage {
  kind: 'message';
  conversationId: string;
  response: McosResponse;
  workflowId?: string;
  at: string;
}

export interface McosStreamTyping {
  kind: 'typing';
  conversationId: string;
  at: string;
}

export interface McosHistoryEntry {
  role: string;
  content: string;
  at: string;
}

const SESSION_KEY = 'mcos_session_id_v1';

/**
 * Stable session id for this browser.
 *
 * Persisted because it keys the conversation: a fresh id on every reload would strand the
 * previous conversation and its open workflows.
 */
export function getSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';

  let id = localStorage.getItem(SESSION_KEY);

  if (!id) {
    id = `web_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(SESSION_KEY, id);
  }

  return id;
}

/**
 * Abandons this conversation and starts a fresh one.
 *
 * Only the local session id is dropped — the previous conversation and its workflows remain
 * in MCOS untouched, which is the honest behaviour: the user asked for a new chat, not for
 * their history to be destroyed.
 */
export function resetSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Identity for this browser.
 *
 * No phone number is collected here. A seller's number is captured by the onboarding
 * workflow, which is the one place that knows when it is actually needed and how to confirm
 * it — asking for it up front in the UI would be a second, competing identity flow.
 */
function identityQuery(): string {
  return new URLSearchParams({ sessionId: getSessionId() }).toString();
}

/** Sends a typed message or a tapped action. Returns once MCOS has accepted it. */
export async function sendMessage(input: {
  text?: string;
  actionPayload?: string;
  actionTitle?: string;
}): Promise<{ accepted: true; conversationId: string }> {
  const res = await fetch(`${getApiBase()}/channels/web/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: getSessionId(),
      ...input,
      // Makes a retry or double-submit idempotent: MCOS dedups on this, so the turn cannot
      // run twice and open two workflows.
      clientMessageId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    }),
  });

  if (!res.ok) {
    throw new Error(`MCOS rejected the message: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

/** The transcript MCOS holds, for rehydrating after a reload. */
export async function fetchHistory(): Promise<{
  conversationId: string;
  history: McosHistoryEntry[];
}> {
  const res = await fetch(`${getApiBase()}/channels/web/history?${identityQuery()}`);
  if (!res.ok) throw new Error(`Could not load history: ${res.status}`);
  return res.json();
}

/**
 * Opens the reply stream.
 *
 * Replies arrive here rather than in the POST response because a turn can outlast any sensible
 * request timeout, and because MCOS may send several messages for one turn — a progress
 * heartbeat followed by results, or a vendor's answer arriving minutes later.
 *
 * @returns a teardown function.
 */
export function openStream(handlers: {
  onMessage: (event: McosStreamMessage) => void;
  onTyping?: (event: McosStreamTyping) => void;
  onOpen?: () => void;
  onError?: () => void;
}): () => void {
  const source = new EventSource(`${getApiBase()}/channels/web/stream?${identityQuery()}`);

  source.addEventListener('open', () => handlers.onOpen?.());

  source.addEventListener('message', (event) => {
    try {
      handlers.onMessage(JSON.parse((event as MessageEvent<string>).data));
    } catch {
      // A frame we cannot parse is not worth tearing the stream down for.
    }
  });

  source.addEventListener('typing', (event) => {
    try {
      handlers.onTyping?.(JSON.parse((event as MessageEvent<string>).data));
    } catch {}
  });

  // `ping` frames exist only to keep proxies from closing an idle stream; nothing to do.
  source.addEventListener('ping', () => {});

  source.addEventListener('error', () => handlers.onError?.());

  return () => source.close();
}
