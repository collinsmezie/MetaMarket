/**
 * The platform's identity for a human (MCOS §3.2).
 *
 * A conversation is one per *user*, spanning every channel they use, so identity has to be
 * derived the same way by every inbound adapter. This lives in the domain rather than in the
 * WhatsApp adapter because the moment a second channel resolves identity its own way, one
 * person's conversation silently splits in two.
 */

/**
 * Normalises a phone number to E.164 with a leading '+'.
 *
 * Meta omits the '+', Twilio includes it, and a web form will accept whatever the user typed;
 * treating those as different users would split one person's conversation.
 */
export function normalizePhoneNumber(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  return `+${digits}`;
}

/** Prefix marking an identity that is a browser session rather than a person we can reach. */
export const WEB_SESSION_PREFIX = 'web:';

/**
 * Identity for a web visitor who has not given a phone number.
 *
 * Deliberately *not* interchangeable with a phone identity. An anonymous session gets no
 * cross-channel continuity — it cannot, because there is nothing to correlate — and no
 * outbound reach beyond the open connection. Naming it explicitly keeps that limitation
 * visible instead of letting an opaque uuid look like a real user.
 */
export function webSessionIdentity(sessionId: string): string {
  return `${WEB_SESSION_PREFIX}${sessionId}`;
}

export function isWebSessionIdentity(userId: string): boolean {
  return userId.startsWith(WEB_SESSION_PREFIX);
}

/**
 * Resolves the identity for a web request.
 *
 * Prefers the phone number when the client supplies one, because that is what makes a user
 * who starts on the web and continues on WhatsApp the same conversation.
 */
export function resolveWebIdentity(params: {
  readonly phone?: string | undefined;
  readonly sessionId: string;
}): string {
  const phone = params.phone?.trim();
  return phone !== undefined && phone.length > 0
    ? normalizePhoneNumber(phone)
    : webSessionIdentity(params.sessionId);
}
