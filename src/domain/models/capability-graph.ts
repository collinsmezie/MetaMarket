import type { CapabilityRef, CapabilitySignal } from './capability';

/**
 * Confidence propagation through the capability hierarchy (CDE "Capability Hierarchy").
 *
 * Mentioning "MCCB" should raise confidence for MCCB, Circuit Protection, Power Distribution
 * and Electrical — each less than the last. Without propagation, a vendor who names ten
 * specific products would still look like a stranger to any query phrased one level up, which
 * is how most buyers actually search.
 */

/**
 * Attenuation per level climbed.
 *
 * A parent is strongly implied by its child — naming an MCCB really does mean the vendor
 * deals in circuit protection — so this stays high. Compounding over four GPC levels still
 * leaves a meaningful segment-level signal.
 */
const PARENT_ATTENUATION = 0.75;

/**
 * Attenuation for siblings, applied once and not compounded.
 *
 * Stocking MCCBs makes MCBs plausible, because shops carry ranges rather than single items
 * (CDE Principle 12 — people describe businesses through prototypes). But it is a much weaker
 * inference than the parent relationship, and it must never be strong enough to make a
 * sibling look directly observed.
 */
const SIBLING_ATTENUATION = 0.25;

/** Below this a propagated signal is not worth storing. */
const MIN_PROPAGATED_STRENGTH = 0.05;

/** An ancestor chain for a capability, nearest parent first. */
export interface CapabilityAncestry {
  readonly capability: CapabilityRef;
  readonly ancestors: readonly CapabilityRef[];
  /** Optional sibling set, used for the weaker lateral inference. */
  readonly siblings?: readonly CapabilityRef[];
}

/**
 * Expands directly observed signals into the ancestor (and optionally sibling) signals they
 * imply.
 *
 * Negative evidence deliberately does **not** propagate upward: a vendor rejecting a request
 * for MCCBs says nothing against Electrical as a whole, and propagating it would let one
 * "no" erode a capability the vendor genuinely has. It does propagate to siblings, because
 * "I don't sell TVs" is weak evidence against the rest of consumer electronics.
 */
export function propagate(
  signals: readonly CapabilitySignal[],
  ancestryOf: (capability: CapabilityRef) => CapabilityAncestry | undefined,
): readonly CapabilitySignal[] {
  const strongest = new Map<string, CapabilitySignal>();

  const record = (signal: CapabilitySignal): void => {
    if (signal.strength < MIN_PROPAGATED_STRENGTH) return;

    const key = `${signal.capability.domain}:${signal.capability.id}:${signal.positive}`;
    const existing = strongest.get(key);

    // Keep the strongest claim per capability: two paths to the same ancestor are one piece
    // of evidence about it, not two, and summing them would double-count.
    if (existing === undefined || signal.strength > existing.strength) {
      strongest.set(key, signal);
    }
  };

  for (const signal of signals) {
    record(signal);

    const ancestry = ancestryOf(signal.capability);
    if (ancestry === undefined) continue;

    if (signal.positive) {
      let strength = signal.strength;

      for (const ancestor of ancestry.ancestors) {
        strength *= PARENT_ATTENUATION;
        if (strength < MIN_PROPAGATED_STRENGTH) break;
        record({ capability: ancestor, strength, positive: true });
      }
    }

    for (const sibling of ancestry.siblings ?? []) {
      record({
        capability: sibling,
        strength: signal.strength * SIBLING_ATTENUATION,
        positive: signal.positive,
      });
    }
  }

  return [...strongest.values()];
}
