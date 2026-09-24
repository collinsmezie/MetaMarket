import type { SemanticOrigin } from '../../semantics/domain/csre-resolution';

/**
 * Enrichment canonical model (Enrichment TDR v4.4 §16, §26, §28, §29.1).
 *
 * Wire format is snake_case JSON validated against `enrichment-resolution-v4.json` (response
 * 4.0) and `enrichment-service-request-v4.1.json`. `semanticOrigin` and `attributes` keep their
 * wire shape: the origin record is copied through byte-for-byte (§24.1, §26.3) and attribute
 * keys are user data.
 */

export const ENRICHMENT_STATUSES = ['ENRICHED', 'PARTIAL', 'EVIDENCE_REQUIRED', 'BLOCKED'] as const;
export type EnrichmentStatus = (typeof ENRICHMENT_STATUSES)[number];

export const DOWNSTREAM_PURPOSES = [
  'GPC_CLASSIFICATION',
  'SEMANTIC_SEARCH',
  'CAPABILITY_MATCHING',
  'OTHER',
] as const;
export type DownstreamPurpose = (typeof DOWNSTREAM_PURPOSES)[number];

export interface EvidenceRequest {
  readonly question: string;
  readonly reason: string;
  readonly candidates: readonly string[];
  readonly geographicContext: string | null;
  readonly preferredSourceTypes: readonly string[];
  readonly requestedFields: readonly string[];
}

export interface EmbeddingRepresentations {
  readonly canonicalEmbeddingText: string;
  readonly functionalEmbeddingText: string;
  readonly taxonomyEmbeddingText: string;
  readonly searchTerms: readonly string[];
  readonly semanticKeywords: readonly string[];
  readonly negativeTerms: readonly string[];
}

export interface EnrichedObject {
  readonly objectId: string;
  readonly semanticOrigin: SemanticOrigin;
  readonly canonicalForm: string;
  readonly entityType: string;
  readonly definition: string;
  readonly brand: string | null;
  readonly model: string | null;
  readonly variant: string | null;
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  readonly functionalProfile: {
    readonly primaryFunction: string | null;
    readonly secondaryFunctions: readonly string[];
    readonly mechanism: string | null;
  };
  readonly useCases: readonly string[];
  readonly commercialTerminology: {
    readonly synonyms: readonly string[];
    readonly aliases: readonly string[];
    readonly informalTerms: readonly string[];
    readonly regionalTerms: readonly string[];
    readonly industryTerms: readonly string[];
  };
  readonly taxonomySemantics: {
    readonly domainHints: readonly string[];
    readonly categoryHints: readonly string[];
    readonly subcategoryHints: readonly string[];
    readonly objectFamily: readonly string[];
    readonly taxonomyVocabulary: readonly string[];
  };
  readonly distinguishingFeatures: readonly string[];
  readonly confusableConcepts: readonly { readonly concept: string; readonly distinguishingSignal: string }[];
  readonly embeddingRepresentations: EmbeddingRepresentations;
  readonly evidence: readonly { readonly evidenceId: string; readonly derivedFields: readonly string[] }[];
  readonly confidence: {
    readonly enrichment: number;
    readonly functionalProfile: number;
    readonly taxonomySemantics: number;
  };
  readonly evidenceRequired: boolean;
  readonly evidenceRequest: EvidenceRequest | null;
  readonly resolutionConcern: string | null;
}

export interface EnrichmentResolution {
  readonly schemaVersion: '4.0';
  readonly requestId: string;
  readonly enrichmentStatus: EnrichmentStatus;
  readonly sourceResolution: { readonly resolverVersion: string; readonly resolutionRequestId: string };
  readonly objects: readonly EnrichedObject[];
  readonly relationships: readonly {
    readonly type: string;
    readonly objects: readonly string[];
    readonly context: string | null;
  }[];
  readonly messageContext: {
    readonly functionalContext: readonly string[];
    readonly sharedConstraints: readonly string[];
  };
}

// ── Service request (§28.1, §29.1) ────────────────────────────────────────────────────────────

export interface EnrichmentServiceRequest {
  readonly schemaVersion: '4.1';
  readonly requestId: string;
  readonly component: 'ENRICHMENT';
  readonly componentVersion: string;
  readonly conversationId: string;
  readonly turnId: string;
  /** Orchestration correlation; not part of the wire request. */
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly sourceResolution: {
    readonly resolver: 'CSRE';
    readonly componentVersion: string;
    readonly wireSchemaVersion: '5.0';
    readonly resolutionRequestId: string;
  };
  /** Exact CSRE v5.0 wire objects (§28.2). */
  readonly objects: readonly Readonly<Record<string, unknown>>[];
  readonly relationships: readonly Readonly<Record<string, unknown>>[];
  readonly messageContext: Readonly<Record<string, unknown>>;
  readonly downstreamPurpose: DownstreamPurpose;
  readonly policyVersion: string;
  /** Evidence already retrieved by the caller (WRS items), if any. */
  readonly availableEvidence?: readonly Readonly<Record<string, unknown>>[];
}

export interface EnrichmentServiceResponse {
  readonly requestId: string;
  readonly component: 'ENRICHMENT';
  readonly componentVersion: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly status: 'SUCCESS' | 'ERROR';
  /** Validated snake_case wire resolution (`enrichment-resolution-v4`). */
  readonly resolution: Readonly<Record<string, unknown>> | null;
  readonly error: { code: string; message: string; retryable: boolean } | null;
}

export type EnrichmentInvocationStatus =
  'SUCCESS' | 'TEMPORARY_FAILURE' | 'SCHEMA_FAILURE' | 'POLICY_FAILURE';

export const ENRICHMENT_POLICY_VERSION = 'enrichment-policy-1.0';
export const ENRICHMENT_OUTPUT_SCHEMA_ID = 'https://metamarket.local/schemas/enrichment-resolution-v4.json';
export const ENRICHMENT_REQUEST_SCHEMA_ID =
  'https://metamarket.local/schemas/enrichment-service-request-v4.1.json';
export const ENRICHMENT_RESPONSE_SCHEMA_VERSION = '4.0';
export const ENRICHMENT_REQUEST_SCHEMA_VERSION = '4.1';
export const ENRICHMENT_PROMPT_ID = 'enrichment.runtime.enrich';
export const ENRICHMENT_PROMPT_VERSION = '4.4.0';

export function enrichmentIdempotencyKey(
  conversationId: string,
  turnId: string,
  resolutionRequestId: string,
  purpose: DownstreamPurpose,
): string {
  return `enrichment:${conversationId}:${turnId}:${resolutionRequestId}:${purpose}`;
}

// ── Wire → domain ─────────────────────────────────────────────────────────────────────────────

type Wire = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === 'string' ? value : String(value ?? ''));
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(str) : []);
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : str(value);

export function toEnrichmentResolution(wire: Readonly<Wire>): EnrichmentResolution {
  const source = (wire.source_resolution ?? {}) as Wire;
  const context = (wire.message_context ?? {}) as Wire;
  return {
    schemaVersion: '4.0',
    requestId: str(wire.request_id),
    enrichmentStatus: str(wire.enrichment_status) as EnrichmentStatus,
    sourceResolution: {
      resolverVersion: str(source.resolver_version),
      resolutionRequestId: str(source.resolution_request_id),
    },
    objects: ((wire.objects as Wire[]) ?? []).map(toEnrichedObject),
    relationships: ((wire.relationships as Wire[]) ?? []).map((relationship) => ({
      type: str(relationship.type),
      objects: strings(relationship.objects),
      context: nullableStr(relationship.context),
    })),
    messageContext: {
      functionalContext: strings(context.functional_context),
      sharedConstraints: strings(context.shared_constraints),
    },
  };
}

export function toEnrichedObject(wire: Readonly<Wire>): EnrichedObject {
  const origin = (wire.semantic_origin ?? {}) as Wire;
  const functional = (wire.functional_profile ?? {}) as Wire;
  const terminology = (wire.commercial_terminology ?? {}) as Wire;
  const taxonomy = (wire.taxonomy_semantics ?? {}) as Wire;
  const embedding = (wire.embedding_representations ?? {}) as Wire;
  const confidence = (wire.confidence ?? {}) as Wire;
  const request = wire.evidence_request as Wire | null | undefined;
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
    canonicalForm: str(wire.canonical_form),
    entityType: str(wire.entity_type),
    definition: str(wire.definition),
    brand: nullableStr(wire.brand),
    model: nullableStr(wire.model),
    variant: nullableStr(wire.variant),
    attributes: { ...((wire.attributes as Record<string, string | number | boolean | null>) ?? {}) },
    functionalProfile: {
      primaryFunction: nullableStr(functional.primary_function),
      secondaryFunctions: strings(functional.secondary_functions),
      mechanism: nullableStr(functional.mechanism),
    },
    useCases: strings(wire.use_cases),
    commercialTerminology: {
      synonyms: strings(terminology.synonyms),
      aliases: strings(terminology.aliases),
      informalTerms: strings(terminology.informal_terms),
      regionalTerms: strings(terminology.regional_terms),
      industryTerms: strings(terminology.industry_terms),
    },
    taxonomySemantics: {
      domainHints: strings(taxonomy.domain_hints),
      categoryHints: strings(taxonomy.category_hints),
      subcategoryHints: strings(taxonomy.subcategory_hints),
      objectFamily: strings(taxonomy.object_family),
      taxonomyVocabulary: strings(taxonomy.taxonomy_vocabulary),
    },
    distinguishingFeatures: strings(wire.distinguishing_features),
    confusableConcepts: ((wire.confusable_concepts as Wire[]) ?? []).map((item) => ({
      concept: str(item.concept),
      distinguishingSignal: str(item.distinguishing_signal),
    })),
    embeddingRepresentations: {
      canonicalEmbeddingText: str(embedding.canonical_embedding_text),
      functionalEmbeddingText: str(embedding.functional_embedding_text),
      taxonomyEmbeddingText: str(embedding.taxonomy_embedding_text),
      searchTerms: strings(embedding.search_terms),
      semanticKeywords: strings(embedding.semantic_keywords),
      negativeTerms: strings(embedding.negative_terms),
    },
    evidence: ((wire.evidence as Wire[]) ?? []).map((item) => ({
      evidenceId: str(item.evidence_id),
      derivedFields: strings(item.derived_fields),
    })),
    confidence: {
      enrichment: num(confidence.enrichment),
      functionalProfile: num(confidence.functional_profile),
      taxonomySemantics: num(confidence.taxonomy_semantics),
    },
    evidenceRequired: wire.evidence_required === true,
    evidenceRequest:
      request === null || request === undefined
        ? null
        : {
            question: str(request.question),
            reason: str(request.reason),
            candidates: strings(request.candidates),
            geographicContext: nullableStr(request.geographic_context),
            preferredSourceTypes: strings(request.preferred_source_types),
            requestedFields: strings(request.requested_fields),
          },
    resolutionConcern: nullableStr(wire.resolution_concern),
  };
}
