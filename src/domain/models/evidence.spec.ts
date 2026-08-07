import type { EvidenceCounters, EvidenceRecord } from './evidence';
import {
  applyRecord,
  computeEvidenceScore,
  deriveRates,
  EMPTY_COUNTERS,
  explainEvidence,
  NEUTRAL_EVIDENCE_SCORE,
  wilsonLowerBound,
} from './evidence';

const counters = (overrides: Partial<EvidenceCounters>): EvidenceCounters => ({
  ...EMPTY_COUNTERS,
  ...overrides,
});

describe('wilsonLowerBound', () => {
  it('is zero with no trials', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });

  it('discounts a perfect record built on a single observation', () => {
    // The whole point: 1/1 is not evidence of a 100% vendor.
    expect(wilsonLowerBound(1, 1)).toBeLessThan(0.3);
  });

  it('rewards the same rate more as evidence accumulates', () => {
    expect(wilsonLowerBound(9, 10)).toBeGreaterThan(wilsonLowerBound(1, 1));
    expect(wilsonLowerBound(90, 100)).toBeGreaterThan(wilsonLowerBound(9, 10));
  });

  it('ranks a proven vendor above an untested one', () => {
    // 45/50 must beat 1/1 — ranking on the raw rate gets this backwards.
    expect(wilsonLowerBound(45, 50)).toBeGreaterThan(wilsonLowerBound(1, 1));
  });

  it('never exceeds the observed rate', () => {
    expect(wilsonLowerBound(9, 10)).toBeLessThan(0.9);
  });

  it('is zero for a vendor who has never succeeded', () => {
    expect(wilsonLowerBound(0, 10)).toBe(0);
  });
});

describe('deriveRates', () => {
  it('computes each rate against its own denominator', () => {
    const rates = deriveRates(
      counters({ delivered: 10, responded: 8, accepted: 6, selected: 3, completed: 2 }),
    );

    expect(rates.responseRate).toBeCloseTo(0.8);
    // Acceptance is out of replies, not deliveries: a vendor is not penalised twice for silence.
    expect(rates.acceptanceRate).toBeCloseTo(0.75);
    expect(rates.selectionRate).toBeCloseTo(0.5);
    expect(rates.fulfilmentRate).toBeCloseTo(2 / 3);
  });

  it('returns zero rather than NaN when a denominator is empty', () => {
    const rates = deriveRates(EMPTY_COUNTERS);

    for (const value of [
      rates.responseRate,
      rates.acceptanceRate,
      rates.selectionRate,
      rates.fulfilmentRate,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBe(0);
    }
    expect(rates.meanResponseMs).toBeNull();
    expect(rates.meanRating).toBeNull();
  });

  it('averages response time and rating from running totals', () => {
    const rates = deriveRates(
      counters({ responseTimeSumMs: 600_000, responseTimeCount: 4, ratingSum: 18, ratingCount: 4 }),
    );

    expect(rates.meanResponseMs).toBe(150_000);
    expect(rates.meanRating).toBe(4.5);
  });
});

describe('computeEvidenceScore', () => {
  it('places a vendor with no history at neutral, not zero', () => {
    // Scoring cold-start vendors at zero would make the cold start permanent.
    const { score, confidence } = computeEvidenceScore(EMPTY_COUNTERS);

    expect(score).toBe(NEUTRAL_EVIDENCE_SCORE);
    expect(confidence).toBe(0);
  });

  it('ranks a proven vendor above one with a single lucky interaction', () => {
    const proven = computeEvidenceScore(
      counters({ delivered: 50, responded: 48, accepted: 45, selected: 20, completed: 15 }),
    );
    const lucky = computeEvidenceScore(
      counters({ delivered: 1, responded: 1, accepted: 1, selected: 1, completed: 1 }),
    );

    expect(proven.score).toBeGreaterThan(lucky.score);
    expect(proven.confidence).toBeGreaterThan(lucky.confidence);
  });

  it('keeps a thin record close to neutral in either direction', () => {
    const good = computeEvidenceScore(counters({ delivered: 2, responded: 2, accepted: 2 }));
    const bad = computeEvidenceScore(counters({ delivered: 2, responded: 0, noResponse: 2 }));

    expect(Math.abs(good.score - NEUTRAL_EVIDENCE_SCORE)).toBeLessThan(0.2);
    expect(Math.abs(bad.score - NEUTRAL_EVIDENCE_SCORE)).toBeLessThan(0.2);
  });

  it('penalises a vendor who never replies', () => {
    const silent = computeEvidenceScore(counters({ delivered: 30, responded: 0, noResponse: 30 }));

    expect(silent.score).toBeLessThan(NEUTRAL_EVIDENCE_SCORE);
  });

  it('weights completed transactions above mere replies', () => {
    const replies = computeEvidenceScore(counters({ delivered: 30, responded: 30 }));
    const completes = computeEvidenceScore(
      counters({ delivered: 30, responded: 30, accepted: 28, selected: 20, completed: 18 }),
    );

    expect(completes.score).toBeGreaterThan(replies.score);
  });

  it('does not let an unobserved dimension drag the score down', () => {
    // A vendor asked 30 times who always replies and always has stock has simply never been
    // *selected* yet; that absence must not read as a failure to be selected.
    const { score } = computeEvidenceScore(counters({ delivered: 30, responded: 30, accepted: 30 }));

    expect(score).toBeGreaterThan(NEUTRAL_EVIDENCE_SCORE);
  });

  it('prefers a fast responder over a slow one, all else equal', () => {
    const base = { delivered: 30, responded: 30, accepted: 25, responseTimeCount: 30 };

    const fast = computeEvidenceScore(counters({ ...base, responseTimeSumMs: 30 * 60_000 }));
    const slow = computeEvidenceScore(counters({ ...base, responseTimeSumMs: 30 * 25 * 60_000 }));

    expect(fast.score).toBeGreaterThan(slow.score);
  });

  it('saturates confidence once enough evidence exists', () => {
    expect(computeEvidenceScore(counters({ delivered: 100, responded: 90 })).confidence).toBe(1);
  });

  it('always stays within [0,1]', () => {
    const extremes = [
      counters({
        delivered: 100,
        responded: 100,
        accepted: 100,
        selected: 100,
        completed: 100,
        ratingSum: 500,
        ratingCount: 100,
      }),
      counters({ delivered: 100, responded: 0, noResponse: 100 }),
    ];

    for (const c of extremes) {
      const { score } = computeEvidenceScore(c);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe('applyRecord', () => {
  const record = (overrides: Partial<EvidenceRecord>): EvidenceRecord => ({
    id: 'ev_1',
    eventId: 'evt_1',
    vendorId: 'vendor_1',
    subjectType: 'capability',
    subject: '10003500',
    signal: 'accepted',
    polarity: 1,
    weight: 1,
    observedAt: new Date('2026-08-06T10:00:00Z'),
    ...overrides,
  });

  it('increments the counter matching the signal', () => {
    expect(applyRecord(EMPTY_COUNTERS, record({ signal: 'accepted' })).accepted).toBe(1);
    expect(applyRecord(EMPTY_COUNTERS, record({ signal: 'no_response' })).noResponse).toBe(1);
    expect(applyRecord(EMPTY_COUNTERS, record({ signal: 'completed' })).completed).toBe(1);
  });

  it('accumulates response times into the running total', () => {
    const next = applyRecord(EMPTY_COUNTERS, record({ signal: 'responded', responseTimeMs: 180_000 }));

    expect(next.responseTimeSumMs).toBe(180_000);
    expect(next.responseTimeCount).toBe(1);
  });

  it('accumulates ratings', () => {
    const next = applyRecord(EMPTY_COUNTERS, record({ signal: 'rated', rating: 5 }));

    expect(next.ratingSum).toBe(5);
    expect(next.ratingCount).toBe(1);
  });

  it('does not mutate the input, so aggregation stays replayable', () => {
    const before = counters({ accepted: 3 });
    applyRecord(before, record({ signal: 'accepted' }));

    expect(before.accepted).toBe(3);
  });
});

describe('explainEvidence', () => {
  const aggregate = (c: Partial<EvidenceCounters>) => ({
    vendorId: 'vendor_1',
    subjectType: 'capability' as const,
    subject: '10003500',
    counters: counters(c),
    score: 0.8,
    scoreConfidence: 0.9,
    firstObservedAt: new Date(),
    lastObservedAt: new Date(),
  });

  it('states marketplace history in plain language', () => {
    const reasons = explainEvidence(
      aggregate({ delivered: 10, responded: 9, accepted: 8, selected: 4, completed: 3 }),
    );

    expect(reasons.join(' ')).toContain('Completed 3');
    expect(reasons.join(' ')).toContain('Chosen by customers 4');
  });

  it('admits when there is no history rather than inventing a reason', () => {
    expect(explainEvidence(aggregate({}))).toEqual(['No marketplace history yet.']);
  });

  it('reports typical response time in human units', () => {
    const reasons = explainEvidence(
      aggregate({ delivered: 5, responded: 5, responseTimeSumMs: 5 * 180_000, responseTimeCount: 5 }),
    );

    expect(reasons.join(' ')).toContain('3 minutes');
  });
});
