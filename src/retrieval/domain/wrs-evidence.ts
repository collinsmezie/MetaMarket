/**
 * Web Retrieval System canonical model (WRS TDR v4.4 §3–§5, §18, §20, §22.1).
 *
 * Wire format is snake_case JSON validated against `wrs-request-v4.json` and
 * `wrs-response-v4.json` (both 4.0). WRS produces evidence with provenance; consumers make the
 * domain decisions (§15 invariant 1, §20.3).
 */

export const WRS_CONSUMERS = [
  'CSRE',
  'ENRICHMENT',
  'GPC_RESOLVER',
  'MATCHING_FANOUT',
  'MKG',
  'EVIDENCE',
  'OTHER',
] as const;
export type WrsConsumerComponent = (typeof WRS_CONSUMERS)[number];

export const WRS_STATUSES = ['SUCCESS', 'PARTIAL', 'NO_RELIABLE_EVIDENCE', 'ERROR'] as const;
export type WrsStatus = (typeof WRS_STATUSES)[number];

export const SOURCE_TYPES = [
  'manufacturer',
  'retailer',
  'government',
  'standards',
  'publication',
  'marketplace',
  'forum',
  'other',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface RelationshipTarget {
  readonly subjectId: string | null;
  readonly predicate: string | null;
  readonly objectId: string | null;
  readonly objectType: string | null;
}

export interface EvidenceCandidate {
  readonly candidateId: string;
  readonly label: string;
  readonly description: string | null;
}

export interface WrsConsumer {
  readonly component: WrsConsumerComponent;
  readonly version: string;
  readonly purpose: string;
}

export interface WrsServiceRequest {
  readonly schemaVersion: '4.0';
  readonly requestId: string;
  readonly consumer: WrsConsumer;
  readonly question: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly candidates: readonly EvidenceCandidate[];
  readonly relationshipTarget: RelationshipTarget | null;
  readonly evidenceRequirements: readonly string[];
  readonly requestedFields: readonly string[];
  readonly outputContract: Readonly<Record<string, unknown>>;
  /** Orchestration correlation (optional in component mode). */
  readonly conversationId: string | null;
  readonly turnId: string | null;
  readonly runId: string | null;
  readonly contextSnapshotId: string | null;
}

export interface WrsEvidence {
  readonly evidenceId: string;
  readonly claim: string;
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
  readonly relationshipTarget: RelationshipTarget | null;
  readonly quote: string | null;
  readonly sourceId: string;
  readonly sourceUrl: string | null;
  readonly sourceTitle: string | null;
  readonly sourceType: SourceType;
  readonly geographicRelevance: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  readonly temporalRelevance: 'CURRENT' | 'HISTORICAL' | 'UNKNOWN';
  readonly quality: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly confidence: number;
  readonly kind: 'OBSERVED' | 'CROSS_SOURCE' | 'INFERENCE';
}

export interface WrsFinding {
  readonly finding: string;
  readonly kind: 'OBSERVED' | 'CROSS_SOURCE' | 'INFERENCE' | 'UNRESOLVED';
  readonly evidenceIds: readonly string[];
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
}

export interface WrsContradiction {
  readonly claimA: string;
  readonly claimB: string;
  readonly evidenceIds: readonly string[];
  readonly likelyReason: 'GEOGRAPHIC' | 'TEMPORAL' | 'VARIANT' | 'SEMANTIC_AMBIGUITY' | 'UNKNOWN';
  readonly effectOnConfidence: string;
}

export interface WrsSource {
  readonly sourceId: string;
  readonly url: string | null;
  readonly title: string | null;
  readonly sourceType: SourceType;
  readonly quality: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly relevance: number;
}

export interface WrsResponse {
  readonly schemaVersion: '4.0';
  readonly requestId: string;
  readonly consumer: WrsConsumer;
  readonly taskType: string;
  readonly status: WrsStatus;
  readonly evidence: readonly WrsEvidence[];
  readonly findings: readonly WrsFinding[];
  readonly contradictions: readonly WrsContradiction[];
  readonly sources: readonly WrsSource[];
  readonly confidence: {
    readonly overall: number;
    readonly evidenceQuality: number;
    readonly evidenceConsistency: number;
  };
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface WrsServiceResponse {
  readonly requestId: string;
  readonly component: 'WRS';
  readonly componentVersion: string;
  readonly status: 'SUCCESS' | 'ERROR';
  /** Validated snake_case wire envelope (`wrs-response-v4`); present for NO_RELIABLE_EVIDENCE too. */
  readonly response: Readonly<Record<string, unknown>> | null;
  /** §20.6: machine-readable failure in the service layer. */
  readonly error: { code: string; message: string; retryable: boolean } | null;
}

export type WrsInvocationStatus =
  | 'SUCCESS'
  | 'NO_RELIABLE_EVIDENCE'
  | 'PROVIDER_UNAVAILABLE'
  | 'TEMPORARY_FAILURE'
  | 'SCHEMA_FAILURE'
  | 'POLICY_FAILURE';

export const WRS_REQUEST_SCHEMA_ID = 'https://metamarket.local/schemas/wrs-request-v4.json';
export const WRS_RESPONSE_SCHEMA_ID = 'https://metamarket.local/schemas/wrs-response-v4.json';
export const WRS_WIRE_SCHEMA_VERSION = '4.0';
export const WRS_PROMPT_ID = 'wrs.runtime.retrieve';
export const WRS_PROMPT_VERSION = '4.4.0';

/** Collected web material handed to the evaluator; the only sources evidence may cite. */
export interface CollectedSource {
  readonly sourceId: string;
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly publishedAt: string | null;
  readonly providerScore: number;
  readonly queries: readonly string[];
}

// ── Wire → domain ─────────────────────────────────────────────────────────────────────────────

type Wire = Record<string, unknown>;
const str = (value: unknown): string => (typeof value === 'string' ? value : String(value ?? ''));
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(str) : []);
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : str(value);

function toTarget(value: unknown): RelationshipTarget | null {
  if (value === null || value === undefined) return null;
  const wire = value as Wire;
  return {
    subjectId: nullableStr(wire.subject_id),
    predicate: nullableStr(wire.predicate),
    objectId: nullableStr(wire.object_id),
    objectType: nullableStr(wire.object_type),
  };
}

export function toWrsResponse(wire: Readonly<Wire>): WrsResponse {
  const consumer = (wire.consumer ?? {}) as Wire;
  const confidence = (wire.confidence ?? {}) as Wire;
  return {
    schemaVersion: '4.0',
    requestId: str(wire.request_id),
    consumer: {
      component: str(consumer.component) as WrsConsumerComponent,
      version: str(consumer.version),
      purpose: str(consumer.purpose),
    },
    taskType: str(wire.task_type),
    status: str(wire.status) as WrsStatus,
    evidence: ((wire.evidence as Wire[]) ?? []).map((item) => ({
      evidenceId: str(item.evidence_id),
      claim: str(item.claim),
      supports: strings(item.supports),
      contradicts: strings(item.contradicts),
      relationshipTarget: toTarget(item.relationship_target),
      quote: nullableStr(item.quote),
      sourceId: str(item.source_id),
      sourceUrl: nullableStr(item.source_url),
      sourceTitle: nullableStr(item.source_title),
      sourceType: str(item.source_type) as SourceType,
      geographicRelevance: str(item.geographic_relevance) as WrsEvidence['geographicRelevance'],
      temporalRelevance: str(item.temporal_relevance) as WrsEvidence['temporalRelevance'],
      quality: str(item.quality) as WrsEvidence['quality'],
      confidence: num(item.confidence),
      kind: str(item.kind) as WrsEvidence['kind'],
    })),
    findings: ((wire.findings as Wire[]) ?? []).map((item) => ({
      finding: str(item.finding),
      kind: str(item.kind) as WrsFinding['kind'],
      evidenceIds: strings(item.evidence_ids),
      supports: strings(item.supports),
      contradicts: strings(item.contradicts),
    })),
    contradictions: ((wire.contradictions as Wire[]) ?? []).map((item) => ({
      claimA: str(item.claim_a),
      claimB: str(item.claim_b),
      evidenceIds: strings(item.evidence_ids),
      likelyReason: str(item.likely_reason) as WrsContradiction['likelyReason'],
      effectOnConfidence: str(item.effect_on_confidence),
    })),
    sources: ((wire.sources as Wire[]) ?? []).map((item) => ({
      sourceId: str(item.source_id),
      url: nullableStr(item.url),
      title: nullableStr(item.title),
      sourceType: str(item.source_type) as SourceType,
      quality: str(item.quality) as WrsSource['quality'],
      relevance: num(item.relevance),
    })),
    confidence: {
      overall: num(confidence.overall),
      evidenceQuality: num(confidence.evidence_quality),
      evidenceConsistency: num(confidence.evidence_consistency),
    },
    payload: { ...((wire.payload as Wire) ?? {}) },
  };
}

export function toWireRequest(request: WrsServiceRequest): Wire {
  return {
    schema_version: request.schemaVersion,
    request_id: request.requestId,
    consumer: {
      component: request.consumer.component,
      version: request.consumer.version,
      purpose: request.consumer.purpose,
    },
    evidence_request: {
      question: request.question,
      context: request.context,
      candidates: request.candidates.map((candidate) => ({
        candidate_id: candidate.candidateId,
        label: candidate.label,
        description: candidate.description,
      })),
      relationship_target:
        request.relationshipTarget === null
          ? null
          : {
              subject_id: request.relationshipTarget.subjectId,
              predicate: request.relationshipTarget.predicate,
              object_id: request.relationshipTarget.objectId,
              object_type: request.relationshipTarget.objectType,
            },
      evidence_requirements: request.evidenceRequirements,
      requested_fields: request.requestedFields,
      output_contract: request.outputContract,
    },
    ...(request.conversationId !== null ? { conversation_id: request.conversationId } : {}),
    ...(request.turnId !== null ? { turn_id: request.turnId } : {}),
    ...(request.contextSnapshotId !== null ? { context_snapshot_id: request.contextSnapshotId } : {}),
  };
}
