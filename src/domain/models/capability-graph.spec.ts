import type { CapabilityRef, CapabilitySignal } from './capability';
import { propagate, type CapabilityAncestry } from './capability-graph';

/**
 * Propagation is what makes "I stock MCCBs" findable by a buyer who searches "electrical".
 * These specs pin both that it happens and that it stays bounded.
 */

const mccb: CapabilityRef = { domain: 'product', id: '1001', name: 'MCCB' };
const circuitProtection: CapabilityRef = { domain: 'product', id: '1002', name: 'Circuit Protection' };
const powerDistribution: CapabilityRef = { domain: 'product', id: '1003', name: 'Power Distribution' };
const electrical: CapabilityRef = { domain: 'product', id: '1004', name: 'Electrical' };
const mcb: CapabilityRef = { domain: 'product', id: '1005', name: 'MCB' };

const ancestry: CapabilityAncestry = {
  capability: mccb,
  // Nearest parent first.
  ancestors: [circuitProtection, powerDistribution, electrical],
  siblings: [mcb],
};

const ancestryOf = (capability: CapabilityRef) => (capability.id === mccb.id ? ancestry : undefined);

const confidenceOf = (signals: readonly CapabilitySignal[], id: string) =>
  signals.find((signal) => signal.capability.id === id)?.strength;

describe('propagate', () => {
  const direct: CapabilitySignal = { capability: mccb, strength: 0.9, positive: true };

  it('raises confidence for every ancestor of an observed capability', () => {
    const propagated = propagate([direct], ancestryOf);

    for (const ancestor of [circuitProtection, powerDistribution, electrical]) {
      expect(confidenceOf(propagated, ancestor.id)).toBeGreaterThan(0);
    }
  });

  it('attenuates with each level climbed', () => {
    const propagated = propagate([direct], ancestryOf);

    const parent = confidenceOf(propagated, circuitProtection.id) ?? 0;
    const grandparent = confidenceOf(propagated, powerDistribution.id) ?? 0;
    const greatGrandparent = confidenceOf(propagated, electrical.id) ?? 0;

    expect(parent).toBeLessThan(direct.strength);
    expect(grandparent).toBeLessThan(parent);
    expect(greatGrandparent).toBeLessThan(grandparent);
  });

  it('keeps the observed capability at full strength', () => {
    expect(confidenceOf(propagate([direct], ancestryOf), mccb.id)).toBe(0.9);
  });

  it('never lets a propagated ancestor look directly observed', () => {
    const propagated = propagate([direct], ancestryOf);

    // 0.8 is the threshold at which the belief model treats a signal as direct observation.
    for (const ancestor of [circuitProtection, powerDistribution, electrical]) {
      expect(confidenceOf(propagated, ancestor.id)).toBeLessThan(0.8);
    }
  });

  it('infers siblings weakly, because shops carry ranges', () => {
    const propagated = propagate([direct], ancestryOf);

    const sibling = confidenceOf(propagated, mcb.id) ?? 0;
    expect(sibling).toBeGreaterThan(0);
    expect(sibling).toBeLessThan(confidenceOf(propagated, circuitProtection.id) ?? 1);
  });

  it('does not propagate negative evidence upward', () => {
    // Rejecting one MCCB request says nothing against Electrical as a whole; propagating it
    // would let a single "no" erode a capability the vendor genuinely has.
    const negative: CapabilitySignal = { capability: mccb, strength: 0.9, positive: false };
    const propagated = propagate([negative], ancestryOf);

    expect(propagated.some((signal) => signal.capability.id === electrical.id)).toBe(false);
    expect(confidenceOf(propagated, mccb.id)).toBe(0.9);
  });

  it('does propagate negative evidence to siblings', () => {
    const negative: CapabilitySignal = { capability: mccb, strength: 0.9, positive: false };
    const propagated = propagate([negative], ancestryOf);

    const sibling = propagated.find((signal) => signal.capability.id === mcb.id);
    expect(sibling?.positive).toBe(false);
  });

  it('counts one ancestor once when two children imply it', () => {
    // Two paths to the same ancestor are one piece of evidence about it, not two.
    const second: CapabilitySignal = { capability: mcb, strength: 0.7, positive: true };
    const bothAncestry = (capability: CapabilityRef) =>
      capability.id === mccb.id || capability.id === mcb.id
        ? { capability, ancestors: [circuitProtection], siblings: [] }
        : undefined;

    const propagated = propagate([direct, second], bothAncestry);

    const matches = propagated.filter((signal) => signal.capability.id === circuitProtection.id);
    expect(matches).toHaveLength(1);
    // The stronger claim wins.
    expect(matches[0].strength).toBeCloseTo(0.9 * 0.75, 5);
  });

  it('drops propagated signals too weak to be worth storing', () => {
    const faint: CapabilitySignal = { capability: mccb, strength: 0.08, positive: true };
    const propagated = propagate([faint], ancestryOf);

    expect(propagated.some((signal) => signal.capability.id === electrical.id)).toBe(false);
  });

  it('passes through capabilities that have no known ancestry', () => {
    const service: CapabilitySignal = {
      capability: { domain: 'service', id: 'svc_generator_repair', name: 'Generator Repair' },
      strength: 0.9,
      positive: true,
    };

    expect(propagate([service], () => undefined)).toEqual([service]);
  });
});
