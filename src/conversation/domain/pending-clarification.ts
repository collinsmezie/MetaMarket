/**
 * Durable pending clarification (MCOS TDR §25A).
 *
 * A clarification question is a specialist *recommendation*, gated by LangGraph and delivered by
 * MCOS. Once asked it is durable MCOS/application state — never ephemeral graph state — so the
 * next user message can be bound to it, delivery retries reuse the same id, and the one-question
 * rule can be enforced against history.
 */

export const PENDING_CLARIFICATION_STATUSES = [
  'WAITING_FOR_USER',
  'ANSWER_RECEIVED',
  'RESOLVED',
  'EXPIRED',
  'CANCELLED',
  'SUPERSEDED',
] as const;

export type PendingClarificationStatus = (typeof PENDING_CLARIFICATION_STATUSES)[number];

export interface PendingClarification {
  readonly clarificationId: string;
  readonly conversationId: string;
  readonly originatingTurnId: string;
  readonly question: string;
  readonly targetActionIds: readonly string[];
  readonly targetIntentIds: readonly string[];
  /** Blocks the target action(s), not necessarily the whole turn (IDCE §15A). */
  readonly blocking: boolean;
  readonly status: PendingClarificationStatus;
  readonly askedAt: Date;
  readonly answerMessageIds: readonly string[];
  readonly answerTurnId: string | null;
  readonly resolvedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly attemptCount: number;
  readonly expectedResolution: string | null;
  readonly contextSnapshotId: string | null;
  /**
   * Stable key of the unresolved issue (e.g. `object:o2:referent`), so the orchestrator can
   * refuse to ask materially the same question twice (MCOS §25A.4).
   */
  readonly issueKey: string | null;
  readonly version: number;
}

const TRANSITIONS: Readonly<Record<PendingClarificationStatus, readonly PendingClarificationStatus[]>> = {
  WAITING_FOR_USER: ['ANSWER_RECEIVED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED'],
  ANSWER_RECEIVED: ['RESOLVED', 'WAITING_FOR_USER', 'CANCELLED', 'SUPERSEDED'],
  RESOLVED: [],
  EXPIRED: [],
  CANCELLED: [],
  SUPERSEDED: [],
};

export function canTransitionClarification(
  from: PendingClarificationStatus,
  to: PendingClarificationStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalClarificationTransition extends Error {
  constructor(
    readonly clarificationId: string,
    readonly from: PendingClarificationStatus,
    readonly to: PendingClarificationStatus,
  ) {
    super(`Clarification ${clarificationId} cannot move from ${from} to ${to}`);
    this.name = 'IllegalClarificationTransition';
  }
}
