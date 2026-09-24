/**
 * CSRE canonical model (CSRE TDR v5.4 §15, §25.3, §27, §29, §31.1).
 *
 * Wire format is snake_case JSON validated against `csre-resolution-v5.json` (response 5.0) and
 * `csre-service-request-v5.1.json`. Internal types are camelCase except for two deliberately
 * wire-shaped fields: `semanticOrigin` (the MCOS TDR stores it verbatim, §37/§63.1) and
 * `attributes` (user data; its keys are never re-cased).
 */

export const CSRE_RESOLUTION_STATUSES = [
  'RESOLVED',
  'AMBIGUOUS',
  'UNRESOLVED',
  'COMPOSITE',
  'NON_REFERENTIAL',
] as const;
export type CsreResolutionStatus = (typeof CSRE_RESOLUTION_STATUSES)[number];

/** Referent vocabulary (§15). */
export const CSRE_ENTITY_TYPES = [
  'PRODUCT',
  'PRODUCT_CATEGORY',
  'PRODUCT_SUBCATEGORY',
  'SERVICE',
  'BRAND',
  'MODEL',
  'BOOK',
  'MOVIE',
  'PLACE',
  'MATERIAL',
  'EQUIPMENT',
  'TOOL',
  'MACHINE',
  'FOOD',
  'MEDICINE',
  'VEHICLE',
  'SOFTWARE',
  'PERSON',
  'ORGANIZATION',
  'ACTIVITY',
  'CAPABILITY',
  'CONCEPT',
  'OTHER',
] as const;
export type CsreEntityType = (typeof CSRE_ENTITY_TYPES)[number];

export const COMMERCIAL_RELEVANCE = [
  'DIRECT_PRODUCT',
  'DIRECT_SERVICE',
  'COMMERCIAL_CATEGORY',
  'COMMERCIAL_MATERIAL',
  'COMMERCIAL_RESOURCE',
  'COMMERCIAL_CAPABILITY',
  'COMMERCIAL_ENTITY',
  'NON_COMMERCIAL',
  'UNKNOWN',
] as const;
export type CommercialRelevance = (typeof COMMERCIAL_RELEVANCE)[number];

/** Inter-object relation vocabulary (§11). */
export const OBJECT_RELATIONSHIP_TYPES = [
  'used_for',
  'accessory_of',
  'applies_to',
  'part_of',
  'sold_at',
  'located_at',
  'associated_with',
] as const;

export interface SemanticOrigin {
  readonly phrase: string;
  readonly concept: string;
  readonly market_concept_id: string | null;
  readonly concept_status: 'KNOWN' | 'PROPOSED';
  readonly relationship: 'EXPRESSES';
  readonly origin: 'CSRE';
  readonly request_id: string;
  readonly semantic_confidence: number;
}

export interface CommercialInterpretation {
  readonly relevance: CommercialRelevance;
  readonly commercialOffering: boolean;
  readonly reason: string;
  readonly confidence: number;
}

export interface SemanticCandidate {
  readonly meaning: string;
  readonly entityType: string;
  readonly definition: string;
  readonly plausibility: number;
}

export interface ObjectRelationship {
  readonly type: string;
  readonly objects: readonly string[];
  readonly context: string | null;
}

export type AttributeValue = string | number | boolean | null;

export interface SemanticObject {
  readonly objectId: string;
  readonly semanticOrigin: SemanticOrigin;
  readonly surfaceForm: string;
  readonly canonicalForm: string;
  readonly entityType: CsreEntityType;
  readonly definition: string;
  readonly brand: string | null;
  readonly model: string | null;
  readonly attributes: Readonly<Record<string, AttributeValue>>;
  readonly aliases: readonly string[];
  readonly commercialInterpretation: CommercialInterpretation;
  readonly confidence: { readonly semanticResolution: number; readonly commercialRelevance: number };
  readonly ambiguity: {
    readonly present: boolean;
    readonly remainingCandidates: readonly SemanticCandidate[];
  };
  readonly functionalContext: readonly string[];
  readonly relationships: readonly ObjectRelationship[];
}

export interface VenueReference {
  readonly expression: string;
  readonly canonicalVenue: string;
  readonly venueType: string;
}

export interface ResolutionContext {
  readonly venues: readonly VenueReference[];
  readonly regionalContext: {
    readonly country: string;
    readonly region: string | null;
    readonly regionalTerms: readonly string[];
    readonly regionalInterpretationUsed: boolean;
  };
  readonly functionalContext: readonly string[];
  readonly locationContext: {
    readonly expression: string;
    readonly normalized: string | null;
    readonly confidence: number;
  } | null;
  readonly qualifiers: readonly string[];
}

export interface EvidenceReference {
  readonly evidenceId: string;
  readonly source: string;
  readonly claim: string;
}

export interface CSREResolution {
  readonly schemaVersion: '5.0';
  readonly requestId: string;
  readonly resolutionStatus: CsreResolutionStatus;
  readonly originalMessage: string;
  readonly objects: readonly SemanticObject[];
  readonly context: ResolutionContext;
  readonly clarification: { readonly required: boolean; readonly question: string | null };
  readonly evidence: readonly EvidenceReference[];
}

// ── Service request (§29.1, §31.2) ────────────────────────────────────────────────────────────

export interface CsreCurrentMessage {
  readonly messageId: string;
  readonly text: string;
  readonly receivedAt: string;
  readonly interactivePayload: string | null;
}

/**
 * The context blocks are free-form JSON the adapter assembles (§31.2) and the runtime prompt
 * renders as labelled DATA sections (§7). Their keys stay snake_case end to end: they are
 * presented to the model, not consumed by code.
 */
export interface CSREServiceRequest {
  readonly schemaVersion: '5.1';
  readonly requestId: string;
  readonly component: 'CSRE';
  readonly componentVersion: string;
  readonly conversationId: string;
  readonly turnId: string;
  /** Orchestration correlation (§29.3 rule 2); not part of the wire request. */
  readonly runId: string;
  readonly contextSnapshotId: string;
  /** The assembled logical-turn text (§29.2). */
  readonly message: string;
  readonly currentMessages: readonly CsreCurrentMessage[];
  readonly conversationContext: Readonly<Record<string, unknown>>;
  readonly regionalContext: Readonly<Record<string, unknown>>;
  readonly commercialContext: Readonly<Record<string, unknown>>;
  readonly lexiconEvidence: readonly Readonly<Record<string, unknown>>[];
  readonly externalEvidence: readonly Readonly<Record<string, unknown>>[];
  readonly clarificationAnswers: readonly Readonly<Record<string, unknown>>[];
  readonly policyVersion: string;
  /** Orchestration-side revision of the understanding attempt; part of the idempotency key. */
  readonly understandingRevision?: number;
}

export interface CSREServiceError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/**
 * Service-level response. The TDR defines no separate response envelope schema for CSRE: the
 * `csre-resolution-v5` payload *is* the contract (§31.3), so this wrapper only carries
 * correlation and the typed failure that replaces a resolution when the specialist could not
 * answer (never a guessed semantic result).
 */
export interface CSREServiceResponse {
  readonly requestId: string;
  readonly component: 'CSRE';
  readonly componentVersion: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly status: 'SUCCESS' | 'ERROR';
  /** Validated snake_case wire resolution (`csre-resolution-v5`). */
  readonly resolution: Readonly<Record<string, unknown>> | null;
  readonly error: CSREServiceError | null;
}

export type CSREInvocationStatus = 'SUCCESS' | 'TEMPORARY_FAILURE' | 'SCHEMA_FAILURE' | 'POLICY_FAILURE';

export const CSRE_POLICY_VERSION = 'csre-policy-1.0';
export const CSRE_OUTPUT_SCHEMA_ID = 'https://metamarket.local/schemas/csre-resolution-v5.json';
export const CSRE_REQUEST_SCHEMA_ID = 'https://metamarket.local/schemas/csre-service-request-v5.1.json';
export const CSRE_RESPONSE_SCHEMA_VERSION = '5.0';
export const CSRE_REQUEST_SCHEMA_VERSION = '5.1';
/** Overarching §7.2 names the runtime prompt `csre.runtime.resolve`. */
export const CSRE_PROMPT_ID = 'csre.runtime.resolve';
export const CSRE_PROMPT_VERSION = '5.4.3';

export function csreIdempotencyKey(
  conversationId: string,
  turnId: string,
  understandingRevision: number,
): string {
  return `csre:${conversationId}:${turnId}:${understandingRevision}`;
}

// ── Wire → domain ─────────────────────────────────────────────────────────────────────────────

type Wire = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}
function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str) : [];
}
function nullableStr(value: unknown): string | null {
  return value === null || value === undefined ? null : str(value);
}

/** Explicit projection of a schema-valid wire resolution; free-form keys are preserved untouched. */
export function toCsreResolution(wire: Readonly<Wire>): CSREResolution {
  const context = (wire.context ?? {}) as Wire;
  const regional = (context.regional_context ?? {}) as Wire;
  const location = context.location_context as Wire | null | undefined;
  const clarification = (wire.clarification ?? {}) as Wire;

  return {
    schemaVersion: '5.0',
    requestId: str(wire.request_id),
    resolutionStatus: str(wire.resolution_status) as CsreResolutionStatus,
    originalMessage: str(wire.original_message),
    objects: ((wire.objects as Wire[]) ?? []).map(toSemanticObject),
    context: {
      venues: ((context.venues as Wire[]) ?? []).map((venue) => ({
        expression: str(venue.expression),
        canonicalVenue: str(venue.canonical_venue),
        venueType: str(venue.venue_type),
      })),
      regionalContext: {
        country: str(regional.country ?? 'Nigeria'),
        region: nullableStr(regional.region),
        regionalTerms: strings(regional.regional_terms),
        regionalInterpretationUsed: regional.regional_interpretation_used === true,
      },
      functionalContext: strings(context.functional_context),
      locationContext:
        location === null || location === undefined
          ? null
          : {
              expression: str(location.expression),
              normalized: nullableStr(location.normalized),
              confidence: num(location.confidence),
            },
      qualifiers: strings(context.qualifiers),
    },
    clarification: {
      required: clarification.required === true,
      question: nullableStr(clarification.question),
    },
    evidence: ((wire.evidence as Wire[]) ?? []).map((item) => ({
      evidenceId: str(item.evidence_id),
      source: str(item.source),
      claim: str(item.claim),
    })),
  };
}

export function toSemanticObject(wire: Readonly<Wire>): SemanticObject {
  const origin = (wire.semantic_origin ?? {}) as Wire;
  const commercial = (wire.commercial_interpretation ?? {}) as Wire;
  const confidence = (wire.confidence ?? {}) as Wire;
  const ambiguity = (wire.ambiguity ?? {}) as Wire;
  return {
    objectId: str(wire.object_id),
    semanticOrigin: {
      phrase: str(origin.phrase),
      concept: str(origin.concept),
      market_concept_id: nullableStr(origin.market_concept_id),
      concept_status: origin.concept_status === 'KNOWN' ? 'KNOWN' : 'PROPOSED',
      relationship: 'EXPRESSES',
      origin: 'CSRE',
      request_id: str(origin.request_id),
      semantic_confidence: num(origin.semantic_confidence),
    },
    surfaceForm: str(wire.surface_form),
    canonicalForm: str(wire.canonical_form),
    entityType: str(wire.entity_type) as CsreEntityType,
    definition: str(wire.definition),
    brand: nullableStr(wire.brand),
    model: nullableStr(wire.model),
    attributes: { ...((wire.attributes as Record<string, AttributeValue>) ?? {}) },
    aliases: strings(wire.aliases),
    commercialInterpretation: {
      relevance: str(commercial.relevance) as CommercialRelevance,
      commercialOffering: commercial.commercial_offering === true,
      reason: str(commercial.reason),
      confidence: num(commercial.confidence),
    },
    confidence: {
      semanticResolution: num(confidence.semantic_resolution),
      commercialRelevance: num(confidence.commercial_relevance),
    },
    ambiguity: {
      present: ambiguity.present === true,
      remainingCandidates: ((ambiguity.remaining_candidates as Wire[]) ?? []).map((candidate) => ({
        meaning: str(candidate.meaning),
        entityType: str(candidate.entity_type),
        definition: str(candidate.definition),
        plausibility: num(candidate.plausibility),
      })),
    },
    functionalContext: strings(wire.functional_context),
    relationships: ((wire.relationships as Wire[]) ?? []).map((relationship) => ({
      type: str(relationship.type),
      objects: strings(relationship.objects),
      context: nullableStr(relationship.context),
    })),
  };
}
