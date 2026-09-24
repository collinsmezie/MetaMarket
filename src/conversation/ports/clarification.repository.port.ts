import type { PendingClarification, PendingClarificationStatus } from '../domain/pending-clarification';

export const CLARIFICATION_REPOSITORY = Symbol('ClarificationRepository');

export interface CreateClarificationInput {
  readonly clarificationId: string;
  readonly conversationId: string;
  readonly originatingTurnId: string;
  readonly question: string;
  readonly targetActionIds: readonly string[];
  readonly targetIntentIds: readonly string[];
  readonly blocking: boolean;
  readonly askedAt: Date;
  readonly expiresAt: Date | null;
  readonly expectedResolution: string | null;
  readonly contextSnapshotId: string | null;
  readonly issueKey: string | null;
}

export class ActiveClarificationExistsError extends Error {
  constructor(
    readonly conversationId: string,
    readonly existingClarificationId: string,
  ) {
    super(`Conversation ${conversationId} already has an active clarification ${existingClarificationId}`);
    this.name = 'ActiveClarificationExistsError';
  }
}

/**
 * Durable clarification persistence (MCOS TDR §25A.0, §25A.2).
 *
 * Invariants enforced by the store: `UNIQUE(conversation_id) WHERE status = 'WAITING_FOR_USER'`,
 * append-only history (records are never deleted), version-checked transitions.
 */
export interface ClarificationRepositoryPort {
  create(input: CreateClarificationInput): Promise<PendingClarification>;
  findActive(conversationId: string): Promise<PendingClarification | null>;
  findById(clarificationId: string): Promise<PendingClarification | null>;
  /** Version-checked status transition; returns the updated record or null when the CAS lost. */
  transition(params: {
    clarificationId: string;
    expectedVersion: number;
    to: PendingClarificationStatus;
    at: Date;
    answerMessageIds?: readonly string[];
    answerTurnId?: string | null;
  }): Promise<PendingClarification | null>;
  /** Clarifications asked for the same issue in this conversation, newest first (loop prevention). */
  historyForIssue(
    conversationId: string,
    issueKey: string,
    limit: number,
  ): Promise<readonly PendingClarification[]>;
  listForConversation(conversationId: string, limit: number): Promise<readonly PendingClarification[]>;
}
