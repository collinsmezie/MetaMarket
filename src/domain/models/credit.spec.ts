import { koboToNairaLabel, nairaToKobo, syntheticCustomerEmail, toCredits } from './credit';

/**
 * Money math. The rules are unforgiving on purpose: this runs on the payment webhook path,
 * where a thrown exception becomes a Paystack retry storm and a rounding error becomes either
 * a user losing money or a user minting it.
 */
describe('toCredits', () => {
  const RATE = 10_000; // ₦100 per credit

  it('converts a clean multiple exactly', () => {
    expect(toCredits(500_000, RATE)).toEqual({ credits: 50, remnantKobo: 0 });
  });

  it('floors a partial credit and keeps the remnant', () => {
    // ₦5,050 at ₦100/credit is 50 credits with ₦50 left over — never 50.5 credits.
    expect(toCredits(505_000, RATE)).toEqual({ credits: 50, remnantKobo: 5_000 });
  });

  it('yields zero credits below the minimum, preserving the whole amount as remnant', () => {
    // The caller reports this as `below_minimum` rather than crediting nothing silently.
    expect(toCredits(5_000, RATE)).toEqual({ credits: 0, remnantKobo: 5_000 });
  });

  it('never throws on invalid input', () => {
    // A throw here would turn a received payment into a retry storm.
    for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => toCredits(amount, RATE)).not.toThrow();
      expect(toCredits(amount, RATE).credits).toBe(0);
    }
  });

  it('never throws on an invalid rate', () => {
    for (const rate of [0, -100, Number.NaN]) {
      expect(toCredits(500_000, rate)).toEqual({ credits: 0, remnantKobo: 0 });
    }
  });

  it('truncates fractional kobo rather than rounding up', () => {
    expect(toCredits(500_000.9, RATE).credits).toBe(50);
  });

  it('conserves value: credits × rate + remnant equals the amount', () => {
    for (const amount of [1, 9_999, 10_000, 123_456, 999_999]) {
      const { credits, remnantKobo } = toCredits(amount, RATE);
      expect(credits * RATE + remnantKobo).toBe(amount);
    }
  });
});

describe('nairaToKobo', () => {
  it('converts whole Naira', () => {
    expect(nairaToKobo(100)).toBe(10_000);
  });

  it('rounds rather than truncating fractional Naira', () => {
    expect(nairaToKobo(10.005)).toBe(1_001);
  });
});

describe('koboToNairaLabel', () => {
  it('formats with a thousands separator for user-facing copy', () => {
    expect(koboToNairaLabel(500_000)).toBe('₦5,000');
  });

  it('keeps kobo precision when present', () => {
    expect(koboToNairaLabel(505_050)).toContain('5,050.5');
  });
});

describe('syntheticCustomerEmail', () => {
  it('is deterministic for a user, so customer creation is idempotent', () => {
    expect(syntheticCustomerEmail('+2348012345678')).toBe('2348012345678@konnet.ng');
    expect(syntheticCustomerEmail('+2348012345678')).toBe(syntheticCustomerEmail('+2348012345678'));
  });

  it('ignores formatting differences in the same number', () => {
    expect(syntheticCustomerEmail('+234 801 234 5678')).toBe(syntheticCustomerEmail('+2348012345678'));
  });

  it('still produces a valid address when there are no digits', () => {
    expect(syntheticCustomerEmail('')).toBe('unknown@konnet.ng');
  });
});
