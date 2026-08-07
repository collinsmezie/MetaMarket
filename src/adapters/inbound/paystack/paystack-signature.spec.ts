import { createHmac } from 'node:crypto';
import { verifyPaystackSignature } from './paystack-signature';

const SECRET = 'sk_test_secret';

const sign = (body: Buffer, secret = SECRET) => createHmac('sha512', secret).update(body).digest('hex');

/**
 * Money moves on the strength of this check: without it, anyone who learns the webhook URL can
 * credit any wallet with a forged payload.
 */
describe('verifyPaystackSignature', () => {
  const rawBody = Buffer.from(JSON.stringify({ event: 'dedicated_account.credit', data: {} }));

  it('accepts a correctly signed payload', () => {
    expect(verifyPaystackSignature({ rawBody, signatureHeader: sign(rawBody), secretKey: SECRET })).toBe(
      true,
    );
  });

  it('rejects a payload signed with a different secret', () => {
    expect(
      verifyPaystackSignature({
        rawBody,
        signatureHeader: sign(rawBody, 'sk_test_attacker'),
        secretKey: SECRET,
      }),
    ).toBe(false);
  });

  it('rejects a body tampered with after signing', () => {
    const tampered = Buffer.from(
      JSON.stringify({ event: 'dedicated_account.credit', data: { amount: 999 } }),
    );

    expect(
      verifyPaystackSignature({ rawBody: tampered, signatureHeader: sign(rawBody), secretKey: SECRET }),
    ).toBe(false);
  });

  it('rejects a missing or empty header', () => {
    expect(verifyPaystackSignature({ rawBody, signatureHeader: undefined, secretKey: SECRET })).toBe(false);
    expect(verifyPaystackSignature({ rawBody, signatureHeader: '', secretKey: SECRET })).toBe(false);
  });

  it('rejects a truncated signature without throwing', () => {
    // timingSafeEqual throws on a length mismatch; this must be a clean false, not a 500.
    const truncated = sign(rawBody).slice(0, 40);

    expect(() =>
      verifyPaystackSignature({ rawBody, signatureHeader: truncated, secretKey: SECRET }),
    ).not.toThrow();
    expect(verifyPaystackSignature({ rawBody, signatureHeader: truncated, secretKey: SECRET })).toBe(false);
  });

  it('rejects non-hex garbage', () => {
    expect(verifyPaystackSignature({ rawBody, signatureHeader: 'not-hex-at-all', secretKey: SECRET })).toBe(
      false,
    );
  });

  it('uses SHA-512, not SHA-256', () => {
    // Paystack differs from Meta here; signing with the wrong algorithm must not pass.
    const sha256 = createHmac('sha256', SECRET).update(rawBody).digest('hex');

    expect(verifyPaystackSignature({ rawBody, signatureHeader: sha256, secretKey: SECRET })).toBe(false);
  });

  it('is sensitive to byte-level differences that JSON round-tripping would hide', () => {
    // Whitespace changes the bytes but not the parsed object — exactly why the raw body is
    // verified rather than a re-serialised one.
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString()), null, 2));

    expect(
      verifyPaystackSignature({ rawBody: reserialised, signatureHeader: sign(rawBody), secretKey: SECRET }),
    ).toBe(false);
  });
});
