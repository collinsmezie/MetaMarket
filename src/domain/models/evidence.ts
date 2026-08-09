/**
 * Marketplace evidence model (Evidence Service TDR).
 *
 * Distinct from Capability DNA, and deliberately so. The CDE answers *what can this vendor
 * supply?*; the Evidence Service answers *how do they actually behave?* — do they reply, do
 * they have the stock when asked, do customers pick them, do deals complete. The Capability
 * Matching Engine combines the two, and keeping them separate lets semantic understanding and
 * marketplace learning "evolve independently while working together".
 */

/** What a piece of evidence is about. */
export const EVIDENCE_SUBJECT_TYPES = ['vendor', 'capability', 'product'] as const;

export type EvidenceSubjectType = (typeof EVIDENCE_SUBJECT_TYPES)[number];

/**
 * The behavioural dimensions tracked (Evidence Service, "Evidence Generated From Fan-Out").
 *
 * These are observations of what happened, not judgements. Interpretation happens in scoring.
 */
export const EVIDENCE_SIGNALS = [
  'delivered',
  'responded',
  'accepted',
  'rejected',
  'no_response',
  'selected',
  'completed',
  'cancelled',
  'rated',
] as const;

export type EvidenceSignal = (typeof EVIDENCE_SIGNALS)[number];

export interface EvidenceRecord {
  readonly id: string;
  readonly eventId: string;
  readonly vendorId: string;
  readonly subjectType: EvidenceSubjectType;
  /** Capability id or product term; empty for vendor-level behaviour. */
  readonly subject: string;
  readonly signal: EvidenceSignal;
  readonly polarity: 1 | -1;
  readonly weight: number;
  readonly responseTimeMs?: number;
  readonly rating?: number;
  readonly observedAt: Date;
}

/** Raw counters for one vendor/subject pair. */
export interface EvidenceCounters {
  readonly delivered: number;
  readonly responded: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly noResponse: number;
  readonly selected: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly responseTimeSumMs: number;
  readonly responseTimeCount: number;
  readonly ratingSum: number;
  readonly ratingCount: number;
}

export const EMPTY_COUNTERS: EvidenceCounters = {
  delivered: 0,
  responded: 0,
  accepted: 0,
  rejected: 0,
  noResponse: 0,
  selected: 0,
  completed: 0,
  cancelled: 0,
  responseTimeSumMs: 0,
  responseTimeCount: 0,
  ratingSum: 0,
  ratingCount: 0,
};

/**
 * The aggregated view the Capability Matching Engine consumes.
 *
 * `score` is the single number ranking uses; the component rates are exposed alongside it so a
 * ranking decision can be explained to a vendor or an operator rather than asserted.
 */
export interface EvidenceAggregate {
  readonly vendorId: string;
  readonly subjectType: EvidenceSubjectType;
  readonly subject: string;
  readonly counters: EvidenceCounters;
  readonly score: number;
  /** Belief in the score itself — low when there is barely any evidence. */
  readonly scoreConfidence: number;
  readonly firstObservedAt: Date;
  readonly lastObservedAt: Date;
}

export interface EvidenceRates {
  /** Replied at all when asked. */
  readonly responseRate: number;
  /** Had the item, given that they replied. */
  readonly acceptanceRate: number;
  /** Customer chose them, given that they offered. */
  readonly selectionRate: number;
  /** Deal completed, given that they were chosen. */
  readonly fulfilmentRate: number;
  /** Mean response time in milliseconds, or null when never measured. */
  readonly meanResponseMs: number | null;
  /** Mean customer rating in [1,5], or null when never rated. */
  readonly meanRating: number | null;
}

/**
 * Wilson lower bound of a binomial proportion at ~95% confidence.
 *
 * This is the heart of honest ranking with sparse data. A vendor who accepted 1 of 1 requests
 * has a raw rate of 100% and a vendor who accepted 45 of 50 has 90% — ranking on the raw rate
 * puts the newcomer first on the strength of a single event. Wilson asks instead "what rate can
 * we be confident this vendor is at least at?", which is 20.7% versus 78.9%. New vendors have to
 * earn their position rather than start at the top, and one unlucky rejection cannot destroy an
 * established vendor either.
 */
export function wilsonLowerBound(successes: number, trials: number, z = 1.96): number {
  if (trials <= 0) return 0;

  const phat = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = phat + z2 / (2 * trials);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * trials)) / trials);

  return Math.max(0, (centre - margin) / denominator);
}

/** Derives the observable rates from raw counters. */
export function deriveRates(counters: EvidenceCounters): EvidenceRates {
  const ratio = (numerator: number, denominator: number) => (denominator <= 0 ? 0 : numerator / denominator);

  return {
    responseRate: ratio(counters.responded, counters.delivered),
    acceptanceRate: ratio(counters.accepted, counters.responded),
    selectionRate: ratio(counters.selected, counters.accepted),
    fulfilmentRate: ratio(counters.completed, counters.selected),
    meanResponseMs:
      counters.responseTimeCount > 0 ? counters.responseTimeSumMs / counters.responseTimeCount : null,
    meanRating: counters.ratingCount > 0 ? counters.ratingSum / counters.ratingCount : null,
  };
}

/**
 * Relative weight of each dimension in the composite score.
 *
 * Ordered by how much each one actually tells a buyer. A completed transaction is the strongest
 * possible signal that this vendor can serve this request; merely replying is the weakest, since
 * replying is cheap. Speed and rating are tie-breakers, not drivers.
 */
const SCORE_WEIGHTS = {
  response: 0.15,
  acceptance: 0.25,
  selection: 0.2,
  fulfilment: 0.3,
  speed: 0.05,
  rating: 0.05,
} as const;

/**
 * Response time at which the speed component reaches zero.
 *
 * Half an hour matches the no-response timeout in the Evidence Service TDR: a reply that slow is
 * worth no more than no reply for a buyer standing in a market.
 */
const SPEED_HORIZON_MS = 30 * 60 * 1000;

/**
 * Evidence volume at which the score is trusted at face value.
 *
 * Below it the score is shrunk toward neutral, so a vendor with two interactions cannot outrank
 * one with fifty on the strength of a small lucky streak.
 */
const CONFIDENCE_SATURATION = 20;

/** Where a vendor with no evidence sits: not penalised, not credited. */
export const NEUTRAL_EVIDENCE_SCORE = 0.5;

/**
 * Computes the composite evidence score in [0,1].
 *
 * Every rate goes through the Wilson bound first, then the weighted blend is shrunk toward
 * neutral in proportion to how little evidence exists. A brand-new vendor therefore scores
 * exactly neutral rather than zero — the marketplace has no reason to think badly of them, and
 * scoring them at zero would make the cold-start problem permanent.
 */
export function computeEvidenceScore(counters: EvidenceCounters): {
  score: number;
  confidence: number;
} {
  const totalInteractions = counters.delivered + counters.selected + counters.completed;

  if (totalInteractions === 0) {
    return { score: NEUTRAL_EVIDENCE_SCORE, confidence: 0 };
  }

  const response = wilsonLowerBound(counters.responded, counters.delivered);
  const acceptance = wilsonLowerBound(counters.accepted, counters.responded);
  const selection = wilsonLowerBound(counters.selected, counters.accepted);
  const fulfilment = wilsonLowerBound(counters.completed, counters.selected);

  const rates = deriveRates(counters);

  const speed =
    rates.meanResponseMs === null
      ? 0
      : Math.max(0, 1 - Math.min(rates.meanResponseMs, SPEED_HORIZON_MS) / SPEED_HORIZON_MS);

  // Ratings are 1-5; map onto [0,1] so 3 is neutral.
  const rating = rates.meanRating === null ? 0 : (rates.meanRating - 1) / 4;

  // Dimensions with no observations contribute nothing and must not dilute the rest, so the
  // blend is normalised by the weight actually in play.
  const contributions: [number, number, boolean][] = [
    [response, SCORE_WEIGHTS.response, counters.delivered > 0],
    [acceptance, SCORE_WEIGHTS.acceptance, counters.responded > 0],
    [selection, SCORE_WEIGHTS.selection, counters.accepted > 0],
    [fulfilment, SCORE_WEIGHTS.fulfilment, counters.selected > 0],
    [speed, SCORE_WEIGHTS.speed, rates.meanResponseMs !== null],
    [rating, SCORE_WEIGHTS.rating, rates.meanRating !== null],
  ];

  let weighted = 0;
  let activeWeight = 0;

  for (const [value, weight, active] of contributions) {
    if (!active) continue;
    weighted += value * weight;
    activeWeight += weight;
  }

  const raw = activeWeight === 0 ? NEUTRAL_EVIDENCE_SCORE : weighted / activeWeight;

  const confidence = Math.min(1, totalInteractions / CONFIDENCE_SATURATION);
  const calculatedScore = NEUTRAL_EVIDENCE_SCORE + (raw - NEUTRAL_EVIDENCE_SCORE) * confidence;
  const score = Number.isFinite(calculatedScore) ? calculatedScore : NEUTRAL_EVIDENCE_SCORE;

  return { score: Math.min(1, Math.max(0, score)), confidence: Number.isFinite(confidence) ? confidence : 0 };
}

/** Applies one record's effect to a counter set. Pure, so aggregation is replayable. */
export function applyRecord(counters: EvidenceCounters, record: EvidenceRecord): EvidenceCounters {
  const next = { ...counters };

  switch (record.signal) {
    case 'delivered':
      next.delivered += 1;
      break;
    case 'responded':
      next.responded += 1;
      break;
    case 'accepted':
      next.accepted += 1;
      break;
    case 'rejected':
      next.rejected += 1;
      break;
    case 'no_response':
      next.noResponse += 1;
      break;
    case 'selected':
      next.selected += 1;
      break;
    case 'completed':
      next.completed += 1;
      break;
    case 'cancelled':
      next.cancelled += 1;
      break;
    case 'rated':
      break;
  }

  if (record.responseTimeMs !== undefined) {
    next.responseTimeSumMs += record.responseTimeMs;
    next.responseTimeCount += 1;
  }

  if (record.rating !== undefined) {
    next.ratingSum += record.rating;
    next.ratingCount += 1;
  }

  return next;
}

/**
 * Human-readable justifications for a score, for the CME's explainability requirement
 * (CME §14): "Every ranked vendor must expose explainable reasoning."
 */
export function explainEvidence(aggregate: EvidenceAggregate): readonly string[] {
  const rates = deriveRates(aggregate.counters);
  const reasons: string[] = [];
  const counters = aggregate.counters;

  if (counters.completed > 0) {
    reasons.push(
      `Completed ${counters.completed} ${counters.completed === 1 ? 'transaction' : 'transactions'}.`,
    );
  }

  if (counters.selected > 0) {
    reasons.push(`Chosen by customers ${counters.selected} time(s).`);
  }

  if (counters.accepted > 0) {
    reasons.push(`Confirmed availability ${counters.accepted} of ${counters.responded} time(s) asked.`);
  }

  if (counters.delivered >= 3) {
    reasons.push(`Replies to ${Math.round(rates.responseRate * 100)}% of requests.`);
  }

  if (rates.meanResponseMs !== null) {
    const minutes = Math.round(rates.meanResponseMs / 60_000);
    reasons.push(
      minutes <= 1 ? 'Usually replies within a minute.' : `Usually replies in about ${minutes} minutes.`,
    );
  }

  if (rates.meanRating !== null) {
    reasons.push(`Average customer rating ${rates.meanRating.toFixed(1)} of 5.`);
  }

  if (reasons.length === 0) {
    // Honest about a cold start rather than inventing a reason.
    reasons.push('No marketplace history yet.');
  }

  return reasons;
}
