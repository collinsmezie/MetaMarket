import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Paystack webhook signature verification (Konnet Credits Recharge TDR §10.1).
 *
 * Money moves on the strength of this check. Without it, anyone who learns the webhook URL can
 * credit any wallet by posting a forged `dedicated_account.credit`.
 *
 * Paystack signs with HMAC-SHA512 over the exact raw bytes, hex-encoded, keyed by the secret
 * key — so verification must happen before parsing: a re-serialised body can hide tampering
 * that JSON round-tripping normalises away.
 */
export function verifyPaystackSignature(params: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  secretKey: string;
}): boolean {
  const { rawBody, signatureHeader, secretKey } = params;

  if (signatureHeader === undefined || signatureHeader.length === 0) return false;

  // Non-hex input yields a shorter buffer than the digest, which the length check below
  // rejects — so garbage can never reach timingSafeEqual.
  const provided = Buffer.from(signatureHeader, 'hex');
  const expected = createHmac('sha512', secretKey).update(rawBody).digest();

  // Length first: timingSafeEqual throws on a mismatch, which would surface a truncated
  // signature as a 500 rather than a clean rejection.
  if (provided.length !== expected.length) return false;

  // Constant time, so an attacker cannot recover the digest byte by byte.
  return timingSafeEqual(provided, expected);
}
