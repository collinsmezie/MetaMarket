import {
  type Assertion,
  type BeliefDirection,
  EVIDENCE_POLICY_VERSION,
  type GraphOperation,
  type KnowledgeState,
  knowledgeTypeFor,
  type NormalizedEvidence,
  type Polarity,
  type RelevanceDecision,
  round3,
} from './evidence-model';

/**
 * Deterministic, versioned evidence policy (`evidence-policy-1.0`): fusion (§5, §7, §8, §14,
 * §16, §33), knowledge promotion (§54.2) and graph relevance (§25, §34, §53.2).
 *
 * The TDR leaves the exact update function configurable and requires that every structured
 * output be schema-bound (§50.8). Belief formation is therefore computed here, from the immutable
 * evidence history, and emitted in the §51.2/§51.3/§51.4 shapes — auditable, replayable and free
 * of model variance. Model interpretation is used only where an observation is free text.
 */

const DAY_MS = 86_400_000;

/** §14 source reliability: how much a source type is trusted before recency/independence. */
const SOURCE_RELIABILITY: Readonly<Record<string, number>> = {
  FULFILLMENT_COMPLETED: 0.95,
  VENDOR_CONFIRMATION: 0.9,
  VENDOR_INVENTORY_UPDATE: 0.85,
  VENDOR_RESPONSE: 0.8,
  VENDOR_REJECTION: 0.8,
  VENDOR_CLARIFICATION: 0.8,
  VENDOR_STATEMENT: 0.7,
  BUYER_CONFIRMATION: 0.7,
  BUYER_CLARIFICATION: 0.6,
  BUYER_REQUEST: 0.5,
  GPC_MAPPING: 0.7,
  WRS_EXTERNAL_EVIDENCE: 0.6,
  CSRE_SEMANTIC_RESOLUTION: 0.55,
  ENRICHMENT_INSIGHT: 0.35,
  OTHER: 0.4,
};

/** §16 evidence-type-specific decay half-lives (days). Semantic knowledge barely decays; stock does. */
const HALF_LIFE_DAYS: Readonly<Record<string, number>> = {
  VENDOR_CAPABILITY: 120,
  MARKET_DEMAND: 60,
  VENDOR_COVERAGE: 365,
  LOCAL_TERM_MAPPING: 730,
  TAXONOMY_ANCHOR: 1095,
  COMMERCIAL_RELATIONSHIP: 365,
};

const GAIN: Readonly<Record<Polarity, number>> = {
  POSITIVE: 0.85,
  NEGATIVE: 0.45,
  NEUTRAL: 0.15,
  CONTRADICTORY: 0.3,
};
/** §5: a single source cannot establish near-certainty. */
const SINGLE_SOURCE_CAP = 0.9;
const STABLE_DELTA = 0.005;
const MATERIAL_DELTA = 0.02;

export interface FusionInput {
  readonly assertionId: string;
  readonly assertion: Assertion;
  readonly evidence: readonly NormalizedEvidence[];
  /** Graph-derived prior when MKG supplied one; a hypothesis, never evidence (§6, §26A). */
  readonly prior: number | null;
  readonly previousBelief: number | null;
  readonly now: Date;
}

export interface FusionResult {
  readonly relationshipId: string;
  readonly currentScore: number;
  readonly direction: BeliefDirection;
  readonly evidenceSummary: string;
  readonly supportingEvidenceIds: readonly string[];
  readonly contradictoryEvidenceIds: readonly string[];
  readonly requiresMoreEvidence: boolean;
  readonly observationCount: number;
  readonly independentSourceCount: number;
  readonly counts: Readonly<Record<Polarity, number>>;
  readonly lastObservedAt: Date | null;
  readonly staleness: number;
  readonly journey: readonly { evidenceId: string; score: number; reason: string }[];
}

export function reliabilityOf(sourceType: string): number {
  return SOURCE_RELIABILITY[sourceType] ?? SOURCE_RELIABILITY.OTHER!;
}

export function halfLifeDaysFor(assertion: Assertion): number {
  return HALF_LIFE_DAYS[knowledgeTypeFor(assertion) ?? 'COMMERCIAL_RELATIONSHIP'] ?? 365;
}

function recencyFactor(observedAt: Date, now: Date, halfLifeDays: number, floor: number): number {
  const ageDays = Math.max(0, now.getTime() - observedAt.getTime()) / DAY_MS;
  return Math.max(floor, Math.pow(0.5, ageDays / halfLifeDays));
}

/**
 * Fusion (§7): sequential, clamped update over *independent* evidence groups in observation
 * order, then staleness decay toward the prior. Duplicates (same independence key) contribute
 * once, at their strongest (§8, §39). Output is the §51.2 shape.
 */
export function fuse(input: FusionInput): FusionResult {
  const halfLife = halfLifeDaysFor(input.assertion);
  const ordered = [...input.evidence].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const groups = new Map<string, NormalizedEvidence>();
  for (const item of ordered) {
    const existing = groups.get(item.independenceKey);
    if (
      existing === undefined ||
      effectiveWeight(item, input.now, halfLife) > effectiveWeight(existing, input.now, halfLife)
    )
      groups.set(item.independenceKey, item);
  }
  const independent = [...groups.values()].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

  const prior = input.prior ?? 0;
  let score = prior;
  const journey: { evidenceId: string; score: number; reason: string }[] = [];
  const counts: Record<Polarity, number> = { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0, CONTRADICTORY: 0 };
  const supporting: string[] = [];
  const contradictory: string[] = [];

  for (const item of ordered) counts[item.polarity] += 1;

  // §7/§23/§26: a single observation never dominates — its gain is attenuated by the number of
  // independent opposing sources already seen, so one "out of stock" nudges a well-supported
  // belief instead of collapsing it, and repeated supplies recover a belief after a rejection.
  let positivesSeen = 0;
  let negativesSeen = 0;
  for (const item of independent) {
    const opposing =
      item.polarity === 'POSITIVE' || item.polarity === 'NEUTRAL' ? negativesSeen : positivesSeen;
    const w = (effectiveWeight(item, input.now, halfLife) * GAIN[item.polarity]) / (1 + 0.5 * opposing);
    switch (item.polarity) {
      case 'POSITIVE':
        score += (1 - score) * w;
        supporting.push(item.evidenceId);
        break;
      case 'NEUTRAL':
        score += (1 - score) * w;
        supporting.push(item.evidenceId);
        break;
      case 'NEGATIVE':
        score -= score * w;
        contradictory.push(item.evidenceId);
        break;
      case 'CONTRADICTORY':
        score -= score * w;
        contradictory.push(item.evidenceId);
        break;
    }
    if (item.polarity === 'POSITIVE' || item.polarity === 'NEUTRAL') positivesSeen += 1;
    else negativesSeen += 1;
    score = round3(score);
    journey.push({
      evidenceId: item.evidenceId,
      score,
      reason: `${item.polarity.toLowerCase()}_${item.provenance.sourceType.toLowerCase()}`,
    });
  }

  const independentSourceCount = independent.length;
  if (independentSourceCount <= 1) score = Math.min(score, SINGLE_SOURCE_CAP);

  // §16/§23 staleness: an assertion nobody has observed for a long time drifts back toward its prior.
  const lastObservedAt = ordered.length === 0 ? null : ordered[ordered.length - 1]!.observedAt;
  const staleness = lastObservedAt === null ? 1 : recencyFactor(lastObservedAt, input.now, halfLife, 0.05);
  score = round3(prior + (score - prior) * staleness);

  const previous = input.previousBelief;
  const delta = previous === null ? score : score - previous;
  const contradicted = counts.NEGATIVE + counts.CONTRADICTORY > 0 && counts.POSITIVE > 0;
  const direction: BeliefDirection =
    contradicted && independentSourceCount < 3
      ? 'UNCERTAIN'
      : Math.abs(delta) < STABLE_DELTA
        ? 'STABLE'
        : delta > 0
          ? 'INCREASING'
          : 'DECREASING';
  const requiresMoreEvidence = independentSourceCount < 2 || (score >= 0.4 && score <= 0.6) || contradicted;

  return {
    relationshipId: input.assertionId,
    currentScore: score,
    direction,
    evidenceSummary: summarizeEvidence(
      input.assertion,
      ordered.length,
      independentSourceCount,
      counts,
      score,
      prior,
    ),
    supportingEvidenceIds: supporting,
    contradictoryEvidenceIds: contradictory,
    requiresMoreEvidence,
    observationCount: new Set(ordered.map((item) => item.observationId)).size,
    independentSourceCount,
    counts,
    lastObservedAt,
    staleness: round3(staleness),
    journey,
  };
}

function effectiveWeight(item: NormalizedEvidence, now: Date, halfLifeDays: number): number {
  const kindFactor = item.kind === 'DIRECT' ? 1 : item.kind === 'CONTEXTUAL' ? 0.6 : 0.5;
  return (
    Math.min(1, Math.max(0, item.strength)) *
    reliabilityOf(item.provenance.sourceType) *
    kindFactor *
    recencyFactor(item.observedAt, now, halfLifeDays, 0.2)
  );
}

function summarizeEvidence(
  assertion: Assertion,
  total: number,
  independent: number,
  counts: Record<Polarity, number>,
  score: number,
  prior: number,
): string {
  return `${assertion.subject} ${assertion.predicate} ${assertion.object}: ${total} evidence item(s) from ${independent} independent source(s) (+${counts.POSITIVE} −${counts.NEGATIVE} ~${counts.NEUTRAL} ±${counts.CONTRADICTORY}); prior ${prior.toFixed(3)} → belief ${score.toFixed(3)}`;
}

// ── Knowledge promotion (§54.2, claim-sensitive) ─────────────────────────────────────────────

interface PromotionThresholds {
  readonly supported: { belief: number; sources: number };
  readonly established: { belief: number; sources: number };
}

const PROMOTION: Readonly<Record<string, PromotionThresholds>> = {
  LOCAL_TERM_MAPPING: { supported: { belief: 0.6, sources: 2 }, established: { belief: 0.8, sources: 3 } },
  TAXONOMY_ANCHOR: { supported: { belief: 0.7, sources: 1 }, established: { belief: 0.85, sources: 2 } },
  VENDOR_CAPABILITY: { supported: { belief: 0.6, sources: 1 }, established: { belief: 0.8, sources: 2 } },
  MARKET_DEMAND: { supported: { belief: 0.5, sources: 2 }, established: { belief: 0.7, sources: 4 } },
  VENDOR_COVERAGE: { supported: { belief: 0.6, sources: 1 }, established: { belief: 0.8, sources: 2 } },
  COMMERCIAL_RELATIONSHIP: {
    supported: { belief: 0.6, sources: 2 },
    established: { belief: 0.8, sources: 3 },
  },
};

export function promote(
  assertion: Assertion,
  fusion: FusionResult,
  previousState: KnowledgeState | null,
): KnowledgeState {
  const thresholds =
    PROMOTION[knowledgeTypeFor(assertion) ?? 'COMMERCIAL_RELATIONSHIP'] ?? PROMOTION.COMMERCIAL_RELATIONSHIP!;
  const { currentScore: belief, independentSourceCount: sources } = fusion;
  if (belief >= thresholds.established.belief && sources >= thresholds.established.sources)
    return 'ESTABLISHED';
  if (belief >= thresholds.supported.belief && sources >= thresholds.supported.sources) return 'SUPPORTED';
  const wasPromoted =
    previousState === 'SUPPORTED' || previousState === 'ESTABLISHED' || previousState === 'WEAKENING';
  if (wasPromoted) return belief < 0.2 ? 'INACTIVE' : 'WEAKENING';
  return belief < 0.2 &&
    fusion.observationCount > 0 &&
    fusion.counts.NEGATIVE + fusion.counts.CONTRADICTORY > 0
    ? 'INACTIVE'
    : 'CANDIDATE';
}

// ── Graph relevance (§25, §34) → GraphChangeCommand operation (gap analysis mapping) ────────

export interface RelevanceInput {
  readonly assertionId: string;
  readonly fusion: FusionResult;
  readonly previousBelief: number | null;
  readonly previousState: KnowledgeState | null;
  readonly hadPriorDecision: boolean;
}

export interface RelevanceResult {
  readonly relationshipId: string;
  readonly decision: RelevanceDecision;
  readonly operation: GraphOperation | null;
  readonly beliefScore: number;
  readonly justification: string;
  readonly evidenceIds: readonly string[];
  readonly reasonCodes: readonly string[];
}

export function decideRelevance(input: RelevanceInput): RelevanceResult {
  const { fusion } = input;
  const belief = fusion.currentScore;
  const evidenceIds = [...fusion.supportingEvidenceIds, ...fusion.contradictoryEvidenceIds];
  const negativeOnly =
    fusion.counts.POSITIVE + fusion.counts.NEUTRAL === 0 &&
    fusion.counts.NEGATIVE + fusion.counts.CONTRADICTORY > 0;
  const contradicted = fusion.counts.POSITIVE > 0 && fusion.counts.NEGATIVE + fusion.counts.CONTRADICTORY > 0;

  const result = (
    decision: RelevanceDecision,
    operation: GraphOperation | null,
    justification: string,
    reasonCodes: string[],
  ): RelevanceResult => ({
    relationshipId: input.assertionId,
    decision,
    operation,
    beliefScore: belief,
    justification,
    evidenceIds,
    reasonCodes,
  });

  if (!input.hadPriorDecision) {
    if (negativeOnly)
      return result(
        'NO_CHANGE',
        'REJECT',
        `Only negative evidence (${fusion.counts.NEGATIVE + fusion.counts.CONTRADICTORY}) for a relationship that was never established; record the rejection without creating it`,
        ['NEGATIVE_ONLY', 'NEVER_ESTABLISHED'],
      );
    if (belief >= 0.3)
      return result(
        'EXPAND',
        'ADD',
        `New relationship with belief ${belief.toFixed(3)} from ${fusion.independentSourceCount} independent source(s)`,
        ['NEW_RELATIONSHIP', fusion.independentSourceCount > 1 ? 'MULTI_SOURCE' : 'SINGLE_SOURCE'],
      );
    return result(
      'INVESTIGATE',
      null,
      `Belief ${belief.toFixed(3)} is too weak to add; collect more evidence`,
      ['INSUFFICIENT_BELIEF'],
    );
  }

  const previous = input.previousBelief ?? 0;
  const delta = belief - previous;
  if (belief < 0.15 && previous >= 0.15)
    return result(
      'PRUNE',
      'PRUNE',
      `Belief fell to ${belief.toFixed(3)} from ${previous.toFixed(3)}; deactivate from active traversal, history retained`,
      ['BELIEF_COLLAPSED'],
    );
  if (contradicted && belief < 0.4 && fusion.independentSourceCount < 3)
    return result(
      'INVESTIGATE',
      null,
      `Contradictory evidence leaves belief at ${belief.toFixed(3)}; more independent evidence needed`,
      ['CONTRADICTION', 'INSUFFICIENT_INDEPENDENCE'],
    );
  if (delta >= MATERIAL_DELTA)
    return result('REINFORCE', 'REINFORCE', `Belief rose ${previous.toFixed(3)} → ${belief.toFixed(3)}`, [
      'POSITIVE_EVIDENCE',
    ]);
  if (delta <= -MATERIAL_DELTA)
    return result(
      'DECAY',
      belief < 0.3 ? 'DEACTIVATE' : 'DECAY',
      `Belief fell ${previous.toFixed(3)} → ${belief.toFixed(3)}`,
      [fusion.staleness < 0.6 ? 'STALE' : 'NEGATIVE_EVIDENCE'],
    );
  return result('MAINTAIN', null, `Belief ${belief.toFixed(3)} unchanged within tolerance`, [
    'NO_MATERIAL_CHANGE',
  ]);
}

export const POLICY = {
  version: EVIDENCE_POLICY_VERSION,
  sourceReliability: SOURCE_RELIABILITY,
  halfLifeDays: HALF_LIFE_DAYS,
  promotion: PROMOTION,
} as const;
