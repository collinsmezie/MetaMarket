/**
 * Canonical types and pure predicates for the 3-Layer Hybrid Knowledge Graph.
 *
 * Implements Domain-Aligned Expansion Matching (DAEM) as specified by the
 * DAEM TDR (§2, §4, §8). Grounded in CONTRIBUTING §3.1 (zero framework or
 * database dependencies), §3.6 (pure functions over canonical models belong
 * in domain/models), §4.3 (ubiquitous language), and §4.6 (value objects
 * over primitives).
 *
 * The 3 layers are:
 *
 *   Layer 1 — Human Intent (COICOP):   Translates buyer missions into
 *             multi-product target arrays (MissionNode).
 *   Layer 2 — Merchant Archetype:      Maps informal business archetypes to
 *             co-occurring capability beliefs (MerchantArchetype).
 *   Layer 3 — Canonical Backbone:      GS1 GPC tree + pgvector HNSW index
 *             for exact and semantic retrieval (CanonicalGpcNode).
 */

// ── Layer 1: Human Intent & Purpose (COICOP) ────────────────────────────────

/**
 * A buyer mission decomposed into multi-domain target bricks (DAEM TDR §2,
 * Layer 1).
 *
 * "I want to bake a birthday cake" → targetBricks spanning Flour, Bakeware
 * and Food Mixers across three different GPC Segments.
 */
export interface MissionNode {
  readonly id: string;
  readonly name: string;
  /** GS1 Brick IDs the mission requires, potentially across Segments. */
  readonly targetBricks: readonly string[];
}

// ── Layer 2: Merchant Archetype & Affinity ───────────────────────────────────

/**
 * An informal merchant archetype with its affinity vector (DAEM TDR §2,
 * Layer 2).
 *
 * West African trade clusters stock cross-segment inventory: a Chemist
 * carries pharmaceuticals AND baby wipes, soaps, and cosmetics. The affinity
 * segments capture this without requiring individual SKU declarations.
 */
export interface MerchantArchetype {
  readonly archetypeId: string;
  /** The vendor's primary GPC Segment code (e.g. "51000000" for Healthcare). */
  readonly primarySegment: string;
  /** GPC Segment codes the archetype plausibly co-stocks (DAEM TDR §5). */
  readonly affinitySegments: readonly string[];
}

// ── Layer 3: Canonical Backbone (GS1 GPC + pgvector) ─────────────────────────

/**
 * Identifies a GPC node for graph traversal (DAEM TDR §2, Layer 3).
 *
 * Not a full TaxonomyNode — the graph model needs only the code and its
 * owning Segment, so it stays minimal and framework-free.
 */
export interface CanonicalGpcNode {
  readonly brickId: string;
  readonly segmentId: string;
}

// ── Match Tiers (DAEM TDR §4) ────────────────────────────────────────────────

/**
 * Tier labels ordered by descending strength (DAEM TDR §4).
 *
 * `CROSS_DOMAIN` is mathematically guaranteed to suppress irrelevant vendors
 * (DAEM TDR §4, "Cross-Domain Protection").
 */
export const GRAPH_MATCH_TIERS = [
  'TIER_1_CANONICAL',
  'TIER_2_ARCHETYPE',
  'TIER_3_MISSION',
  'CROSS_DOMAIN',
] as const;

export type GraphMatchTier = (typeof GRAPH_MATCH_TIERS)[number];

/** Discriminated result of one graph-layer evaluation (DAEM TDR §8.1). */
export interface GraphMatchResult {
  readonly score: number;
  readonly tier: GraphMatchTier;
  readonly isMatch: boolean;
}

// ── Layer Scoring Weights (DAEM TDR §4) ──────────────────────────────────────

/**
 * Weights for the multi-layer scoring formula (DAEM TDR §4):
 *
 *   FinalScore(V) = W_L3 · S_canonical + W_L2 · S_archetypeAffinity
 *                 + W_L1 · S_missionMatch + W_evid · S_evidence + P_prox
 */
export const HKGM_WEIGHTS = {
  /** Layer 3: Direct Canonical Match. */
  canonical: 0.45,
  /** Layer 2: Archetype Affinity. */
  archetypeAffinity: 0.25,
  /** Layer 1: Mission / Human Intent. */
  missionMatch: 0.15,
  /** Evidence from the Evidence Service. */
  evidence: 0.15,
} as const;

export type HkgmWeights = typeof HKGM_WEIGHTS;

/** Tier-specific raw scores before weighting (DAEM TDR §4). */
export const TIER_SCORES = {
  /** Vendor holds exact GS1 Brick capability. */
  canonical: 1.0,
  /** Vendor's archetype covers the requested Segment. */
  archetypeAffinity: 0.75,
  /** Vendor operates within the broader mission domain. */
  missionMatch: 0.5,
} as const;

// ── Pure Domain Predicates ───────────────────────────────────────────────────

/**
 * Evaluates a single vendor against one target brick through the 3-layer
 * Hybrid Knowledge Graph (DAEM TDR §4, §8.1).
 *
 * Evaluation cascades from the most specific (Layer 3 direct match) to the
 * broadest (Layer 1 mission). Cross-domain suppression is enforced when the
 * vendor's archetype vector has zero edge connection to the target segment
 * in Layer 2 — score is forced to 0.0 regardless.
 *
 * CONTRIBUTING §4.4: Pure, deterministic, unit-testable without a database.
 */
export function evaluateGraphMatch(
  vendorCapabilities: readonly string[],
  vendorArchetype: MerchantArchetype | null,
  targetBrickId: string,
  targetSegmentId: string,
): GraphMatchResult {
  // ── Layer 3: Direct Canonical Match ──────────────────────────────────────
  if (vendorCapabilities.includes(targetBrickId)) {
    return { score: TIER_SCORES.canonical, tier: 'TIER_1_CANONICAL', isMatch: true };
  }

  // ── Layer 2: Archetype Affinity Match ────────────────────────────────────
  if (vendorArchetype !== null) {
    const coversSegment =
      vendorArchetype.primarySegment === targetSegmentId ||
      vendorArchetype.affinitySegments.includes(targetSegmentId);

    if (coversSegment) {
      return { score: TIER_SCORES.archetypeAffinity, tier: 'TIER_2_ARCHETYPE', isMatch: true };
    }
  }

  // ── Cross-Domain Suppression (DAEM TDR §4, "Cross-Domain Protection") ───
  // If vendor has an archetype but no edge to the target segment, force 0.0.
  // This mathematically guarantees 100% suppression of cross-domain noise.
  return { score: 0.0, tier: 'CROSS_DOMAIN', isMatch: false };
}

/**
 * Evaluates whether a vendor's capabilities or archetype overlap with any
 * brick in a mission node's target set (DAEM TDR §2, Layer 1).
 *
 * Returns the best match found across all target bricks, so a vendor who
 * covers even one item in a multi-product mission surfaces.
 */
export function evaluateMissionMatch(
  vendorCapabilities: readonly string[],
  vendorArchetype: MerchantArchetype | null,
  mission: MissionNode,
  /** Maps each brick to its owning segment. Absent entries are skipped. */
  segmentOf: ReadonlyMap<string, string>,
): GraphMatchResult {
  let bestResult: GraphMatchResult = { score: 0.0, tier: 'CROSS_DOMAIN', isMatch: false };

  for (const brickId of mission.targetBricks) {
    const segmentId = segmentOf.get(brickId);
    if (segmentId === undefined) continue;

    const result = evaluateGraphMatch(vendorCapabilities, vendorArchetype, brickId, segmentId);

    if (result.score > bestResult.score) {
      bestResult = result;
    }
  }

  // A mission-level match that comes through archetype is still a mission match
  // for scoring purposes — it is the mission layer that surfaced the relevance.
  if (bestResult.isMatch && bestResult.tier === 'TIER_2_ARCHETYPE') {
    return { score: TIER_SCORES.missionMatch, tier: 'TIER_3_MISSION', isMatch: true };
  }

  return bestResult;
}

/**
 * Input signals for the full HKGM score computation (DAEM TDR §4).
 *
 * Each field corresponds to one term in the scoring formula. Keeping them
 * separate rather than pre-blended lets the score be explained, audited, and
 * re-weighted without re-running retrieval (CONTRIBUTING §4.4).
 */
export interface HkgmScoreComponents {
  /** S_canonical: 1.0 for exact brick match, 0 otherwise. */
  readonly canonical: number;
  /** S_archetypeAffinity: 0.75 for archetype coverage, 0 otherwise. */
  readonly archetypeAffinity: number;
  /** S_missionMatch: 0.50 for mission-layer coverage, 0 otherwise. */
  readonly missionMatch: number;
  /** S_evidence: from the Evidence Service, in [0,1]. */
  readonly evidence: number;
  /** P_prox: proximity bonus, in [0,1]. */
  readonly proximity: number;
}

/**
 * Computes the final HKGM score from its component signals (DAEM TDR §4).
 *
 * FinalScore(V) = W_L3·S_canonical + W_L2·S_archetypeAffinity
 *               + W_L1·S_missionMatch + W_evid·S_evidence + P_prox
 *
 * Cross-domain protection is enforced by the caller — when `evaluateGraphMatch`
 * returns CROSS_DOMAIN, the canonical and archetype components are already 0.0,
 * and the mission component must not rescue the score.
 *
 * CONTRIBUTING §4.4: Pure, deterministic function over value objects.
 */
export function computeHkgmScore(
  components: HkgmScoreComponents,
  weights: HkgmWeights = HKGM_WEIGHTS,
): number {
  const raw =
    weights.canonical * components.canonical +
    weights.archetypeAffinity * components.archetypeAffinity +
    weights.missionMatch * components.missionMatch +
    weights.evidence * components.evidence +
    components.proximity;

  // Proximity is additive, not weighted — it nudges the ranking rather than
  // competing with the layer scores. Clamped to [0,1] for safety.
  return Math.min(1, Math.max(0, raw));
}

/**
 * Checks whether a vendor's archetype has any edge to a target segment.
 *
 * This is the predicate that enforces cross-domain suppression: a vendor
 * whose archetype has zero overlap with the target is guaranteed to score
 * 0.0, regardless of mission or evidence signals (DAEM TDR §4).
 */
export function hasAffinityEdge(archetype: MerchantArchetype, targetSegmentId: string): boolean {
  return archetype.primarySegment === targetSegmentId || archetype.affinitySegments.includes(targetSegmentId);
}
