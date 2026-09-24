import type { SemanticOrigin } from '../../semantics/domain/csre-resolution';

/**
 * GPC Resolver canonical model (GPC Resolver TDR v4.4 §20, §45–§48, §93, §95, §76.1).
 *
 * Wire format is snake_case JSON validated against `gpc-resolver-request-v4.json` and
 * `gpc-resolver-response-v4.json` (both 4.0). `semanticOrigin` keeps its wire shape because it is
 * copied through byte-for-byte (§93.6).
 */

export const MAPPING_STATES = [
  'MAPPED',
  'AMBIGUOUS',
  'INSUFFICIENT',
  'CONFLICTING',
  'NOT_APPLICABLE',
] as const;
export type MappingState = (typeof MAPPING_STATES)[number];

export const GPC_LEVEL_NAMES = ['SEGMENT', 'FAMILY', 'CLASS', 'BRICK'] as const;
export type GpcLevelName = (typeof GPC_LEVEL_NAMES)[number];

export const RETRIEVAL_SOURCES = ['VECTOR', 'LEXICAL', 'ALIAS', 'KNOWLEDGE', 'EXACT'] as const;
export type RetrievalSource = (typeof RETRIEVAL_SOURCES)[number];

/** §48 reason codes. */
export const REASON_CODES = [
  'STRONG_DEFINITION_MATCH',
  'STRONG_FUNCTION_MATCH',
  'ATTRIBUTE_MATCH',
  'ENTITY_TYPE_MATCH',
  'HIERARCHY_MATCH',
  'SPECIFICITY_MATCH',
  'MARKET_KNOWLEDGE_SUPPORT',
  'EVIDENCE_SUPPORT',
  'VECTOR_SUPPORT',
  'LEXICAL_SUPPORT',
  'DEFINITION_MISMATCH',
  'FUNCTION_MISMATCH',
  'ATTRIBUTE_CONFLICT',
  'ENTITY_TYPE_MISMATCH',
  'SPECIFICITY_CONFLICT',
  'CONTRADICTORY_EVIDENCE',
  'INSUFFICIENT_EVIDENCE',
  'MULTIPLE_GPC_CANDIDATES',
  'NOT_GPC_APPLICABLE',
] as const;

/**
 * Entity types the sovereign product taxonomy cannot represent (§14.1, §17, Overarching §12.3).
 * They are answered NOT_APPLICABLE deterministically, without a model call.
 */
export const NON_GPC_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'SERVICE',
  'CAPABILITY',
  'PERSON',
  'ORGANIZATION',
  'PLACE',
  'ACTIVITY',
  'CONCEPT',
  'SOFTWARE',
]);

export interface GpcLineageRef {
  readonly code: string;
  readonly title: string;
}

/** §46 / §93A.2 candidate with provenance (§76.3). */
export interface GpcCandidate {
  readonly gpcCode: string;
  readonly level: GpcLevelName;
  readonly title: string;
  readonly definition: string | null;
  readonly segment: GpcLineageRef | null;
  readonly family: GpcLineageRef | null;
  readonly class: GpcLineageRef | null;
  readonly brick: GpcLineageRef | null;
  readonly retrievalSources: readonly RetrievalSource[];
  /** Fused retrieval score in [0,1]; never the mapping confidence (§46). */
  readonly retrievalScore: number;
  readonly gpcVersion: string;
  readonly forObjectId: string;
}

export interface SourceTrace {
  readonly csreRequestId: string;
  readonly enrichmentRequestId: string | null;
  readonly wrsEvidenceIds: readonly string[];
  readonly evidenceSystemIds: readonly string[];
}

export interface GpcMapping {
  readonly state: MappingState;
  readonly gpcCode: string | null;
  readonly gpcLevel: GpcLevelName | null;
  readonly gpcTitle: string | null;
  readonly mappingConfidence: number;
  readonly reasonCodes: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly gpcVersion: string;
  readonly resolverVersion: string;
}

export interface GpcObjectResult {
  readonly objectId: string;
  readonly semanticOrigin: SemanticOrigin;
  readonly sourceTrace: SourceTrace;
  readonly mapping: GpcMapping;
  readonly diagnosticCandidates: readonly {
    readonly gpcCode: string;
    readonly level: GpcLevelName;
    readonly title: string;
    readonly assessment: number;
    readonly rejectedReason: string | null;
  }[];
  readonly diagnostics: { readonly requiredDistinction: string | null; readonly notes: readonly string[] };
}

export interface GpcResolution {
  readonly schemaVersion: '4.0';
  readonly requestId: string;
  readonly resolverVersion: string;
  readonly status: 'SUCCESS' | 'PARTIAL' | 'ERROR';
  readonly objects: readonly GpcObjectResult[];
  readonly messageLevel: {
    readonly relationships: readonly {
      readonly type: string;
      readonly objects: readonly string[];
      readonly context: string | null;
    }[];
    readonly sharedContext: readonly string[];
  };
}

// ── Service request (§93.1, §93A.1, §95.1) ────────────────────────────────────────────────────

export interface GpcResolverServiceRequest {
  readonly schemaVersion: '4.0';
  readonly requestId: string;
  readonly resolverVersion: string;
  readonly conversationId: string;
  readonly turnId: string;
  /** Orchestration correlation; not part of the wire request. */
  readonly runId: string;
  readonly contextSnapshotId: string;
  /** CSRE v5 wire objects augmented with `source_trace` (and `enrichment` when present, §95.2–§95.3). */
  readonly objects: readonly Readonly<Record<string, unknown>>[];
  readonly messageContext: Readonly<Record<string, unknown>>;
  /** Enrichment wire objects keyed by object_id (the `enrichment` request block). */
  readonly enrichment: Readonly<Record<string, unknown>>;
  readonly marketKnowledge: readonly Readonly<Record<string, unknown>>[];
  readonly evidence: readonly Readonly<Record<string, unknown>>[];
  /** Optional externally supplied candidates (§76.2 override/hint). */
  readonly gpcCandidates: readonly Readonly<Record<string, unknown>>[];
  readonly resolutionPolicy: Readonly<Record<string, unknown>>;
}

export interface GpcResolverServiceResponse {
  readonly requestId: string;
  readonly component: 'GPC_RESOLVER';
  readonly componentVersion: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly status: 'SUCCESS' | 'ERROR';
  /** Validated snake_case wire resolution (`gpc-resolver-response-v4`). */
  readonly resolution: Readonly<Record<string, unknown>> | null;
  readonly error: { code: string; message: string; retryable: boolean } | null;
}

export type GpcInvocationStatus = 'SUCCESS' | 'TEMPORARY_FAILURE' | 'SCHEMA_FAILURE' | 'POLICY_FAILURE';

export const GPC_POLICY_VERSION = 'gpc-policy-1.0';
export const GPC_REQUEST_SCHEMA_ID = 'https://metamarket.local/schemas/gpc-resolver-request-v4.json';
export const GPC_RESPONSE_SCHEMA_ID = 'https://metamarket.local/schemas/gpc-resolver-response-v4.json';
export const GPC_CANDIDATE_SCHEMA_ID = 'https://metamarket.local/schemas/gpc-candidate-v4.json';
export const GPC_WIRE_SCHEMA_VERSION = '4.0';
export const GPC_PROMPT_ID = 'gpc.runtime.resolve';
export const GPC_PROMPT_VERSION = '4.4.1';

export function gpcIdempotencyKey(
  conversationId: string,
  turnId: string,
  csreRequestId: string,
  enrichmentRequestId: string | null,
): string {
  return `gpc:${conversationId}:${turnId}:${csreRequestId}:${enrichmentRequestId ?? 'none'}`;
}

export function levelName(level: number): GpcLevelName | null {
  switch (level) {
    case 1:
      return 'SEGMENT';
    case 2:
      return 'FAMILY';
    case 3:
      return 'CLASS';
    case 4:
      return 'BRICK';
    default:
      return null;
  }
}

// ── Wire → domain ─────────────────────────────────────────────────────────────────────────────

type Wire = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === 'string' ? value : String(value ?? ''));
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(str) : []);
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : str(value);

export function toGpcResolution(wire: Readonly<Wire>): GpcResolution {
  const message = (wire.message_level ?? {}) as Wire;
  return {
    schemaVersion: '4.0',
    requestId: str(wire.request_id),
    resolverVersion: str(wire.resolver_version),
    status: str(wire.status) as GpcResolution['status'],
    objects: ((wire.objects as Wire[]) ?? []).map(toGpcObjectResult),
    messageLevel: {
      relationships: ((message.relationships as Wire[]) ?? []).map((relationship) => ({
        type: str(relationship.type),
        objects: strings(relationship.objects),
        context: nullableStr(relationship.context),
      })),
      sharedContext: strings(message.shared_context),
    },
  };
}

export function toGpcObjectResult(wire: Readonly<Wire>): GpcObjectResult {
  const origin = (wire.semantic_origin ?? {}) as Wire;
  const trace = (wire.source_trace ?? {}) as Wire;
  const mapping = (wire.mapping ?? {}) as Wire;
  const diagnostics = (wire.diagnostics ?? {}) as Wire;
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
    sourceTrace: {
      csreRequestId: str(trace.csre_request_id),
      enrichmentRequestId: nullableStr(trace.enrichment_request_id),
      wrsEvidenceIds: strings(trace.wrs_evidence_ids),
      evidenceSystemIds: strings(trace.evidence_system_ids),
    },
    mapping: {
      state: str(mapping.state) as MappingState,
      gpcCode: nullableStr(mapping.gpc_code),
      gpcLevel: (nullableStr(mapping.gpc_level) as GpcLevelName | null) ?? null,
      gpcTitle: nullableStr(mapping.gpc_title),
      mappingConfidence: num(mapping.mapping_confidence),
      reasonCodes: strings(mapping.reason_codes),
      evidenceIds: strings(mapping.evidence_ids),
      gpcVersion: str(mapping.gpc_version),
      resolverVersion: str(mapping.resolver_version),
    },
    diagnosticCandidates: ((wire.diagnostic_candidates as Wire[]) ?? []).map((candidate) => ({
      gpcCode: str(candidate.gpc_code),
      level: str(candidate.level) as GpcLevelName,
      title: str(candidate.title),
      assessment: num(candidate.assessment),
      rejectedReason: nullableStr(candidate.rejected_reason),
    })),
    diagnostics: {
      requiredDistinction: nullableStr(diagnostics.required_distinction),
      notes: strings(diagnostics.notes),
    },
  };
}

export function candidateToWire(candidate: GpcCandidate): Wire {
  return {
    gpc_code: candidate.gpcCode,
    level: candidate.level,
    title: candidate.title,
    definition: candidate.definition,
    segment: candidate.segment ?? {},
    family: candidate.family ?? {},
    class: candidate.class ?? {},
    brick: candidate.brick ?? {},
    retrieval_sources: candidate.retrievalSources,
    retrieval_score: candidate.retrievalScore,
    gpc_version: candidate.gpcVersion,
    for_object_id: candidate.forObjectId,
  };
}
