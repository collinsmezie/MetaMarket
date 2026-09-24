import type { IDCEInvocationStatus, IDCEResolution, IntentContextRecord } from '../domain/idce-resolution';

export const INTENT_RESOLUTION_REPOSITORY = Symbol('IntentResolutionRepository');

export interface IntentResolutionRecord {
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
  readonly status: IDCEInvocationStatus;
  readonly resolutionStatus: string | null;
  /** Validated snake_case wire resolution. */
  readonly resolution: Readonly<Record<string, unknown>> | null;
  readonly primaryIntentType: string | null;
  readonly intentTypes: readonly string[];
  readonly clarificationRequired: boolean;
  readonly promptExecutionId: string | null;
  readonly modelProvider: string | null;
  readonly modelName: string | null;
  readonly latencyMs: number;
  readonly error: { code: string; message: string } | null;
  readonly createdAt: Date;
}

export type NewIntentResolutionRecord = Omit<IntentResolutionRecord, 'id' | 'createdAt'>;

/** Persistence of validated IDCE outputs (Overarching §18.4). Append-only; supersede, never overwrite. */
export interface IntentResolutionRepositoryPort {
  save(record: NewIntentResolutionRecord): Promise<IntentResolutionRecord>;
  findByIdempotencyKey(key: string): Promise<IntentResolutionRecord | null>;
  findByRequestId(requestId: string): Promise<IntentResolutionRecord | null>;
  findByTurnId(turnId: string): Promise<readonly IntentResolutionRecord[]>;
  /** Successful resolutions of earlier turns, newest first — the `priorIntentState` context (IDCE §9). */
  priorIntentState(
    conversationId: string,
    excludingTurnId: string,
    limit: number,
  ): Promise<readonly IntentContextRecord[]>;
  /** Camel-case view of the latest successful resolution for a turn, if any. */
  latestResolutionForTurn(turnId: string): Promise<IDCEResolution | null>;
}
