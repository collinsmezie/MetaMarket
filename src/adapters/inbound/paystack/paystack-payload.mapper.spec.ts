import { mapWebhookToNotification } from './paystack-payload.mapper';

const creditPayload = (overrides: Record<string, unknown> = {}) => ({
  event: 'dedicated_account.credit',
  data: {
    id: 302961,
    reference: 'trf_1a2b3c',
    amount: 500_000,
    currency: 'NGN',
    status: 'success',
    dedicated_account: {
      account_number: '8134567892',
      account_name: 'konnet - Collins',
      bank: { name: 'Paystack-Titan' },
    },
    ...overrides,
  },
});

describe('mapWebhookToNotification', () => {
  it('maps a credit event to the canonical notification', () => {
    const mapped = mapWebhookToNotification(creditPayload());

    expect(mapped.kind).toBe('credit');
    if (mapped.kind !== 'credit') return;

    expect(mapped.notification).toEqual({
      provider: 'paystack',
      eventType: 'dedicated_account.credit',
      eventId: '302961',
      providerReference: 'trf_1a2b3c',
      accountNumber: '8134567892',
      // Paystack reports kobo; storing it unchanged means nothing is converted twice.
      amountKobo: 500_000,
      currency: 'NGN',
    });
  });

  it('coerces a numeric event id to a string', () => {
    const mapped = mapWebhookToNotification(creditPayload());

    if (mapped.kind !== 'credit') throw new Error('expected credit');
    expect(typeof mapped.notification.eventId).toBe('string');
  });

  it('ignores account assignment events', () => {
    // The platform learns its account details from its own provisioning call; treating an
    // assignment webhook as authoritative would create a second, racing source of truth.
    const mapped = mapWebhookToNotification({ event: 'dedicated_account.assign.success', data: {} });

    expect(mapped.kind).toBe('ignored');
    if (mapped.kind !== 'ignored') return;
    expect(mapped.reason).toContain('provisioning');
  });

  it('ignores unrelated events', () => {
    expect(mapWebhookToNotification({ event: 'charge.success', data: {} }).kind).toBe('ignored');
  });

  it('rejects a credit payload missing the account number', () => {
    const mapped = mapWebhookToNotification({
      event: 'dedicated_account.credit',
      data: { id: 1, reference: 'r', amount: 1000, dedicated_account: {} },
    });

    expect(mapped.kind).toBe('ignored');
    if (mapped.kind !== 'ignored') return;
    expect(mapped.reason).toContain('Malformed');
  });

  it('rejects a non-positive amount rather than crediting zero', () => {
    expect(mapWebhookToNotification(creditPayload({ amount: 0 })).kind).toBe('ignored');
    expect(mapWebhookToNotification(creditPayload({ amount: -500 })).kind).toBe('ignored');
  });

  it('never throws on malformed input', () => {
    // The controller acknowledges every authenticated delivery, so mapping must be total.
    for (const body of [null, undefined, 42, 'text', {}, { event: 123 }, { data: {} }]) {
      expect(() => mapWebhookToNotification(body)).not.toThrow();
      expect(mapWebhookToNotification(body).kind).toBe('ignored');
    }
  });

  it('defaults the currency when Paystack omits it', () => {
    const payload = creditPayload();
    delete (payload.data as Record<string, unknown>).currency;

    const mapped = mapWebhookToNotification(payload);

    if (mapped.kind !== 'credit') throw new Error('expected credit');
    expect(mapped.notification.currency).toBe('NGN');
  });
});
