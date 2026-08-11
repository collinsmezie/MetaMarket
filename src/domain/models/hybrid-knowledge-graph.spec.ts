import {
  computeHkgmScore,
  evaluateGraphMatch,
  evaluateMissionMatch,
  hasAffinityEdge,
  HKGM_WEIGHTS,
  TIER_SCORES,
  type HkgmScoreComponents,
  type MerchantArchetype,
  type MissionNode,
} from './hybrid-knowledge-graph';

/**
 * Tests for the 3-Layer Hybrid Knowledge Graph Model (DAEM TDR §9).
 *
 * Every test maps to a real-world failure scenario the HKGM was designed to
 * resolve. The three mandatory quality-gate tests from TDR §9 are named
 * with their TDR reference.
 */

// ── Test fixtures ────────────────────────────────────────────────────────────

/** GS1 GPC Segment codes used across tests. */
const SEGMENTS = {
  automotive: '47000000',
  healthcare: '51000000',
  personalCare: '53000000',
  textiles: '67000000',
  homeAppliances: '72000000',
  food: '50000000',
  hardware: '21000000',
} as const;

/** GS1 GPC Brick codes used across tests. */
const BRICKS = {
  wiperBlades: '10002044',
  babyWipes: '10003500',
  flour: '10000165',
  cakePans: '10002102',
  foodMixers: '10002044',
  aaBatteries: '10006231',
} as const;

const pharmacyChemist: MerchantArchetype = {
  archetypeId: 'pharmacy_chemist',
  primarySegment: SEGMENTS.healthcare,
  affinitySegments: [SEGMENTS.personalCare, SEGMENTS.food],
};

const tailoringFashion: MerchantArchetype = {
  archetypeId: 'tailoring_fashion',
  primarySegment: SEGMENTS.textiles,
  affinitySegments: [],
};

const autoSpares: MerchantArchetype = {
  archetypeId: 'auto_spare_parts',
  primarySegment: SEGMENTS.automotive,
  affinitySegments: [SEGMENTS.homeAppliances],
};

const provisionStore: MerchantArchetype = {
  archetypeId: 'provision_store',
  primarySegment: SEGMENTS.food,
  affinitySegments: [SEGMENTS.personalCare, SEGMENTS.homeAppliances],
};

// ── evaluateGraphMatch: single brick evaluation ──────────────────────────────

describe('evaluateGraphMatch', () => {
  // ── TDR §9 Test 1: Cross-Domain Suppression ────────────────────────────
  it('suppresses a tailoring vendor for an AUTOMOTIVE query (TDR §9.1)', () => {
    // A tailor has no edge to automotive; score MUST be 0.0.
    const result = evaluateGraphMatch(
      [], // no capabilities
      tailoringFashion,
      BRICKS.wiperBlades,
      SEGMENTS.automotive,
    );

    expect(result.score).toBe(0.0);
    expect(result.tier).toBe('CROSS_DOMAIN');
    expect(result.isMatch).toBe(false);
  });

  // ── TDR §9 Test 2: Archetype Affinity Match ────────────────────────────
  it('gives a Chemist a non-zero Layer 2 score for Baby Wipes / Personal Care (TDR §9.2)', () => {
    // A pharmacy_chemist has personalCare in its affinity segments,
    // so a Baby Wipes query (Segment 53000000) should match at Tier 2.
    const result = evaluateGraphMatch(
      [], // no direct brick capabilities
      pharmacyChemist,
      BRICKS.babyWipes,
      SEGMENTS.personalCare,
    );

    expect(result.score).toBe(0.75);
    expect(result.tier).toBe('TIER_2_ARCHETYPE');
    expect(result.isMatch).toBe(true);
  });

  it('returns a direct Tier 1 match when the vendor holds the exact brick', () => {
    const result = evaluateGraphMatch(
      [BRICKS.wiperBlades], // direct capability
      autoSpares,
      BRICKS.wiperBlades,
      SEGMENTS.automotive,
    );

    expect(result.score).toBe(1.0);
    expect(result.tier).toBe('TIER_1_CANONICAL');
    expect(result.isMatch).toBe(true);
  });

  it('prefers direct match over archetype when both are present', () => {
    // Auto spare parts dealer has the brick AND the segment affinity.
    const result = evaluateGraphMatch(
      [BRICKS.wiperBlades],
      autoSpares,
      BRICKS.wiperBlades,
      SEGMENTS.automotive,
    );

    // Direct match should win — it is the stronger claim.
    expect(result.tier).toBe('TIER_1_CANONICAL');
    expect(result.score).toBe(1.0);
  });

  it('matches on primary segment, not just affinity segments', () => {
    // Healthcare is the pharmacy's primary segment.
    const result = evaluateGraphMatch(
      [],
      pharmacyChemist,
      '99999999', // some brick in Healthcare
      SEGMENTS.healthcare,
    );

    expect(result.tier).toBe('TIER_2_ARCHETYPE');
    expect(result.isMatch).toBe(true);
  });

  it('suppresses when no archetype is provided and no direct capability exists', () => {
    const result = evaluateGraphMatch(
      [], // no capabilities
      null, // no archetype
      BRICKS.flour,
      SEGMENTS.food,
    );

    expect(result.score).toBe(0.0);
    expect(result.tier).toBe('CROSS_DOMAIN');
    expect(result.isMatch).toBe(false);
  });

  it('matches directly even without an archetype', () => {
    // A vendor with the exact brick but no archetype data still matches.
    const result = evaluateGraphMatch([BRICKS.flour], null, BRICKS.flour, SEGMENTS.food);

    expect(result.score).toBe(1.0);
    expect(result.tier).toBe('TIER_1_CANONICAL');
    expect(result.isMatch).toBe(true);
  });
});

// ── evaluateMissionMatch: multi-brick mission evaluation ─────────────────────

describe('evaluateMissionMatch', () => {
  const cakeBaking: MissionNode = {
    id: 'mission_cake_baking',
    name: 'Cake Baking',
    targetBricks: [BRICKS.flour, BRICKS.cakePans, BRICKS.foodMixers],
  };

  const brickToSegment = new Map<string, string>([
    [BRICKS.flour, SEGMENTS.food],
    [BRICKS.cakePans, SEGMENTS.hardware],
    [BRICKS.foodMixers, SEGMENTS.homeAppliances],
  ]);

  it('surfaces a provision store for a cake baking mission via food affinity', () => {
    const result = evaluateMissionMatch(
      [], // no direct brick capabilities
      provisionStore,
      cakeBaking,
      brickToSegment,
    );

    // The provision store's primary segment is food; flour is in food.
    // Reached through archetype → classified as mission match.
    expect(result.isMatch).toBe(true);
    expect(result.tier).toBe('TIER_3_MISSION');
    expect(result.score).toBe(TIER_SCORES.missionMatch);
  });

  it('suppresses a tailor for a cake baking mission', () => {
    const result = evaluateMissionMatch([], tailoringFashion, cakeBaking, brickToSegment);

    expect(result.isMatch).toBe(false);
    expect(result.score).toBe(0.0);
    expect(result.tier).toBe('CROSS_DOMAIN');
  });

  it('returns Tier 1 when the vendor holds one of the mission bricks directly', () => {
    const result = evaluateMissionMatch(
      [BRICKS.flour], // has flour directly
      provisionStore,
      cakeBaking,
      brickToSegment,
    );

    // Direct match beats mission match.
    expect(result.tier).toBe('TIER_1_CANONICAL');
    expect(result.score).toBe(TIER_SCORES.canonical);
  });

  it('handles missions with bricks not in the segment map gracefully', () => {
    const partialMap = new Map<string, string>([
      // Only flour is mapped; the other bricks are missing.
      [BRICKS.flour, SEGMENTS.food],
    ]);

    const result = evaluateMissionMatch([], provisionStore, cakeBaking, partialMap);

    // Should still match on the one mapped brick.
    expect(result.isMatch).toBe(true);
  });

  it('returns CROSS_DOMAIN for an empty mission', () => {
    const empty: MissionNode = { id: 'empty', name: 'Empty', targetBricks: [] };

    const result = evaluateMissionMatch([], provisionStore, empty, brickToSegment);

    expect(result.isMatch).toBe(false);
    expect(result.score).toBe(0.0);
  });
});

// ── computeHkgmScore: weighted formula ───────────────────────────────────────

describe('computeHkgmScore', () => {
  const components = (overrides: Partial<HkgmScoreComponents>): HkgmScoreComponents => ({
    canonical: 0,
    archetypeAffinity: 0,
    missionMatch: 0,
    evidence: 0.5,
    proximity: 0,
    ...overrides,
  });

  it('produces the highest score for a direct canonical match with strong evidence', () => {
    const direct = computeHkgmScore(
      components({
        canonical: 1.0,
        evidence: 0.9,
      }),
    );

    const archetype = computeHkgmScore(
      components({
        archetypeAffinity: 0.75,
        evidence: 0.9,
      }),
    );

    expect(direct).toBeGreaterThan(archetype);
  });

  it('ranks archetype match above mission match', () => {
    const arch = computeHkgmScore(components({ archetypeAffinity: 0.75 }));
    const mission = computeHkgmScore(components({ missionMatch: 0.5 }));

    expect(arch).toBeGreaterThan(mission);
  });

  it('forces the score to 0 when all layer signals are 0 (cross-domain)', () => {
    const crossDomain = computeHkgmScore(
      components({
        canonical: 0,
        archetypeAffinity: 0,
        missionMatch: 0,
        evidence: 0,
        proximity: 0,
      }),
    );

    expect(crossDomain).toBe(0);
  });

  it('lets proximity nudge two otherwise-equal vendors apart', () => {
    const near = computeHkgmScore(
      components({
        canonical: 1.0,
        proximity: 0.1,
      }),
    );

    const far = computeHkgmScore(
      components({
        canonical: 1.0,
        proximity: 0,
      }),
    );

    expect(near).toBeGreaterThan(far);
  });

  it('clamps the result to [0,1]', () => {
    // Extreme inputs: everything at max.
    const maxScore = computeHkgmScore(
      components({
        canonical: 1.0,
        archetypeAffinity: 1.0,
        missionMatch: 1.0,
        evidence: 1.0,
        proximity: 1.0,
      }),
    );

    expect(maxScore).toBeLessThanOrEqual(1);
    expect(maxScore).toBeGreaterThanOrEqual(0);

    // All zeros.
    const minScore = computeHkgmScore(
      components({
        canonical: 0,
        archetypeAffinity: 0,
        missionMatch: 0,
        evidence: 0,
        proximity: 0,
      }),
    );

    expect(minScore).toBe(0);
  });

  it('applies TDR §4 weights correctly', () => {
    // Manual calculation: 0.45 * 1.0 + 0.25 * 0.75 + 0.15 * 0.50 + 0.15 * 0.8 + 0.0
    //                   = 0.45 + 0.1875 + 0.075 + 0.12 = 0.8325
    const score = computeHkgmScore(
      {
        canonical: 1.0,
        archetypeAffinity: 0.75,
        missionMatch: 0.5,
        evidence: 0.8,
        proximity: 0,
      },
      HKGM_WEIGHTS,
    );

    expect(score).toBeCloseTo(0.8325, 4);
  });
});

// ── hasAffinityEdge: cross-domain gate ───────────────────────────────────────

describe('hasAffinityEdge', () => {
  it('returns true for the primary segment', () => {
    expect(hasAffinityEdge(pharmacyChemist, SEGMENTS.healthcare)).toBe(true);
  });

  it('returns true for an affinity segment', () => {
    expect(hasAffinityEdge(pharmacyChemist, SEGMENTS.personalCare)).toBe(true);
  });

  it('returns false for an unconnected segment', () => {
    expect(hasAffinityEdge(pharmacyChemist, SEGMENTS.automotive)).toBe(false);
  });

  it('returns false for archetypes with no affinity segments', () => {
    expect(hasAffinityEdge(tailoringFashion, SEGMENTS.automotive)).toBe(false);
  });
});

// ── Real-world failure scenario resolution (DAEM TDR §7) ─────────────────────

describe('TDR §7 Failure Scenario Resolution', () => {
  it('Scenario 1: Hybrid Merchants — Chemist surfaces for non-primary Personal Care query', () => {
    // A chemist should not be locked out of baby wipes queries just because
    // Healthcare is their primary segment.
    const result = evaluateGraphMatch([], pharmacyChemist, BRICKS.babyWipes, SEGMENTS.personalCare);

    expect(result.isMatch).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('Scenario 3: Segment Noise — Tailor does NOT surface for automotive query', () => {
    // A tailor's archetype has zero connection to automotive.
    const result = evaluateGraphMatch([], tailoringFashion, BRICKS.wiperBlades, SEGMENTS.automotive);

    expect(result.isMatch).toBe(false);
    expect(result.score).toBe(0.0);
  });

  it('Scenario 4: Local Bundling — Provision store surfaces for batteries via affinity', () => {
    // A provision store in Nigeria typically stocks AA batteries alongside
    // packaged food, even though batteries are in a different Segment.
    const result = evaluateGraphMatch([], provisionStore, BRICKS.aaBatteries, SEGMENTS.homeAppliances);

    // Home appliances is in the provision store's affinity segments.
    expect(result.isMatch).toBe(true);
    expect(result.tier).toBe('TIER_2_ARCHETYPE');
  });
});
