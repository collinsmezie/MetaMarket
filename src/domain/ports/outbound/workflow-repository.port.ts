import type {
  SemanticFingerprint,
  WorkflowInstance,
  WorkflowRegistry,
  WorkflowStatus,
} from '../../models/workflow-instance';

/**
 * Persistence contract for workflow instances (MCOS §18).
 *
 * Workflow state must survive process restarts and be readable by any worker, because
 * compute is stateless and a conversation may resume on a different pod (MCOS §20).
 */

export const WORKFLOW_REPOSITORY = Symbol('WorkflowRepository');

export interface CreateWorkflowInstanceInput {
  readonly id: string;
  readonly conversationId: string;
  readonly workflowType: string;
  readonly initialState: string;
  readonly summary: string;
  readonly semanticFingerprint: SemanticFingerprint;
  readonly importantEntities: Readonly<Record<string, string>>;
  readonly data: Readonly<Record<string, unknown>>;
  readonly priority: number;
  readonly resumable: boolean;
  readonly expiresAt: Date | null;
  /** Fingerprint embedding for similarity-based discovery (MCOS §15 Layer 5). */
  readonly fingerprintEmbedding: readonly number[] | null;
}

export interface WorkflowMutation {
  readonly currentState?: string;
  readonly status?: WorkflowStatus;
  readonly summary?: string;
  readonly semanticFingerprint?: SemanticFingerprint;
  readonly importantEntities?: Readonly<Record<string, string>>;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly expiresAt?: Date | null;
  readonly fingerprintEmbedding?: readonly number[] | null;
}

/** An audited state transition, giving every workflow a replayable history. */
export interface TransitionRecord {
  readonly workflowId: string;
  readonly fromState: string;
  readonly toState: string;
  readonly trigger: string;
  readonly at: Date;
  /** Populated when the transition was caused by a failure. */
  readonly error?: string;
}

export interface WorkflowSimilarityMatch {
  readonly workflowId: string;
  readonly similarity: number;
}

export interface WorkflowRepositoryPort {
  create(input: CreateWorkflowInstanceInput): Promise<WorkflowInstance>;

  findById(workflowId: string): Promise<WorkflowInstance | null>;

  loadRegistry(conversationId: string): Promise<WorkflowRegistry>;

  /**
   * Applies a mutation and records the transition atomically.
   *
   * One method rather than separate update/log calls, so a crash can never leave a state
   * change without its audit entry.
   */
  update(
    workflowId: string,
    mutation: WorkflowMutation,
    transition?: TransitionRecord,
  ): Promise<WorkflowInstance>;

  setActiveWorkflow(conversationId: string, workflowId: string | null): Promise<void>;

  listByStatus(conversationId: string, status: WorkflowStatus): Promise<readonly WorkflowInstance[]>;

  /**
   * Workflows whose deterministic identifiers include this value (MCOS §15 Layer 2).
   * Checked before any semantic matching, because an exact id beats a good guess.
   */
  findByImportantEntity(
    conversationId: string,
    key: string,
    value: string,
  ): Promise<readonly WorkflowInstance[]>;

  /** Nearest workflows by fingerprint embedding (MCOS §15 Layer 5). */
  findSimilarByEmbedding(params: {
    conversationId: string;
    embedding: readonly number[];
    limit: number;
    minSimilarity: number;
  }): Promise<readonly WorkflowSimilarityMatch[]>;

  /**
   * Workflows past their expiry that are still in a live status.
   * Drives the sweeper that prevents hung sessions (Execution.md §2.5).
   */
  findExpired(now: Date, limit: number): Promise<readonly WorkflowInstance[]>;

  transitionHistory(workflowId: string): Promise<readonly TransitionRecord[]>;
}
