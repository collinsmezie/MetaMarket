import { createHmac } from 'node:crypto';
import { verifyWhatsAppSignature } from './whatsapp-signature';

const APP_SECRET = 'test-app-secret';

const sign = (body: Buffer, secret = APP_SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('verifyWhatsAppSignature', () => {
  const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));

  it('accepts a correctly signed payload', () => {
    expect(
      verifyWhatsAppSignature({
        rawBody,
        signatureHeader: sign(rawBody),
        appSecret: APP_SECRET,
      }),
    ).toBe(true);
  });

  it('rejects a payload signed with a different secret', () => {
    expect(
      verifyWhatsAppSignature({
        rawBody,
        signatureHeader: sign(rawBody, 'attacker-secret'),
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });

  it('rejects a signature computed over different bytes', () => {
    // Tampering with the body after signing must invalidate the request.
    const tampered = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [1] }));

    expect(
      verifyWhatsAppSignature({
        rawBody: tampered,
        signatureHeader: sign(rawBody),
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyWhatsAppSignature({ rawBody, signatureHeader: undefined, appSecret: APP_SECRET })).toBe(
      false,
    );
  });

  it('rejects a header without the sha256 prefix', () => {
    const bare = createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');

    expect(verifyWhatsAppSignature({ rawBody, signatureHeader: bare, appSecret: APP_SECRET })).toBe(false);
  });

  it('rejects a truncated signature without throwing', () => {
    // timingSafeEqual throws on length mismatch; this must be a clean false instead.
    const truncated = `${sign(rawBody).slice(0, 20)}`;

    expect(() =>
      verifyWhatsAppSignature({ rawBody, signatureHeader: truncated, appSecret: APP_SECRET }),
    ).not.toThrow();
    expect(verifyWhatsAppSignature({ rawBody, signatureHeader: truncated, appSecret: APP_SECRET })).toBe(
      false,
    );
  });

  it('rejects non-hex garbage in the signature', () => {
    expect(
      verifyWhatsAppSignature({
        rawBody,
        signatureHeader: 'sha256=not-hex-at-all',
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });
});
