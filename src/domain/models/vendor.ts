import type { VendorDna } from './capability';

/**
 * The vendor profile assembled at the end of onboarding (Vendor-Onboarding.md Step 5).
 *
 * The vendor becomes searchable the moment this exists. Capability discovery then continues
 * for the vendor's lifetime — the profile is a starting point, not a finished record.
 */

export interface NormalizedLocation {
  readonly city: string;
  readonly state: string;
  readonly country: string;
  /**
   * Belief that the city→state mapping is right.
   *
   * Stored rather than discarded because the state is usually *inferred* from the city and
   * then confirmed; a profile that cannot distinguish "the vendor told us" from "we guessed
   * and they agreed" cannot be corrected safely later.
   */
  readonly confidence: number;
  /** Present when the vendor shared a pin rather than typing a place name. */
  readonly latitude?: number;
  readonly longitude?: number;
}

export const VENDOR_STATUSES = ['onboarding', 'active', 'suspended'] as const;

export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export interface Vendor {
  readonly id: string;
  /** The conversation identity — normalised E.164 phone number. */
  readonly userId: string;
  readonly conversationId: string;
  /** Registered name, informal shop name, trading name or personal brand — all accepted. */
  readonly businessName: string;
  readonly location: NormalizedLocation | null;
  readonly status: VendorStatus;
  /** Natural-language digest of the onboarding conversation. */
  readonly conversationSummary: string;
  readonly onboardedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A vendor together with the current state of its Capability DNA. */
export interface VendorProfile {
  readonly vendor: Vendor;
  readonly dna: VendorDna;
}

/**
 * Fields onboarding needs before a profile can be created.
 *
 * Used by the Information Before Questions check: the workflow asks only for what is still
 * missing, in whatever order the vendor happens to volunteer things
 * (MCOS Refinement #11, "Single-Turn Information Extraction").
 */
export interface OnboardingFields {
  readonly capabilityStatement: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly businessName: string | null;
}

export const EMPTY_ONBOARDING_FIELDS: OnboardingFields = {
  capabilityStatement: null,
  city: null,
  state: null,
  businessName: null,
};

/**
 * Confidence at or above which an extracted value is acted on rather than confirmed.
 *
 * Below it the workflow asks — the cost of one confirming question is far lower than the cost
 * of a profile that quietly records the wrong city.
 */
export const FIELD_ACCEPT_THRESHOLD = 0.75;

export function isComplete(fields: OnboardingFields): boolean {
  return (
    fields.capabilityStatement !== null &&
    fields.city !== null &&
    fields.state !== null &&
    fields.businessName !== null
  );
}

/** Fields still outstanding, in the order onboarding should pursue them. */
export function missingFields(fields: OnboardingFields): readonly (keyof OnboardingFields)[] {
  const order: (keyof OnboardingFields)[] = ['capabilityStatement', 'city', 'state', 'businessName'];
  return order.filter((field) => fields[field] === null);
}

/**
 * Merges newly extracted values without overwriting what is already known.
 *
 * First value wins: a later turn mentioning a different city is a correction, which is
 * handled explicitly by the workflow rather than silently by a merge.
 */
export function mergeFields(
  current: OnboardingFields,
  extracted: Partial<OnboardingFields>,
): OnboardingFields {
  return {
    capabilityStatement: current.capabilityStatement ?? extracted.capabilityStatement ?? null,
    city: current.city ?? extracted.city ?? null,
    state: current.state ?? extracted.state ?? null,
    businessName: current.businessName ?? extracted.businessName ?? null,
  };
}
