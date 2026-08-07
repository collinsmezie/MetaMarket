import type { DemandObject, RankingComponents } from './demand';
import { combineRanking, needsClarification, proximityScore } from './demand';

const demand = (overrides: Partial<DemandObject>): DemandObject => ({
  rawQuery: 'hammer',
  mode: 'item',
  products: ['hammer'],
  services: [],
  businessTypes: [],
  quantities: [],
  modifiers: [],
  constraints: [],
  brands: [],
  location: null,
  ambiguityType: 'none',
  ambiguityScore: 0,
  ambiguityOptions: [],
  ...overrides,
});

const components = (overrides: Partial<RankingComponents>): RankingComponents => ({
  capabilityMatch: 0.8,
  expansionMatch: 0,
  evidenceScore: 0.5,
  evidenceConfidence: 0,
  proximity: 0.5,
  availability: 1,
  ...overrides,
});

describe('needsClarification', () => {
  it('does not clarify an unambiguous request', () => {
    // "Hammer" has variants, but every hardware shop stocks one (CME §7).
    expect(needsClarification(demand({ ambiguityType: 'none', ambiguityScore: 0.9 }))).toBe(false);
  });

  it('clarifies when readings lead to genuinely different shops', () => {
    const printer = demand({
      rawQuery: 'printer',
      products: ['printer'],
      ambiguityType: 'polysemy',
      ambiguityScore: 0.9,
      ambiguityOptions: ['Home / Office', 'POS Receipt', '3D', 'Large Format'],
    });

    expect(needsClarification(printer)).toBe(true);
  });

  it('refuses to clarify without at least two distinct options', () => {
    // A high score with nothing to choose between would produce a useless question.
    const vague = demand({
      ambiguityType: 'underspecified',
      ambiguityScore: 0.95,
      ambiguityOptions: ['One'],
    });

    expect(needsClarification(vague)).toBe(false);
  });

  it('does not clarify below the threshold', () => {
    const mild = demand({
      ambiguityType: 'polysemy',
      ambiguityScore: 0.3,
      ambiguityOptions: ['A', 'B'],
    });

    expect(needsClarification(mild)).toBe(false);
  });
});

describe('proximityScore', () => {
  it('is neutral when distance is unknown', () => {
    // Guessing would be worse than admitting ignorance.
    expect(proximityScore(null)).toBe(0.5);
  });

  it('is highest for a vendor in the same place', () => {
    expect(proximityScore(0)).toBe(1);
  });

  it('decays with distance rather than cutting off', () => {
    expect(proximityScore(5)).toBeGreaterThan(proximityScore(15));
    expect(proximityScore(15)).toBeGreaterThan(0);
  });

  it('bottoms out beyond the horizon instead of going negative', () => {
    expect(proximityScore(1000)).toBe(0);
  });
});

describe('combineRanking', () => {
  it('ranks a better capability match higher, all else equal', () => {
    const strong = combineRanking(components({ capabilityMatch: 0.9 }));
    const weak = combineRanking(components({ capabilityMatch: 0.3 }));

    expect(strong).toBeGreaterThan(weak);
  });

  it('lets proven evidence separate two equally capable vendors', () => {
    const proven = combineRanking(components({ evidenceScore: 0.9, evidenceConfidence: 1 }));
    const poor = combineRanking(components({ evidenceScore: 0.2, evidenceConfidence: 1 }));

    expect(proven).toBeGreaterThan(poor);
  });

  it('does not penalise a vendor for having no evidence yet', () => {
    // Cold start must not be a life sentence: an unproven vendor's neutral score is faded out
    // by its own zero confidence rather than dragging them down.
    const unproven = combineRanking(
      components({ capabilityMatch: 0.9, evidenceScore: 0.5, evidenceConfidence: 0 }),
    );
    const provenPoor = combineRanking(
      components({ capabilityMatch: 0.9, evidenceScore: 0.2, evidenceConfidence: 1 }),
    );

    expect(unproven).toBeGreaterThan(provenPoor);
  });

  it('lets a strong capability match beat a merely well-reviewed vendor', () => {
    const capable = combineRanking(
      components({ capabilityMatch: 0.95, evidenceScore: 0.5, evidenceConfidence: 0 }),
    );
    const popular = combineRanking(
      components({ capabilityMatch: 0.2, evidenceScore: 0.95, evidenceConfidence: 1 }),
    );

    // A vendor who cannot supply the item is useless however reliable they are.
    expect(capable).toBeGreaterThan(popular);
  });

  it('treats expansion as a tiebreaker, not a driver', () => {
    const specialist = combineRanking(components({ capabilityMatch: 0.8, expansionMatch: 0 }));
    const affinityOnly = combineRanking(components({ capabilityMatch: 0, expansionMatch: 1 }));

    expect(specialist).toBeGreaterThan(affinityOnly);
  });

  it('still surfaces an affinity-only vendor above nothing', () => {
    // The overlapping-inventory case the CME exists to catch (CME Test 1).
    expect(combineRanking(components({ capabilityMatch: 0, expansionMatch: 0.6 }))).toBeGreaterThan(0);
  });

  it('prefers a nearer vendor when everything else matches', () => {
    const near = combineRanking(components({ proximity: 1 }));
    const far = combineRanking(components({ proximity: 0 }));

    expect(near).toBeGreaterThan(far);
  });

  it('always produces a score within [0,1]', () => {
    const extremes = [
      components({
        capabilityMatch: 1,
        expansionMatch: 1,
        evidenceScore: 1,
        evidenceConfidence: 1,
        proximity: 1,
      }),
      components({
        capabilityMatch: 0,
        expansionMatch: 0,
        evidenceScore: 0,
        evidenceConfidence: 1,
        proximity: 0,
        availability: 0,
      }),
    ];

    for (const c of extremes) {
      const score = combineRanking(c);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
