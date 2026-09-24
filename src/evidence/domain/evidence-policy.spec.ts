import { assertionIdOf, type NormalizedEvidence, type Polarity } from './evidence-model';
import { decideRelevance, fuse, promote } from './evidence-policy';

const NOW = new Date('2026-09-24T12:00:00Z');
const assertion = {
  subject: 'vendor:v1',
  predicate: 'mkg:SUPPLIES',
  object: 'concept:proposed:hammer drill',
};
const assertionId = assertionIdOf(assertion);

let counter = 0;
const evidence = (
  polarity: Polarity,
  sourceType: string,
  overrides: Partial<NormalizedEvidence> = {},
): NormalizedEvidence => {
  counter += 1;
  return {
    evidenceId: `obs_${counter}#ev_1`,
    observationId: `obs_${counter}`,
    assertion,
    assertionId,
    subjectType: 'ACTOR',
    objectType: 'MARKET_CONCEPT',
    subjectLabel: 'Vendor 1',
    objectLabel: 'hammer drill',
    polarity,
    strength: 0.85,
    kind: 'DIRECT',
    claim: 'claim',
    supports: [],
    contradicts: [],
    provenance: {
      sourceType,
      sourceId: null,
      sourceUrl: null,
      component: 'TEST',
      componentVersion: '1',
      requestId: null,
      turnId: null,
      actorId: 'vendor:v1',
      actorRole: 'VENDOR',
      channel: null,
      workflowId: null,
      interactionId: null,
      directness: 'DIRECT',
      quote: null,
      upstream: {},
    },
    independenceKey: `${sourceType}:vendor:v1:hammer drill:${counter}`,
    observedAt: new Date(NOW.getTime() - (10 - counter) * 86_400_000),
    validFrom: null,
    validUntil: null,
    context: { country: 'NG', region: null },
    sourcePayload: {},
    ...overrides,
  };
};

describe('fuse', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('follows the §43 journey: confirmations raise belief, a later out-of-stock lowers it, history is kept', () => {
    const items = [
      evidence('POSITIVE', 'VENDOR_STATEMENT'),
      evidence('POSITIVE', 'VENDOR_CLARIFICATION'),
      evidence('POSITIVE', 'FULFILLMENT_COMPLETED'),
      evidence('POSITIVE', 'VENDOR_INVENTORY_UPDATE'),
      evidence('NEGATIVE', 'VENDOR_INVENTORY_UPDATE'),
    ];
    const result = fuse({
      assertionId,
      assertion,
      evidence: items,
      prior: 0.5,
      previousBelief: null,
      now: NOW,
    });
    const scores = result.journey.map((step) => step.score);
    expect(scores.slice(0, 4)).toEqual([...scores.slice(0, 4)].sort((a, b) => a - b)); // monotone rise
    expect(scores[3]).toBeGreaterThan(0.85);
    expect(scores[4]).toBeLessThan(scores[3]!); // negative lowers
    expect(result.currentScore).toBeGreaterThan(0.5);
    expect(result.counts).toEqual({ POSITIVE: 4, NEGATIVE: 1, NEUTRAL: 0, CONTRADICTORY: 0 });
    expect(result.independentSourceCount).toBe(5);
    expect(result.contradictoryEvidenceIds).toHaveLength(1);
    expect(result.direction).toBe('INCREASING');
  });

  it('matches the §26 shape: confirmation lifts 0.5 high, a rejection lowers it moderately, repeated supply recovers it', () => {
    const fresh = (polarity: Polarity, source: string) => evidence(polarity, source, { observedAt: NOW });
    const yes = fuse({
      assertionId,
      assertion,
      evidence: [fresh('POSITIVE', 'VENDOR_CONFIRMATION')],
      prior: 0.5,
      previousBelief: null,
      now: NOW,
    });
    expect(yes.currentScore).toBeGreaterThan(0.8);
    const no = fuse({
      assertionId,
      assertion,
      evidence: [fresh('NEGATIVE', 'VENDOR_REJECTION')],
      prior: 0.5,
      previousBelief: null,
      now: NOW,
    });
    expect(no.currentScore).toBeGreaterThan(0.25);
    expect(no.currentScore).toBeLessThan(0.4);
    const recovered = fuse({
      assertionId,
      assertion,
      evidence: [
        fresh('NEGATIVE', 'VENDOR_REJECTION'),
        ...[1, 2, 3, 4].map(() => fresh('POSITIVE', 'FULFILLMENT_COMPLETED')),
      ],
      prior: 0.5,
      previousBelief: null,
      now: NOW,
    });
    expect(recovered.currentScore).toBeGreaterThan(0.85);
  });

  it('never lets duplicates of one observation count as independent corroboration (§8, §39)', () => {
    const once = fuse({
      assertionId,
      assertion,
      evidence: [evidence('POSITIVE', 'VENDOR_STATEMENT')],
      prior: 0,
      previousBelief: null,
      now: NOW,
    });
    counter = 0;
    const thrice = fuse({
      assertionId,
      assertion,
      evidence: [1, 2, 3].map(() =>
        evidence('POSITIVE', 'VENDOR_STATEMENT', {
          independenceKey: 'same',
          observedAt: new Date(NOW.getTime() - 9 * 86_400_000),
        }),
      ),
      prior: 0,
      previousBelief: null,
      now: NOW,
    });
    expect(thrice.independentSourceCount).toBe(1);
    expect(thrice.currentScore).toBe(once.currentScore);
  });

  it('caps a single source below certainty and clamps to [0,1]', () => {
    const single = fuse({
      assertionId,
      assertion,
      evidence: [evidence('POSITIVE', 'FULFILLMENT_COMPLETED', { strength: 1 })],
      prior: 0.5,
      previousBelief: null,
      now: NOW,
    });
    expect(single.currentScore).toBeLessThanOrEqual(0.9);
    const many = fuse({
      assertionId,
      assertion,
      evidence: Array.from({ length: 12 }, () =>
        evidence('POSITIVE', 'FULFILLMENT_COMPLETED', { strength: 1 }),
      ),
      prior: 0.5,
      previousBelief: null,
      now: NOW,
    });
    expect(many.currentScore).toBeLessThanOrEqual(1);
    expect(many.currentScore).toBeGreaterThan(0.95);
  });

  it('decays stale capability belief toward the prior but keeps semantic knowledge nearly intact', () => {
    const old = new Date(NOW.getTime() - 400 * 86_400_000);
    const capability = fuse({
      assertionId,
      assertion,
      evidence: [evidence('POSITIVE', 'VENDOR_CONFIRMATION', { observedAt: old })],
      prior: 0,
      previousBelief: null,
      now: NOW,
    });
    const semanticAssertion = {
      subject: 'phrase:ng:iron sponge',
      predicate: 'mkg:EXPRESSES',
      object: 'concept:proposed:steel wool',
    };
    const semantic = fuse({
      assertionId: assertionIdOf(semanticAssertion),
      assertion: semanticAssertion,
      evidence: [
        evidence('POSITIVE', 'VENDOR_CONFIRMATION', { observedAt: old, assertion: semanticAssertion }),
      ],
      prior: 0,
      previousBelief: null,
      now: NOW,
    });
    expect(capability.currentScore).toBeLessThan(semantic.currentScore);
    expect(capability.staleness).toBeLessThan(0.2);
  });
});

describe('promote / decideRelevance', () => {
  beforeEach(() => {
    counter = 0;
  });

  it('promotes claim-sensitively and demotes without erasing', () => {
    const one = fuse({
      assertionId,
      assertion,
      evidence: [evidence('POSITIVE', 'VENDOR_CONFIRMATION', { observedAt: NOW })],
      prior: 0,
      previousBelief: null,
      now: NOW,
    });
    expect(promote(assertion, one, null)).toBe('SUPPORTED'); // vendor capability: 1 direct source suffices
    const phrase = {
      subject: 'phrase:ng:iron sponge',
      predicate: 'mkg:EXPRESSES',
      object: 'concept:proposed:steel wool',
    };
    const phraseOnce = fuse({
      assertionId: assertionIdOf(phrase),
      assertion: phrase,
      evidence: [evidence('POSITIVE', 'CSRE_SEMANTIC_RESOLUTION', { assertion: phrase, strength: 0.95 })],
      prior: 0,
      previousBelief: null,
      now: NOW,
    });
    expect(promote(phrase, phraseOnce, null)).toBe('CANDIDATE'); // local term needs corroboration
    const weakened = fuse({
      assertionId,
      assertion,
      evidence: [evidence('POSITIVE', 'VENDOR_STATEMENT'), evidence('NEGATIVE', 'VENDOR_REJECTION')],
      prior: 0,
      previousBelief: null,
      now: NOW,
    });
    expect(promote(assertion, weakened, 'SUPPORTED')).toBe('WEAKENING');
  });

  it('maps relevance to graph operations: new → ADD, rise → REINFORCE, collapse → PRUNE, negative-only new → REJECT', () => {
    const fresh = fuse({
      assertionId,
      assertion,
      evidence: [evidence('POSITIVE', 'VENDOR_CONFIRMATION')],
      prior: 0,
      previousBelief: null,
      now: NOW,
    });
    expect(
      decideRelevance({
        assertionId,
        fusion: fresh,
        previousBelief: null,
        previousState: null,
        hadPriorDecision: false,
      }),
    ).toMatchObject({ decision: 'EXPAND', operation: 'ADD' });
    const more = fuse({
      assertionId,
      assertion,
      evidence: [evidence('POSITIVE', 'VENDOR_CONFIRMATION'), evidence('POSITIVE', 'FULFILLMENT_COMPLETED')],
      prior: 0,
      previousBelief: null,
      now: NOW,
    });
    expect(
      decideRelevance({
        assertionId,
        fusion: more,
        previousBelief: fresh.currentScore,
        previousState: 'SUPPORTED',
        hadPriorDecision: true,
      }),
    ).toMatchObject({ decision: 'REINFORCE', operation: 'REINFORCE' });
    const collapsed = fuse({
      assertionId,
      assertion,
      evidence: [
        evidence('POSITIVE', 'VENDOR_STATEMENT', { strength: 0.2 }),
        ...[1, 2, 3].map(() => evidence('NEGATIVE', 'VENDOR_REJECTION')),
      ],
      prior: 0,
      previousBelief: null,
      now: NOW,
    });
    expect(
      decideRelevance({
        assertionId,
        fusion: collapsed,
        previousBelief: 0.7,
        previousState: 'SUPPORTED',
        hadPriorDecision: true,
      }),
    ).toMatchObject({ decision: 'PRUNE', operation: 'PRUNE' });
    const negativeOnly = fuse({
      assertionId,
      assertion,
      evidence: [evidence('NEGATIVE', 'VENDOR_REJECTION')],
      prior: 0,
      previousBelief: null,
      now: NOW,
    });
    expect(
      decideRelevance({
        assertionId,
        fusion: negativeOnly,
        previousBelief: null,
        previousState: null,
        hadPriorDecision: false,
      }),
    ).toMatchObject({ decision: 'NO_CHANGE', operation: 'REJECT' });
    const same = decideRelevance({
      assertionId,
      fusion: more,
      previousBelief: more.currentScore,
      previousState: 'SUPPORTED',
      hadPriorDecision: true,
    });
    expect(same).toMatchObject({ decision: 'MAINTAIN', operation: null });
  });
});
