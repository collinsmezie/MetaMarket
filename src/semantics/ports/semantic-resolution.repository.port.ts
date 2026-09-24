import type { CSREInvocationStatus, SemanticOrigin } from '../domain/csre-resolution';

export const SEMANTIC_RESOLUTION_REPOSITORY = Symbol('SemanticResolutionRepository');

export interface SemanticResolutionRecord {
  readonly id: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string | null;
  readonly contextSnapshotId: string | null;
  readonly understandingRevision: number;
  readonly componentVersion: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly policyVersion: string;
  readonly status: CSREInvocationStatus;
  readonly resolutionStatus: string | null;
  /** Validated snake_case wire resolution (`csre-resolution-v5`). */
  readonly resolution: Readonly<Record<string, unknown>> | null;
  readonly objectCount: number;
  readonly canonicalForms: readonly string[];
  readonly entityTypes: readonly string[];
  readonly clarificationRequired: boolean;
  readonly promptExecutionId: string | null;
  readonly modelProvider: string | null;
  readonly modelName: string | null;
  readonly latencyMs: number;
  readonly error: { code: string; message: string } | null;
  readonly createdAt: Date;
}

export type NewSemanticResolutionRecord = Omit<SemanticResolutionRecord, 'id' | 'createdAt'>;

/**
 * One row per resolved object (CSRE §27.5 observation shape, §25.4): the unit Enrichment, the
 * GPC Resolver, Evidence and the next turn's context consume. `object` is the exact wire object.
 */
export interface PersistedSemanticObject {
  readonly id: string;
  readonly resolutionId: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly objectId: string;
  readonly surfaceForm: string;
  readonly canonicalForm: string;
  readonly entityType: string;
  readonly brand: string | null;
  readonly model: string | null;
  readonly semanticOrigin: SemanticOrigin;
  readonly commercialRelevance: string;
  readonly commercialOffering: boolean;
  readonly semanticConfidence: number;
  readonly commercialConfidence: number;
  readonly ambiguityPresent: boolean;
  readonly object: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/** Persistence of validated CSRE outputs (Overarching §18.4). Append-only; supersede, never overwrite. */
export interface SemanticResolutionRepositoryPort {
  /** Saves the resolution and, atomically, one row per object of a successful resolution. */
  save(
    record: NewSemanticResolutionRecord,
  ): Promise<{ resolution: SemanticResolutionRecord; objects: readonly PersistedSemanticObject[] }>;
  findByIdempotencyKey(key: string): Promise<SemanticResolutionRecord | null>;
  findByRequestId(requestId: string): Promise<SemanticResolutionRecord | null>;
  findByTurnId(turnId: string): Promise<readonly SemanticResolutionRecord[]>;
  objectsForRequest(requestId: string): Promise<readonly PersistedSemanticObject[]>;
  /**
   * Objects resolved on earlier turns of the conversation, newest first — the
   * `ConversationWorkingContext.semanticObjects` source (MCOS §63.1) and IDCE's semantic-object
   * context (IDCE §9). Excludes the current turn so a specialist never sees its own peer's output
   * as prior state.
   */
  recentObjects(
    conversationId: string,
    excludingTurnId: string,
    limit: number,
  ): Promise<readonly PersistedSemanticObject[]>;
}
