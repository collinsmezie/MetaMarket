import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Meta webhook signature verification.
 *
 * Without this, anyone who learns the webhook URL can inject messages that appear to come
 * from any phone number — impersonating a vendor or a buyer. The signature is computed over
 * the exact raw body, so the request body must be captured before JSON parsing.
 */

const SIGNATURE_PREFIX = 'sha256=';

export function verifyWhatsAppSignature(params: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  appSecret: string;
}): boolean {
  const { rawBody, signatureHeader, appSecret } = params;

  if (signatureHeader === undefined || !signatureHeader.startsWith(SIGNATURE_PREFIX)) return false;

  const provided = Buffer.from(signatureHeader.slice(SIGNATURE_PREFIX.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();

  // Length check first: timingSafeEqual throws on mismatched lengths, and a truncated
  // signature would otherwise surface as a 500 rather than a clean rejection.
  if (provided.length !== expected.length) return false;

  // Constant-time comparison so an attacker cannot recover the digest byte by byte.
  return timingSafeEqual(provided, expected);
}
