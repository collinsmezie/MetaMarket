import {
  isExhausted,
  MAX_OUTBOUND_ATTEMPTS,
  nextOutboundAttemptAt,
  OUTBOUND_BACKOFF_BASE_MS,
  OUTBOUND_BACKOFF_MAX_MS,
} from './outbound-message';

const NOW = new Date('2026-08-07T10:00:00Z');

/** No jitter, so the schedule itself is what is under test. */
const at = (attempts: number, jitter = 0.5) =>
  nextOutboundAttemptAt(attempts, NOW, jitter).getTime() - NOW.getTime();

describe('nextOutboundAttemptAt', () => {
  it('doubles the wait with each failed attempt', () => {
    expect(at(1)).toBe(OUTBOUND_BACKOFF_BASE_MS);
    expect(at(2)).toBe(OUTBOUND_BACKOFF_BASE_MS * 2);
    expect(at(3)).toBe(OUTBOUND_BACKOFF_BASE_MS * 4);
  });

  it('caps the wait so the tail of the schedule stays responsive', () => {
    expect(at(20)).toBe(OUTBOUND_BACKOFF_MAX_MS);
  });

  it('jitters between half and one and a half of the nominal delay', () => {
    // A channel outage fails every queued message at once; without jitter they would all come
    // back at the provider in the same instant when it recovers.
    expect(at(1, 0)).toBe(OUTBOUND_BACKOFF_BASE_MS * 0.5);
    expect(at(1, 1)).toBe(OUTBOUND_BACKOFF_BASE_MS * 1.5);
  });

  it('never schedules in the past, whatever it is handed', () => {
    for (const attempts of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(nextOutboundAttemptAt(attempts, NOW).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it('spans about ten minutes across the whole attempt budget', () => {
    // The claim in the doc comment, pinned: long enough to ride out a blip, short enough that a
    // conversational reply is still worth delivering when it lands.
    let total = 0;
    for (let attempt = 1; attempt < MAX_OUTBOUND_ATTEMPTS; attempt += 1) total += at(attempt);

    expect(total).toBeGreaterThan(8 * 60_000);
    expect(total).toBeLessThan(15 * 60_000);
  });
});

describe('isExhausted', () => {
  it('parks a message only once the budget is spent', () => {
    expect(isExhausted(MAX_OUTBOUND_ATTEMPTS - 1)).toBe(false);
    expect(isExhausted(MAX_OUTBOUND_ATTEMPTS)).toBe(true);
  });
});
