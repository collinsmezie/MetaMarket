import type { CapabilityRef } from './capability';

/**
 * Demand-side models for the Capability Matching Engine (CME TDR).
 *
 * The CME transforms customer demand into a ranked list of vendors. It reasons about intent
 * rather than matching keywords, because "customers think in needs, not categories" and because
 * informal-market shops carry overlapping inventories that a category filter would hide.
 */

/**
 * How the customer is searching (CME §20).
 *
 * The mode decides the *understanding* strategy, not the retrieval strategy — all four converge
 * on the same expansion → resolution → retrieval → ranking pipeline (CME §27.7).
 */
export const SEARCH_MODES = ['item', 'descriptive', 'business', 'vibe'] as const;

export type SearchMode = (typeof SEARCH_MODES)[number];

/** Why ambiguity exists, which determines whether clarifying is worth a question (CME §22). */
export const AMBIGUITY_TYPES = ['none', 'polysemy', 'homonymy', 'underspecified'] as const;

export type AmbiguityType = (typeof AMBIGUITY_TYPES)[number];

/**
 * Structured demand (CME §6).
 *
 * Missing fields are left empty on purpose: "Do not infer missing information... Missing
 * modifiers represent uncertainty, not failure." Inventing a modifier here would silently
 * narrow the vendor set.
 */
export interface DemandObject {
  readonly rawQuery: string;
  readonly mode: SearchMode;
  readonly products: readonly string[];
  readonly services: readonly string[];
  readonly businessTypes: readonly string[];
  readonly quantities: readonly string[];
  readonly modifiers: readonly string[];
  readonly constraints: readonly string[];
  readonly brands: readonly string[];
  readonly location: string | null;
  readonly ambiguityType: AmbiguityType;
  readonly ambiguityScore: number;
  /** Distinct readings of an ambiguous term, offered to the customer verbatim. */
  readonly ambiguityOptions: readonly string[];
}

/**
 * The three independent reasoning layers (CME §8).
 *
 * Their independence is the point: three weak, differently-wrong signals outperform one strong
 * signal, and the Inventory Affinity graph in particular is what surfaces the general store that
 * happens to stock hammers.
 */
export interface SemanticExpansion {
  /** What the customer is trying to accomplish (CME §8.1). */
  readonly missions: readonly string[];
  /** Business capabilities that normally satisfy this demand, with confidence (CME §8.2). */
  readonly capabilities: readonly { name: string; confidence: number }[];
  /** Business types that plausibly stock it despite it not being their specialty (CME §8.3). */
  readonly inventoryAffinities: readonly { name: string; confidence: number }[];
  /** Concrete products inferred for a vibe or descriptive search. */
  readonly inferredProducts: readonly string[];
}

/** Demand resolved to canonical identifiers, ready for retrieval. */
export interface ResolvedDemand {
  readonly demand: DemandObject;
  readonly expansion: SemanticExpansion;
  /** Canonical capabilities from the direct products/services the customer named. */
  readonly primaryCapabilities: readonly CapabilityRef[];
  /** Canonical capabilities from expansion — broader, weaker, and scored as such. */
  readonly expandedCapabilities: readonly CapabilityRef[];
}

/** One ranked vendor with its explanation (CME §15). */
export interface RankedVendor {
  readonly vendorId: string;
  readonly businessName: string;
  readonly phone?: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly score: number;
  readonly rating?: string | null;
  readonly description?: string | null;
  readonly components: RankingComponents;
  /** Human-readable justifications (CME §14). */
  readonly reasons: readonly string[];
}

/**
 * The independent signals combined into a final score (CME §13).
 *
 * Kept separate rather than pre-blended so a ranking can be explained, audited and re-weighted
 * without re-running retrieval — and so a future Learning-to-Rank model has features to learn on
 * (CME §18).
 */
export interface RankingComponents {
  /** How well the vendor's DNA covers the primary capabilities. */
  readonly capabilityMatch: number;
  /** Coverage of the expansion layers — the overlapping-inventory signal. */
  readonly expansionMatch: number;
  /** Marketplace behaviour, from the Evidence Service. */
  readonly evidenceScore: number;
  /** Confidence in the evidence itself; low for a new vendor. */
  readonly evidenceConfidence: number;
  /** Proximity, when both customer and vendor locations are known. */
  readonly proximity: number;
  /** Whether the vendor is currently accepting requests. */
  readonly availability: number;
}

/**
 * Ranking weights (CME §13, "Weights are configurable").
 *
 * Capability dominates because a vendor who cannot supply the item is useless however reliable
 * they are. Evidence is second and rising — it is the signal that improves as the marketplace
 * runs, and CME §12 is explicit that "marketplace evidence always overrides AI assumptions" when
 * the two disagree. Expansion is deliberately small: it exists to surface non-obvious vendors,
 * not to outvote a specialist.
 */
export const DEFAULT_RANKING_WEIGHTS = {
  capabilityMatch: 0.4,
  expansionMatch: 0.1,
  evidenceScore: 0.3,
  proximity: 0.15,
  availability: 0.05,
} as const;

export type RankingWeights = typeof DEFAULT_RANKING_WEIGHTS;

/**
 * Blends the component signals into a final score.
 *
 * Evidence is faded in by its own confidence rather than trusted flat: an unproven vendor's
 * neutral 0.5 should neither help nor hurt them, so its weight is redistributed to capability
 * match. Without this, cold-start vendors would be permanently mid-table regardless of how well
 * they match the request.
 */
export function combineRanking(
  components: RankingComponents,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): number {
  const evidenceWeight = weights.evidenceScore * components.evidenceConfidence;
  const reclaimed = weights.evidenceScore - evidenceWeight;

  const capabilityWeight = weights.capabilityMatch + reclaimed;

  const total =
    capabilityWeight + weights.expansionMatch + evidenceWeight + weights.proximity + weights.availability;

  const weighted =
    components.capabilityMatch * capabilityWeight +
    components.expansionMatch * weights.expansionMatch +
    components.evidenceScore * evidenceWeight +
    components.proximity * weights.proximity +
    components.availability * weights.availability;

  return total === 0 ? 0 : Math.min(1, Math.max(0, weighted / total));
}

/**
 * Whether ambiguity is worth spending a clarification question on (CME §7, §22).
 *
 * "Clarify only when ambiguity materially changes the vendor set." A hammer has variants but
 * every hardware shop stocks one; a printer could send the customer to four unrelated trades.
 * The distinguishing test is whether the readings lead to genuinely different vendors, which is
 * why an option count is required rather than a score alone.
 */
export function needsClarification(demand: DemandObject, threshold = 0.6): boolean {
  if (demand.ambiguityType === 'none') return false;
  if (demand.ambiguityOptions.length < 2) return false;

  return demand.ambiguityScore >= threshold;
}

/**
 * Proximity score from distance in kilometres.
 *
 * Decays smoothly rather than cutting off: in informal markets a slightly further vendor who
 * definitely has the item beats a near one who might not, so distance should nudge the ranking
 * rather than gate it.
 */
export function proximityScore(distanceKm: number | null): number {
  if (distanceKm === null) return 0.5;

  const HORIZON_KM = 25;
  return Math.max(0, 1 - Math.min(distanceKm, HORIZON_KM) / HORIZON_KM);
}
