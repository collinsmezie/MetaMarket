import type { CapabilityRef, EvidenceObject, EvidenceSource, InformationDensity } from './capability';
import {
  capabilityEntropy,
  decayFactor,
  deriveBeliefs,
  PRIOR_CONFIDENCE,
  signalLogOdds,
  toLogOdds,
  toProbability,
} from './capability';

/**
 * These specs pin the behaviour the CDE's design promises: nothing is ever certain, evidence
 * accumulates rather than overwrites, marketplace behaviour outranks self-description, and
 * the same evidence always produces the same DNA.
 */

const NOW = new Date('2026-08-06T10:00:00.000Z');

const electrical: CapabilityRef = { domain: 'product', id: '10005541', name: 'Electrical Wires' };
const lighting: CapabilityRef = { domain: 'product', id: '10005542', name: 'Lighting' };

let sequence = 0;

function evidence(params: {
  source: EvidenceSource;
  density: InformationDensity;
  capability?: CapabilityRef;
  strength: number;
  positive?: boolean;
  observedAt?: Date;
}): EvidenceObject {
  sequence += 1;
  return {
    id: `ev_${sequence}`,
    vendorId: 'vendor_1',
    source: params.source,
    observedAt: params.observedAt ?? NOW,
    originalText: 'test',
    normalizedMeaning: 'test',
    informationDensity: params.density,
    reasoning: 'test',
    supports: [
      {
        capability: params.capability ?? electrical,
        strength: params.strength,
        positive: params.positive ?? true,
      },
    ],
  };
}

describe('log-odds conversion', () => {
  it('round-trips a probability', () => {
    for (const p of [0.02, 0.25, 0.5, 0.8, 0.99]) {
      expect(toProbability(toLogOdds(p))).toBeCloseTo(p, 6);
    }
  });

  it('clamps the extremes instead of producing infinities', () => {
    expect(Number.isFinite(toLogOdds(0))).toBe(true);
    expect(Number.isFinite(toLogOdds(1))).toBe(true);
  });
});

describe('signal weighting', () => {
  it('weights a named product above a vague statement', () => {
    const named = signalLogOdds(
      { capability: electrical, strength: 0.95, positive: true },
      'onboarding_statement',
      'very_high',
    );
    const vague = signalLogOdds(
      { capability: electrical, strength: 0.3, positive: true },
      'onboarding_statement',
      'very_low',
    );

    expect(named).toBeGreaterThan(vague * 4);
  });

  it('weights marketplace behaviour above the vendor describing themselves', () => {
    const signal = { capability: electrical, strength: 0.9, positive: true };

    // CME §12: "Marketplace evidence always overrides AI assumptions."
    expect(signalLogOdds(signal, 'request_accepted', 'high')).toBeGreaterThan(
      signalLogOdds(signal, 'onboarding_statement', 'high'),
    );
  });

  it('weights an LLM expansion lowest of all sources', () => {
    const signal = { capability: electrical, strength: 0.9, positive: true };
    const inference = signalLogOdds(signal, 'llm_inference', 'high');

    for (const source of ['onboarding_statement', 'request_accepted', 'vendor_correction'] as const) {
      expect(signalLogOdds(signal, source, 'high')).toBeGreaterThan(inference);
    }
  });

  it('produces negative weight for evidence against a capability', () => {
    expect(
      signalLogOdds({ capability: electrical, strength: 0.9, positive: false }, 'request_rejected', 'high'),
    ).toBeLessThan(0);
  });

  it('caps a single signal so one statement cannot assert certainty', () => {
    const enormous = signalLogOdds(
      { capability: electrical, strength: 1, positive: true },
      'vendor_correction',
      'very_high',
    );

    // A cap below ~2.2 keeps one observation under ~0.9 confidence on its own.
    expect(toProbability(toLogOdds(PRIOR_CONFIDENCE) + enormous)).toBeLessThan(0.92);
  });
});

describe('time decay', () => {
  it('does not attenuate fresh evidence', () => {
    expect(decayFactor(NOW, NOW)).toBeCloseTo(1, 6);
  });

  it('halves influence after the half-life', () => {
    const aYearAgo = new Date(NOW.getTime() - 365 * 86_400_000);
    expect(decayFactor(aYearAgo, NOW)).toBeCloseTo(0.5, 2);
  });

  it('never lets old evidence become worthless', () => {
    const longAgo = new Date(NOW.getTime() - 20 * 365 * 86_400_000);
    expect(decayFactor(longAgo, NOW)).toBeGreaterThanOrEqual(0.25);
  });
});

describe('calibration', () => {
  /**
   * These are the numbers the whole engine is judged on. If a vendor plainly states what they
   * sell and the resulting confidence is too low to match on, the marketplace does not work —
   * and that was a real defect caught by the onboarding integration test.
   */

  it('puts a plainly stated capability in a matchable range', () => {
    const [belief] = deriveBeliefs(
      [evidence({ source: 'onboarding_statement', density: 'medium', strength: 0.9 })],
      NOW,
    );

    expect(belief.confidence).toBeGreaterThan(0.55);
    expect(belief.confidence).toBeLessThan(0.85);
  });

  it('puts a detailed product list high', () => {
    const [belief] = deriveBeliefs(
      [evidence({ source: 'onboarding_statement', density: 'very_high', strength: 0.95 })],
      NOW,
    );

    expect(belief.confidence).toBeGreaterThan(0.8);
  });

  it('keeps a weak lateral inference clearly below a stated capability', () => {
    const [sibling] = deriveBeliefs(
      [evidence({ source: 'llm_inference', density: 'medium', strength: 0.22 })],
      NOW,
    );

    expect(sibling.confidence).toBeLessThan(0.35);
  });

  it('returns a rejected capability to roughly its prior after one acceptance', () => {
    const beliefs = deriveBeliefs(
      [
        evidence({ source: 'request_accepted', density: 'high', strength: 0.95 }),
        evidence({ source: 'request_rejected', density: 'high', strength: 0.95, positive: false }),
      ],
      NOW,
    );

    // The two cancel: the engine is back to knowing nothing much, which is the honest answer.
    expect(beliefs[0].confidence).toBeGreaterThan(0.05);
    expect(beliefs[0].confidence).toBeLessThan(0.3);
  });
});

describe('deriveBeliefs', () => {
  it('starts an unobserved capability from a low but non-zero prior', () => {
    const [belief] = deriveBeliefs(
      [evidence({ source: 'llm_inference', density: 'very_low', strength: 0.1 })],
      NOW,
    );

    expect(belief.confidence).toBeGreaterThan(0);
    expect(belief.confidence).toBeLessThan(0.2);
  });

  it('accumulates repeated confirmations rather than replacing belief', () => {
    const once = deriveBeliefs(
      [evidence({ source: 'request_accepted', density: 'high', strength: 0.9 })],
      NOW,
    );
    const thrice = deriveBeliefs(
      [
        evidence({ source: 'request_accepted', density: 'high', strength: 0.9 }),
        evidence({ source: 'request_accepted', density: 'high', strength: 0.9 }),
        evidence({ source: 'request_accepted', density: 'high', strength: 0.9 }),
      ],
      NOW,
    );

    expect(thrice[0].confidence).toBeGreaterThan(once[0].confidence);
    expect(thrice[0].evidenceCount).toBe(3);
  });

  it('lets contradicting evidence pull confidence back down', () => {
    const confirmed = deriveBeliefs(
      [evidence({ source: 'request_accepted', density: 'high', strength: 0.9 })],
      NOW,
    );

    const contradicted = deriveBeliefs(
      [
        evidence({ source: 'request_accepted', density: 'high', strength: 0.9 }),
        evidence({ source: 'vendor_correction', density: 'high', strength: 0.9, positive: false }),
      ],
      NOW,
    );

    // A vendor saying "no, I don't sell that" outweighs one prior acceptance.
    expect(contradicted[0].confidence).toBeLessThan(confirmed[0].confidence);
    expect(contradicted[0].confidence).toBeLessThan(0.5);
  });

  it('distinguishes "probably not" from "unknown"', () => {
    // CDE Principle 17: most systems collapse these, producing brittle profiles.
    const rejected = deriveBeliefs(
      [evidence({ source: 'request_rejected', density: 'high', strength: 0.9, positive: false })],
      NOW,
    );

    expect(rejected[0].confidence).toBeLessThan(PRIOR_CONFIDENCE);
  });

  it('marks a capability inferred until something directly observes it', () => {
    const expanded = deriveBeliefs(
      [evidence({ source: 'llm_inference', density: 'medium', strength: 0.4 })],
      NOW,
    );
    expect(expanded[0].inferred).toBe(true);

    const observed = deriveBeliefs(
      [
        evidence({ source: 'llm_inference', density: 'medium', strength: 0.4 }),
        evidence({ source: 'inventory_update', density: 'very_high', strength: 0.95 }),
      ],
      NOW,
    );
    expect(observed[0].inferred).toBe(false);
  });

  it('weights recent evidence above stale evidence of the same kind', () => {
    const twoYearsAgo = new Date(NOW.getTime() - 2 * 365 * 86_400_000);

    const beliefs = deriveBeliefs(
      [
        evidence({
          source: 'request_accepted',
          density: 'high',
          strength: 0.9,
          capability: electrical,
          observedAt: twoYearsAgo,
        }),
        evidence({ source: 'request_accepted', density: 'high', strength: 0.9, capability: lighting }),
      ],
      NOW,
    );

    const wires = beliefs.find((belief) => belief.capability.id === electrical.id);
    const light = beliefs.find((belief) => belief.capability.id === lighting.id);

    expect(light?.confidence).toBeGreaterThan(wires?.confidence ?? 1);
  });

  it('returns beliefs ordered by confidence', () => {
    const beliefs = deriveBeliefs(
      [
        evidence({ source: 'llm_inference', density: 'low', strength: 0.2, capability: lighting }),
        evidence({ source: 'match_completed', density: 'very_high', strength: 0.95, capability: electrical }),
      ],
      NOW,
    );

    expect(beliefs[0].capability.id).toBe(electrical.id);
  });

  it('is deterministic — the same evidence always yields the same DNA', () => {
    const history = [
      evidence({ source: 'onboarding_statement', density: 'medium', strength: 0.6 }),
      evidence({ source: 'request_accepted', density: 'high', strength: 0.9, capability: lighting }),
    ];

    expect(deriveBeliefs(history, NOW)).toEqual(deriveBeliefs(history, NOW));
  });
});

describe('capabilityEntropy', () => {
  it('peaks where the engine genuinely does not know', () => {
    expect(capabilityEntropy(0.5)).toBeCloseTo(1, 6);
  });

  it('approaches zero at either extreme', () => {
    expect(capabilityEntropy(0.01)).toBeLessThan(0.1);
    expect(capabilityEntropy(0.99)).toBeLessThan(0.1);
  });

  it('ranks a coin-flip belief above a near-certain one', () => {
    // This ordering is what points the Curiosity Engine at the useful question.
    expect(capabilityEntropy(0.45)).toBeGreaterThan(capabilityEntropy(0.9));
  });
});
