import type { Channel } from '../../domain/models/channel';

/**
 * Logical turn assembly model (MCOS TDR §5A).
 *
 * A transport message is a provider event. A logical turn is the smallest conversational batch
 * that should be reasoned about together. Turn Assembly decides the *input boundary* of one
 * orchestration run; it never decides intent (§5A.5).
 */

export const LOGICAL_TURN_STATUSES = [
  'OPEN',
  'SEALED',
  'ENQUEUED',
  'PROCESSING',
  'WAITING_USER',
  'COMMITTED',
  'FAILED',
  'CANCELLED',
] as const;

export type LogicalTurnStatus = (typeof LOGICAL_TURN_STATUSES)[number];

export const TERMINAL_TURN_STATUSES: readonly LogicalTurnStatus[] = [
  'WAITING_USER',
  'COMMITTED',
  'FAILED',
  'CANCELLED',
];

export type AssemblyReason =
  'SINGLE_MESSAGE' | 'COALESCED_MESSAGES' | 'CONTINUATION_WINDOW' | 'EXPLICIT_USER_BATCH';

/** Why a boundary was drawn, in the precedence order of MCOS §5A.3.3. */
export type BoundaryReason =
  | 'INTERACTIVE_PAYLOAD'
  | 'EXPLICIT_RETRACTION'
  | 'HARD_LIMIT'
  | 'QUIET_WINDOW_ELAPSED'
  | 'CHANNEL_BOUNDARY'
  | 'MODEL_CLASSIFIER'
  | 'FIRST_MESSAGE'
  | 'CONTINUATION';

export interface TurnMessage {
  readonly messageId: string;
  readonly channel: Channel;
  readonly senderId: string;
  readonly text: string;
  readonly receivedAt: Date;
  readonly providerEventId: string | null;
  /** Payload of a tapped button/list row, when the message was interactive. */
  readonly interactivePayload: string | null;
}

/** Persisted assembly state (MCOS §5A.3 `TurnAssemblyState` + §5A.7 `LogicalTurn`). */
export interface LogicalTurn {
  readonly turnId: string;
  readonly conversationId: string;
  readonly channel: Channel;
  readonly status: LogicalTurnStatus;
  readonly messageIds: readonly string[];
  readonly messages: readonly TurnMessage[];
  readonly assembledText: string;
  readonly assemblyReason: AssemblyReason | null;
  readonly boundaryReason: BoundaryReason;
  readonly firstMessageAt: Date;
  readonly lastMessageAt: Date;
  readonly quietDeadlineAt: Date;
  readonly hardDeadlineAt: Date;
  readonly sealedAt: Date | null;
  readonly processingStartedAt: Date | null;
  readonly committedAt: Date | null;
  readonly assemblyVersion: number;
  /** Optimistic-concurrency revision; every mutation increments it (§5A.3.1). */
  readonly revision: number;
  readonly runId: string | null;
  readonly contextSnapshotId: string | null;
  readonly correlationId: string;
  readonly supersedesTurnId: string | null;
  readonly correctsTurnId: string | null;
  readonly summary: ConversationTurnSummary | null;
  readonly error: { code: string; message: string } | null;
}

/** Queue relationship for turns awaiting or under execution (MCOS §5A.10). */
export interface TurnQueueEntry {
  readonly queueId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly status:
    'QUEUED' | 'CLAIMED' | 'PROCESSING' | 'WAITING_USER' | 'COMMITTED' | 'FAILED' | 'CANCELLED';
  readonly createdAt: Date;
  readonly claimedAt: Date | null;
  readonly claimedBy: string | null;
  readonly completedAt: Date | null;
  readonly attempts: number;
}

/** Durable digest of a committed turn, fed to the next turn (MCOS §63.1). */
export interface ConversationTurnSummary {
  readonly turnId: string;
  readonly outcome: 'COMMITTED' | 'PARTIAL' | 'FAILED' | 'WAITING_USER';
  readonly intentTypes: readonly string[];
  readonly objectIds: readonly string[];
  readonly workflowIds: readonly string[];
  readonly summary: string;
}

/** Assembles the turn text from ordered messages, one line per transport message. */
/** Messages in receipt order; a stable sort so equal timestamps keep insertion order. */
export function orderMessages(messages: readonly TurnMessage[]): TurnMessage[] {
  return [...messages].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

export function assembleText(messages: readonly TurnMessage[]): string {
  return orderMessages(messages)
    .map((message) => message.text.trim())
    .filter((text) => text.length > 0)
    .join('\n');
}

export function assemblyReasonFor(messageCount: number): AssemblyReason {
  return messageCount <= 1 ? 'SINGLE_MESSAGE' : 'COALESCED_MESSAGES';
}

export function isTerminalTurnStatus(status: LogicalTurnStatus): boolean {
  return TERMINAL_TURN_STATUSES.includes(status);
}
