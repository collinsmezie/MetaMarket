import type { ConversationRelationshipKind } from '../../src/domain/models/understanding';

/**
 * Fixtures for the chaos replay harness (Conversation-Core-Comparison TDR §3, §7).
 *
 * Each turn carries an *oracle*: what a perfect understanding layer would return for it. That
 * is the point of the harness — by scripting the LLM to be right, any objective the platform
 * still drops is an architectural failure rather than a prompt-quality one. A live-LLM run
 * measures something different and cannot distinguish the two.
 *
 * Both branches of the comparison replay these same fixtures, so a difference in the scorecard
 * is a difference in the conversation core and nothing else.
 */

/** One objective inside a turn. A turn with two of these is a multi-intent utterance. */
export interface ChaosSegment {
  /** The part of the message this segment covers, as a correct segmenter would split it. */
  readonly text: string;
  readonly intent: string;
  /** What a perfect continuity analyzer would classify *this segment* as. */
  readonly relationship: ConversationRelationshipKind;
  readonly entities: Readonly<Record<string, string>>;
  /** Workflow type that must serve this segment. */
  readonly objective: string;
}

export interface ChaosTurn {
  readonly label: string;
  readonly text: string;
  readonly segments: readonly ChaosSegment[];
  /** Fragments the composed reply must contain for the turn to count as served. */
  readonly replyMustContain: readonly string[];
  /** Oracle for `onboarding_extraction`, when the turn touches vendor onboarding. */
  readonly onboarding?: Readonly<Record<string, unknown>>;
}

export const VENDOR_ONBOARDING = 'VendorOnboarding';
export const BUYER_SEARCH = 'BuyerSearch';
/**
 * The workflow that answers "what does this cost" — not registered on either branch yet, which
 * is why turn 2 currently fails. Named here so the gap is a missing implementation rather than
 * a missing requirement.
 */
export const PLATFORM_INFO = 'PlatformInfo';

/**
 * The canonical chaos transcript: onboarding, interrupted by a billing digression, then a turn
 * that both answers the parked question and opens a new objective.
 */
export const CHAOS_TRANSCRIPT: readonly ChaosTurn[] = [
  {
    label: 'inventory onboarding',
    text: 'I sell Toyota brake pads and shock absorbers',
    segments: [
      {
        // A list of items is one request, not three. A segmenter that splits here would open
        // three onboardings for one shop.
        text: 'I sell Toyota brake pads and shock absorbers',
        intent: 'vendor_onboarding',
        relationship: 'new',
        entities: { capability: 'Toyota brake pads and shock absorbers' },
        objective: VENDOR_ONBOARDING,
      },
    ],
    // The implemented workflow asks for location next rather than for the shock-absorber
    // brand the illustrative scenario used. Either is a valid next question, so this turn
    // asserts nothing about wording.
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
        intent: 'platform_faq',
        relationship: 'topic_shift',
        entities: {},
        objective: PLATFORM_INFO,
      },
    ],
    // The substance of the answer, not its phrasing: listing is free, credits are charged per
    // order. A reply that cannot say this has not served the turn.
    replyMustContain: ['free'],
  },
  {
    label: 'multi-intent: answer plus new search',
    text: 'Yes, KYB. Also who sells engine oil near Alaba?',
    // Genuinely both a continuation and a new objective. A single relationship label for the
    // whole message cannot express that, which is why the split has to come first.
    segments: [
      {
        text: 'Yes, KYB',
        intent: 'vendor_onboarding',
        relationship: 'continuation',
        entities: { brand: 'KYB' },
        objective: VENDOR_ONBOARDING,
      },
      {
        text: 'who sells engine oil near Alaba?',
        intent: 'buyer_product_search',
        relationship: 'topic_shift',
        entities: { product: 'engine oil', location: 'Alaba' },
        objective: BUYER_SEARCH,
      },
    ],
    // Only the search half is asserted. The onboarding half is *recorded* — the extraction adds
    // KYB to the capability statement — but the pending question is location, so the workflow
    // re-asks that rather than echoing the brand back. Acknowledging an answer before moving on
    // is worth improving in the onboarding copy; it is not a routing failure.
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
