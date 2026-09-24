import type { Channel } from '../../domain/models/channel';
import type { AssemblyLimits, BoundaryDecision } from '../domain/assembly-policy';
import type {
  BoundaryReason,
  ConversationTurnSummary,
  LogicalTurn,
  LogicalTurnStatus,
  TurnMessage,
  TurnQueueEntry,
} from '../domain/logical-turn';

export const LOGICAL_TURN_REPOSITORY = Symbol('LogicalTurnRepository');

export interface AcceptMessageInput {
  readonly conversationId: string;
  readonly channel: Channel;
  readonly correlationId: string;
  readonly message: TurnMessage;
  readonly limits: AssemblyLimits;
  /** Pure policy evaluated *inside* the transaction against the locked open turn. */
  readonly decide: (open: OpenTurnRow | null) => BoundaryDecision;
}

export interface OpenTurnRow {
  readonly turnId: string;
  readonly channel: Channel;
  readonly revision: number;
  readonly messageCount: number;
  readonly firstMessageAt: Date;
  readonly quietDeadlineAt: Date;
  readonly hardDeadlineAt: Date;
  readonly lastText: string;
}

export interface AcceptMessageOutcome {
  /** The turn the message now belongs to. */
  readonly turn: LogicalTurn;
  readonly decision: BoundaryDecision;
  /** Turns that were sealed as a side effect and must be enqueued by the caller. */
  readonly sealedTurnIds: readonly string[];
  /** A turn cancelled as a side effect (explicit retraction before execution). */
  readonly cancelledTurnId: string | null;
}

export interface CompleteTurnInput {
  readonly turnId: string;
  readonly status: Extract<LogicalTurnStatus, 'COMMITTED' | 'WAITING_USER' | 'FAILED'>;
  readonly completedAt: Date;
  readonly summary: ConversationTurnSummary | null;
  readonly error: { code: string; message: string } | null;
}

/**
 * Atomic turn-assembly and queue persistence (MCOS TDR §5A.3.4, §5A.10, §5A.11).
 *
 * Every transition here is a PostgreSQL transaction with row locks or a compare-and-set update,
 * so two replicas can never finalize competing logical turns or claim the same queue entry.
 */
export interface LogicalTurnRepositoryPort {
  /** Append/seal/cancel/open protocol for one arriving message, in one transaction. */
  acceptMessage(input: AcceptMessageInput): Promise<AcceptMessageOutcome>;

  /** CAS seal: succeeds only when the turn is still OPEN at `revision` and its quiet deadline passed. */
  sealIfDue(turnId: string, revision: number, now: Date, reason: BoundaryReason): Promise<boolean>;

  /** OPEN turns whose quiet deadline has passed (crash/replica recovery for the timer path). */
  findOverdueOpenTurns(now: Date, limit: number): Promise<readonly { turnId: string; revision: number }[]>;

  /** Idempotent SEALED → ENQUEUED with a per-conversation monotonic sequence. */
  enqueue(turnId: string): Promise<TurnQueueEntry | null>;

  /**
   * Claims the next eligible queue entry: lowest sequence per conversation, only for conversations
   * with nothing CLAIMED/PROCESSING, `FOR UPDATE SKIP LOCKED`. Optionally restricted to one conversation.
   */
  claimNext(workerId: string, conversationId?: string): Promise<TurnQueueEntry | null>;

  markProcessing(turnId: string, runId: string, contextSnapshotId: string, at: Date): Promise<void>;

  complete(input: CompleteTurnInput): Promise<void>;

  /** Returns a claimed turn to the queue after a retryable execution failure (bounded by attempts). */
  requeue(turnId: string, error: string): Promise<void>;

  /** Releases claims older than `staleBefore` back to QUEUED (bounded by `maxAttempts`). */
  recoverStaleClaims(staleBefore: Date, maxAttempts: number): Promise<number>;

  findById(turnId: string): Promise<LogicalTurn | null>;
  findByMessageId(messageId: string): Promise<LogicalTurn | null>;
  listForConversation(conversationId: string, limit: number): Promise<readonly LogicalTurn[]>;
  /** Most recent committed/partial/waiting turn before `beforeTurnId`, for `previousTurnSummary`. */
  latestSummaryBefore(
    conversationId: string,
    beforeFirstMessageAt: Date,
  ): Promise<ConversationTurnSummary | null>;
  queueEntry(turnId: string): Promise<TurnQueueEntry | null>;
}
