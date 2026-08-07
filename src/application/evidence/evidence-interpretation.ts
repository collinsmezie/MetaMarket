import type { EvidenceSignal, EvidenceSubjectType } from '../../domain/models/evidence';
import type { StoredMarketplaceEvent } from '../../domain/ports/outbound/evidence-repository.port';

/**
 * Translation from marketplace events to evidence signals
 * (Evidence Service, "Evidence Processor").
 *
 * Kept as a pure function table rather than scattered across handlers so the full mapping —
 * every event type the marketplace can emit and exactly what it implies — is readable in one
 * place. Adding a new producer means adding a row here, which is the extensibility the TDR asks
 * for: "New evidence producers can be added without changing the Evidence Service."
 */

export interface InterpretedSignal {
  readonly signal: EvidenceSignal;
  readonly polarity: 1 | -1;
  /**
   * How much this signal counts relative to others of its kind.
   *
   * Used sparingly. The dimension weights in the scoring model do most of the work; this exists
   * for cases where two events map to the same signal but differ in how much they prove.
   */
  readonly weight: number;
}

/**
 * What each event type implies.
 *
 * `request.delivered` is the denominator for responsiveness — without recording deliveries,
 * a vendor who ignores everything would simply have no evidence rather than bad evidence.
 */
const EVENT_SIGNALS: Readonly<Record<string, readonly InterpretedSignal[]>> = {
  'request.delivered': [{ signal: 'delivered', polarity: 1, weight: 1 }],

  // Accepting proves both that they engage and that they have the item.
  'request.accepted': [
    { signal: 'responded', polarity: 1, weight: 1 },
    { signal: 'accepted', polarity: 1, weight: 1 },
  ],

  // Rejecting is a *positive* signal about responsiveness — they bothered to answer — and a
  // negative one about stock. Collapsing the two would punish honest vendors for replying.
  'request.rejected': [
    { signal: 'responded', polarity: 1, weight: 1 },
    { signal: 'rejected', polarity: -1, weight: 1 },
  ],

  // Being asked is not behaviour, so it carries no counter. It is registered rather than left
  // unknown because it is what makes a later `request.timeout` interpretable: the vendor was
  // reachable, was asked, and said nothing.
  'vendor.notified': [],

  'request.timeout': [{ signal: 'no_response', polarity: -1, weight: 1 }],
  'request.expired': [{ signal: 'no_response', polarity: -1, weight: 1 }],

  'vendor.responded': [{ signal: 'responded', polarity: 1, weight: 1 }],
  'vendor.selected': [{ signal: 'selected', polarity: 1, weight: 1 }],
  'vendor.declined': [
    { signal: 'responded', polarity: 1, weight: 1 },
    { signal: 'rejected', polarity: -1, weight: 1 },
  ],
  'vendor.confirmed_inventory': [{ signal: 'accepted', polarity: 1, weight: 1 }],

  'match.completed': [{ signal: 'completed', polarity: 1, weight: 1 }],
  'match.cancelled': [{ signal: 'cancelled', polarity: -1, weight: 1 }],

  'customer.rating': [{ signal: 'rated', polarity: 1, weight: 1 }],

  // Onboarding is evidence a vendor exists and claims a capability, but it is not marketplace
  // behaviour, so it contributes no behavioural counter. The CDE already holds what they said.
  'seller.onboarded': [],
  'seller.capability.confirmed': [{ signal: 'accepted', polarity: 1, weight: 0.5 }],
  'seller.inventory.updated': [{ signal: 'accepted', polarity: 1, weight: 0.5 }],
};

export function signalsFor(eventType: string): readonly InterpretedSignal[] {
  return EVENT_SIGNALS[eventType] ?? [];
}

/** True when the Evidence Service has an interpretation for this event type. */
export function isEvidenceBearing(eventType: string): boolean {
  return (EVENT_SIGNALS[eventType]?.length ?? 0) > 0;
}

/** Every event type the service understands, for diagnostics and health reporting. */
export function knownEventTypes(): readonly string[] {
  return Object.keys(EVENT_SIGNALS);
}

/**
 * The subjects one event speaks about.
 *
 * An event is recorded against every level it informs: the specific product, the canonical
 * capability, and the vendor overall. Ranking needs all three — a buyer asking for a hammer
 * cares most about hammer-specific evidence, but falls back to the vendor's general
 * reliability when there is none.
 */
export function subjectsFor(
  event: StoredMarketplaceEvent,
): readonly { subjectType: EvidenceSubjectType; subject: string }[] {
  const subjects: { subjectType: EvidenceSubjectType; subject: string }[] = [
    // Always recorded: overall behaviour is what a cold-start vendor is judged on.
    { subjectType: 'vendor', subject: '' },
  ];

  if (event.capability !== null) {
    subjects.push({ subjectType: 'capability', subject: event.capability });
  }

  if (event.product !== null) {
    // Normalised so "Hammer" and "hammer" accumulate together.
    subjects.push({ subjectType: 'product', subject: event.product.toLowerCase() });
  }

  return subjects;
}

/** Response latency carried by the event, when present. */
export function responseTimeOf(event: StoredMarketplaceEvent): number | undefined {
  const raw = event.metadata.responseTime ?? event.metadata.responseTimeMs;

  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return undefined;

  // The Standard Marketplace Event Model expresses `responseTime` in seconds; `responseTimeMs`
  // is explicit. Distinguishing them avoids recording a 3-minute reply as 3 milliseconds.
  return event.metadata.responseTimeMs !== undefined ? raw : raw * 1000;
}

/** Customer rating carried by the event, clamped to the 1-5 scale. */
export function ratingOf(event: StoredMarketplaceEvent): number | undefined {
  const raw = event.metadata.rating;

  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;

  return Math.min(5, Math.max(1, Math.round(raw)));
}
