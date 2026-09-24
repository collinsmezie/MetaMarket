import type { WrsInvocationStatus } from '../domain/wrs-evidence';

export const WRS_REPOSITORY = Symbol('WrsRepository');

export interface WrsRetrievalRecord {
  readonly id: string;
  readonly requestId: string;
  readonly conversationId: string | null;
  readonly turnId: string | null;
  readonly runId: string | null;
  readonly consumerComponent: string;
  readonly consumerVersion: string;
  readonly consumerPurpose: string;
  readonly question: string;
  /** Validated `wrs-request-v4` wire (candidates, context) for downstream attribution. */
  readonly request: Readonly<Record<string, unknown>> | null;
  readonly provider: string;
  readonly componentVersion: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly status: WrsInvocationStatus;
  readonly responseStatus: string | null;
  /** Validated snake_case wire envelope. */
  readonly response: Readonly<Record<string, unknown>> | null;
  readonly queries: readonly string[];
  readonly sourceCount: number;
  readonly evidenceCount: number;
  readonly promptExecutionId: string | null;
  readonly modelProvider: string | null;
  readonly modelName: string | null;
  readonly latencyMs: number;
  readonly error: { code: string; message: string } | null;
  readonly createdAt: Date;
}

export type NewWrsRetrievalRecord = Omit<WrsRetrievalRecord, 'id' | 'createdAt'>;

/** One immutable evidence row per envelope item (§18.3, §20.4): the Evidence System's ingestion unit. */
export interface WrsEvidenceRecord {
  readonly id: string;
  readonly retrievalId: string;
  readonly requestId: string;
  readonly evidenceId: string;
  readonly consumerComponent: string;
  readonly claim: string;
  readonly kind: string;
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
  readonly relationshipTarget: Readonly<Record<string, unknown>> | null;
  readonly sourceId: string;
  readonly sourceUrl: string | null;
  readonly sourceTitle: string | null;
  readonly sourceType: string;
  readonly geographicRelevance: string;
  readonly temporalRelevance: string;
  readonly quality: string;
  readonly confidence: number;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export interface WrsRepositoryPort {
  save(
    record: NewWrsRetrievalRecord,
  ): Promise<{ retrieval: WrsRetrievalRecord; evidence: readonly WrsEvidenceRecord[] }>;
  findByRequestId(requestId: string): Promise<WrsRetrievalRecord | null>;
  evidenceForRequest(requestId: string): Promise<readonly WrsEvidenceRecord[]>;
}
