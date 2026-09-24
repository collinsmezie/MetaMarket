import type { DownstreamPurpose, EnrichmentInvocationStatus } from '../domain/enrichment-resolution';

export const ENRICHMENT_REPOSITORY = Symbol('EnrichmentRepository');

export interface EnrichmentResolutionRecord {
  readonly id: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string | null;
  readonly contextSnapshotId: string | null;
  readonly sourceResolutionRequestId: string;
  readonly componentVersion: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly policyVersion: string;
  readonly downstreamPurpose: DownstreamPurpose;
  readonly status: EnrichmentInvocationStatus;
  readonly enrichmentStatus: string | null;
  /** Validated snake_case wire resolution (`enrichment-resolution-v4`). */
  readonly resolution: Readonly<Record<string, unknown>> | null;
  readonly objectCount: number;
  readonly evidenceRequired: boolean;
  readonly promptExecutionId: string | null;
  readonly modelProvider: string | null;
  readonly modelName: string | null;
  readonly latencyMs: number;
  readonly error: { code: string; message: string } | null;
  readonly createdAt: Date;
}

export type NewEnrichmentResolutionRecord = Omit<EnrichmentResolutionRecord, 'id' | 'createdAt'>;

/** The three purpose-built embedding vectors of one object (Enrichment §11). */
export interface ProfileEmbeddings {
  readonly model: string;
  readonly canonical: readonly number[] | null;
  readonly functional: readonly number[] | null;
  readonly taxonomy: readonly number[] | null;
}

/**
 * One row per enriched object (Overarching §11.2 "durable enrichment snapshots by object
 * identity + enrichment version + source resolution request"): what the GPC Resolver, matching
 * and the knowledge layer consume. `profile` is the exact wire object.
 */
export interface EnrichmentProfileRecord {
  readonly id: string;
  readonly resolutionId: string;
  readonly requestId: string;
  readonly sourceResolutionRequestId: string;
  /** Durable `semantic_objects.id` this profile enriches, when the CSRE object is persisted. */
  readonly semanticObjectId: string | null;
  readonly conversationId: string;
  readonly turnId: string;
  readonly objectId: string;
  readonly canonicalForm: string;
  readonly entityType: string;
  readonly concept: string;
  readonly marketConceptId: string | null;
  readonly conceptStatus: string;
  readonly definition: string;
  readonly canonicalEmbeddingText: string;
  readonly functionalEmbeddingText: string;
  readonly taxonomyEmbeddingText: string;
  readonly searchTerms: readonly string[];
  readonly semanticKeywords: readonly string[];
  readonly negativeTerms: readonly string[];
  readonly evidenceRequired: boolean;
  readonly embeddingModel: string | null;
  readonly profile: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

export interface NewEnrichmentProfile {
  readonly objectId: string;
  readonly semanticObjectId: string | null;
  readonly profile: Readonly<Record<string, unknown>>;
  readonly embeddings: ProfileEmbeddings | null;
}

export interface EnrichmentRepositoryPort {
  /** Saves the resolution and, for a success, one row per object with its embeddings. */
  save(
    record: NewEnrichmentResolutionRecord,
    profiles: readonly NewEnrichmentProfile[],
  ): Promise<{ resolution: EnrichmentResolutionRecord; profiles: readonly EnrichmentProfileRecord[] }>;
  findByIdempotencyKey(key: string): Promise<EnrichmentResolutionRecord | null>;
  findByRequestId(requestId: string): Promise<EnrichmentResolutionRecord | null>;
  profilesForRequest(requestId: string): Promise<readonly EnrichmentProfileRecord[]>;
  /** Latest profile per durable semantic object, for downstream consumers (GPC, matching). */
  latestProfilesForObjects(semanticObjectIds: readonly string[]): Promise<readonly EnrichmentProfileRecord[]>;
}
