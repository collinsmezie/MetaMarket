import type { GpcInvocationStatus } from '../domain/gpc-mapping';

export const GPC_MAPPING_REPOSITORY = Symbol('GpcMappingRepository');

export interface GpcResolutionRecord {
  readonly id: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string | null;
  readonly contextSnapshotId: string | null;
  readonly csreRequestId: string;
  readonly enrichmentRequestId: string | null;
  readonly componentVersion: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly policyVersion: string;
  readonly gpcVersion: string;
  readonly status: GpcInvocationStatus;
  readonly resolutionStatus: string | null;
  /** Validated snake_case wire response (`gpc-resolver-response-v4`). */
  readonly resolution: Readonly<Record<string, unknown>> | null;
  readonly objectCount: number;
  readonly mappedCount: number;
  readonly candidateCount: number;
  readonly promptExecutionId: string | null;
  readonly modelProvider: string | null;
  readonly modelName: string | null;
  readonly latencyMs: number;
  readonly error: { code: string; message: string } | null;
  readonly createdAt: Date;
}

export type NewGpcResolutionRecord = Omit<GpcResolutionRecord, 'id' | 'createdAt'>;

/**
 * One mapping fact per object (GPC Resolver TDR §47, §62, §75.2): what Evidence consumes and
 * MKG anchors. `mapping` is the exact wire object result.
 */
export interface GpcMappingRecord {
  readonly id: string;
  readonly resolutionId: string;
  readonly requestId: string;
  readonly csreRequestId: string;
  readonly enrichmentRequestId: string | null;
  readonly semanticObjectId: string | null;
  readonly enrichmentProfileId: string | null;
  readonly conversationId: string;
  readonly turnId: string;
  readonly objectId: string;
  readonly concept: string;
  readonly marketConceptId: string | null;
  readonly entityType: string;
  readonly state: string;
  readonly gpcCode: string | null;
  readonly gpcLevel: string | null;
  readonly gpcTitle: string | null;
  readonly mappingConfidence: number;
  readonly reasonCodes: readonly string[];
  readonly gpcVersion: string;
  readonly resolverVersion: string;
  readonly candidateCodes: readonly string[];
  readonly mapping: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export interface NewGpcMapping {
  readonly objectId: string;
  readonly semanticObjectId: string | null;
  readonly enrichmentProfileId: string | null;
  readonly entityType: string;
  readonly candidateCodes: readonly string[];
  readonly mapping: Readonly<Record<string, unknown>>;
}

export interface GpcMappingRepositoryPort {
  save(
    record: NewGpcResolutionRecord,
    mappings: readonly NewGpcMapping[],
  ): Promise<{ resolution: GpcResolutionRecord; mappings: readonly GpcMappingRecord[] }>;
  findByIdempotencyKey(key: string): Promise<GpcResolutionRecord | null>;
  findByRequestId(requestId: string): Promise<GpcResolutionRecord | null>;
  mappingsForRequest(requestId: string): Promise<readonly GpcMappingRecord[]>;
  /** Latest mapping per durable semantic object (downstream consumers). */
  latestMappingsForObjects(semanticObjectIds: readonly string[]): Promise<readonly GpcMappingRecord[]>;
}
