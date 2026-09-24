import type { ContinuityKind } from '../../src/orchestration/domain/continuity-decision';

/**
 * Fixtures for the chaos replay harness (MCOS TDR v4.4 §52 "Canonical Chaos Tests";
 * Conversation-Core-Comparison TDR §3, §7).
 *
 * Each turn carries an *oracle*: what a perfect understanding layer would return for it — the
 * IDCE intents, the CSRE objects and the continuity relation. That is the point of the harness:
 * by scripting the specialists to be right, any objective the platform still drops is an
 * orchestration failure rather than a prompt-quality one. A live-LLM run measures something
 * different and cannot distinguish the two.
 */

export interface ChaosObject {
  /** Exact span of the message (CSRE surface_form). */
  readonly surface: string;
  readonly canonical: string;
  readonly entityType: string;
  readonly brand?: string;
}

/** One objective inside a turn. A turn with two of these is a multi-intent utterance. */
export interface ChaosSegment {
  /** The part of the message this objective covers (IDCE source span). */
  readonly text: string;
  /** IDCE intent type (IDCE TDR v1.6 §4). */
  readonly intentType: string;
  /** What a perfect continuity analyser relates this objective to (MCOS §15). */
  readonly continuity: ContinuityKind;
  readonly objects: readonly ChaosObject[];
  readonly constraints?: readonly { readonly type: string; readonly value: string }[];
  /** Workflow type that must serve this objective. */
  readonly objective: string;
}

export interface ChaosTurn {
  readonly label: string;
  readonly text: string;
  readonly segments: readonly ChaosSegment[];
  /** Turn-level continuity (P2 `primary_relationship`). */
  readonly primaryContinuity: ContinuityKind;
  /** Fragments the composed reply must contain for the turn to count as served. */
  readonly replyMustContain: readonly string[];
  /** Oracle for the legacy `onboarding_extraction` service, when the turn touches onboarding. */
  readonly onboarding?: Readonly<Record<string, unknown>>;
}

export const VENDOR_ONBOARDING = 'VendorOnboarding';
export const BUYER_SEARCH = 'BuyerSearch';
export const PLATFORM_INFO = 'PlatformInfo';

/**
 * The canonical chaos transcript: onboarding, interrupted by a billing digression, then a turn
 * that both answers the parked question and opens a new objective (MCOS §40, §52 Scenario A).
 */
export const CHAOS_TRANSCRIPT: readonly ChaosTurn[] = [
  {
    label: 'inventory onboarding',
    text: 'I sell Toyota brake pads and shock absorbers',
    segments: [
      {
        // A list of items is one objective, not three: one SELL intent, two CSRE objects.
        text: 'I sell Toyota brake pads and shock absorbers',
        intentType: 'SELL',
        continuity: 'NO_WORKFLOW_CONTEXT',
        objects: [
          { surface: 'Toyota brake pads', canonical: 'brake pads', entityType: 'PRODUCT', brand: 'Toyota' },
          { surface: 'shock absorbers', canonical: 'shock absorbers', entityType: 'PRODUCT' },
        ],
        objective: VENDOR_ONBOARDING,
      },
    ],
    primaryContinuity: 'NO_WORKFLOW_CONTEXT',
    // The onboarding asks its next question (location); wording is the workflow's business.
    replyMustContain: [],
    onboarding: {
      capabilityStatement: 'Toyota brake pads and shock absorbers',
      capabilityConfidence: 0.95,
    },
  },
  {
    label: 'billing digression',
    text: 'Wait, how much do you charge per month to list items here?',
    segments: [
      {
        text: 'how much do you charge per month to list items here?',
        intentType: 'PLATFORM_INFORMATION',
        continuity: 'DIGRESSION',
        objects: [],
        objective: PLATFORM_INFO,
      },
    ],
    primaryContinuity: 'DIGRESSION',
    // The substance of the answer, not its phrasing: listing is free, credits are charged per
    // reveal. A reply that cannot say this has not served the turn.
    replyMustContain: ['free'],
  },
  {
    label: 'multi-intent: answer plus new search',
    text: 'Yes, KYB. Also who sells engine oil near Alaba?',
    // Genuinely both a continuation and a new objective (MCOS §40). Two intents, two actions.
    segments: [
      {
        text: 'Yes, KYB',
        intentType: 'CONTINUE_VENDOR_ONBOARDING',
        continuity: 'CONTINUATION',
        objects: [{ surface: 'KYB', canonical: 'KYB shock absorbers', entityType: 'BRAND', brand: 'KYB' }],
        objective: VENDOR_ONBOARDING,
      },
      {
        text: 'who sells engine oil near Alaba?',
        intentType: 'FIND_VENDOR',
        continuity: 'NEW_WORKFLOW',
        objects: [{ surface: 'engine oil', canonical: 'engine oil', entityType: 'PRODUCT' }],
        constraints: [{ type: 'LOCATION', value: 'Alaba' }],
        objective: BUYER_SEARCH,
      },
    ],
    primaryContinuity: 'MULTI_WORKFLOW',
    // Only the search half is asserted on wording: the onboarding half is *recorded* (KYB joins
    // the capability statement) while the workflow re-asks its pending location question.
    replyMustContain: ['engine oil'],
    onboarding: {
      capabilityStatement: 'Toyota brake pads and shock absorbers, KYB shock absorbers',
      isConfirmation: true,
      confirmationValue: 'yes',
    },
  },
];

/** Every objective the transcript expects, in the order it first becomes due. */
export function expectedObjectives(transcript: readonly ChaosTurn[]): readonly string[] {
  return [...new Set(transcript.flatMap((turn) => turn.segments.map((segment) => segment.objective)))];
}
