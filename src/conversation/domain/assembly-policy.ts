import type { Channel } from '../../domain/models/channel';
import type { BoundaryReason } from './logical-turn';

/**
 * Deterministic turn-boundary policy (MCOS TDR §5A.3.2–§5A.6).
 *
 * Pure: given the currently open turn (if any), the incoming transport message and the
 * configured limits, decide whether the message joins the open turn or draws a boundary. The
 * precedence is the TDR's: interactive/action payload → explicit retraction → hard limits →
 * deterministic continuation → (optional) bounded model classifier → default.
 *
 * This policy answers only "should these messages be reasoned about together?" — never what the
 * user wants (that is IDCE's decision on the assembled turn).
 */

export interface AssemblyLimits {
  /** Inter-message accumulation window, per channel (`QUIET_WINDOW_MS`). */
  readonly quietWindowMs: number;
  /** Hard upper bound on one logical turn's duration (`MAX_TURN_ASSEMBLY_MS`). */
  readonly maxAssemblyMs: number;
  /** Hard upper bound on the number of messages in one logical turn (`MAX_MESSAGE_COUNT`). */
  readonly maxMessageCount: number;
}

export interface OpenTurnView {
  readonly turnId: string;
  readonly channel: Channel;
  readonly revision: number;
  readonly messageCount: number;
  readonly firstMessageAt: Date;
  readonly quietDeadlineAt: Date;
  readonly hardDeadlineAt: Date;
  readonly lastText: string;
}

export interface IncomingView {
  readonly channel: Channel;
  readonly text: string;
  readonly interactivePayload: string | null;
  readonly receivedAt: Date;
}

export type BoundaryDecision =
  /** No open turn: start one and arm the quiet deadline. */
  | { readonly action: 'OPEN_NEW'; readonly reason: BoundaryReason }
  /** Start a turn that is sealed immediately (button taps are decisive on their own). */
  | { readonly action: 'OPEN_NEW_SEALED'; readonly reason: BoundaryReason }
  /** Coalesce into the open turn and extend its quiet deadline. */
  | { readonly action: 'APPEND'; readonly reason: BoundaryReason; readonly newQuietDeadlineAt: Date }
  /** Seal the open turn as it stands, then start a new one for this message. */
  | {
      readonly action: 'SEAL_OPEN_THEN_NEW';
      readonly reason: BoundaryReason;
      readonly newTurnSealed: boolean;
    }
  /**
   * The user retracted the open (never-executed) request: cancel it so nothing runs for it, and
   * start a new turn that records what it supersedes (MCOS §5A.10 `supersedesTurnId`).
   */
  | { readonly action: 'CANCEL_OPEN_THEN_NEW'; readonly reason: BoundaryReason }
  /** Deterministic signals are inconclusive; the bounded model classifier may be consulted. */
  | { readonly action: 'UNCERTAIN'; readonly newQuietDeadlineAt: Date };

/**
 * Explicit retraction/cancellation openers. Deliberately conservative: "actually Honda" is a
 * correction that belongs to the same turn, so plain "actually" is NOT a retraction.
 */
const RETRACTION_PATTERN =
  /^\s*(?:actually\s+|abeg\s+|oh\s+|ok\s+|okay\s+)?(?:forget\s+(?:that|it|about\s+(?:it|that))|never\s?mind|cancel(?:\s+(?:that|it|this))?|leave\s+(?:that|it)|scratch\s+that|ignore\s+(?:that|the\s+last\s+(?:one|message))|no\s+wait,?\s+forget\s+(?:that|it))\b/i;

/** Discourse markers that *may* open a new topic inside the window; only the classifier can tell. */
const TOPIC_SWITCH_PATTERN =
  /^\s*(?:also|by\s+the\s+way|another\s+thing|one\s+more\s+thing|separately|different\s+matter)\b/i;

export function isExplicitRetraction(text: string): boolean {
  return RETRACTION_PATTERN.test(text);
}

export function looksLikeTopicSwitch(text: string): boolean {
  return TOPIC_SWITCH_PATTERN.test(text);
}

export function quietDeadlineFor(receivedAt: Date, limits: AssemblyLimits, hardDeadlineAt: Date): Date {
  const candidate = receivedAt.getTime() + limits.quietWindowMs;
  return new Date(Math.min(candidate, hardDeadlineAt.getTime()));
}

export function hardDeadlineFor(firstMessageAt: Date, limits: AssemblyLimits): Date {
  return new Date(firstMessageAt.getTime() + limits.maxAssemblyMs);
}

export function decideBoundary(
  open: OpenTurnView | null,
  incoming: IncomingView,
  limits: AssemblyLimits,
  options: { readonly classifierEnabled: boolean } = { classifierEnabled: false },
): BoundaryDecision {
  // 1. Explicit interactive/action payload boundary: a tap is decisive on its own.
  if (incoming.interactivePayload !== null) {
    return open === null
      ? { action: 'OPEN_NEW_SEALED', reason: 'INTERACTIVE_PAYLOAD' }
      : { action: 'SEAL_OPEN_THEN_NEW', reason: 'INTERACTIVE_PAYLOAD', newTurnSealed: true };
  }

  if (open === null) return { action: 'OPEN_NEW', reason: 'FIRST_MESSAGE' };

  // 2. Explicit cancellation/retraction of the not-yet-executed request.
  if (isExplicitRetraction(incoming.text)) {
    return { action: 'CANCEL_OPEN_THEN_NEW', reason: 'EXPLICIT_RETRACTION' };
  }

  // Channel semantics: a different channel is a hard message boundary.
  if (open.channel !== incoming.channel) {
    return { action: 'SEAL_OPEN_THEN_NEW', reason: 'CHANNEL_BOUNDARY', newTurnSealed: false };
  }

  // 3. Hard elapsed-time / message-count limits.
  const elapsed = incoming.receivedAt.getTime() - open.firstMessageAt.getTime();
  if (elapsed >= limits.maxAssemblyMs || open.messageCount >= limits.maxMessageCount) {
    return { action: 'SEAL_OPEN_THEN_NEW', reason: 'HARD_LIMIT', newTurnSealed: false };
  }

  // The quiet deadline already passed: the sealer should have sealed it; treat as a boundary.
  if (incoming.receivedAt.getTime() > open.quietDeadlineAt.getTime()) {
    return { action: 'SEAL_OPEN_THEN_NEW', reason: 'QUIET_WINDOW_ELAPSED', newTurnSealed: false };
  }

  const newQuietDeadlineAt = quietDeadlineFor(incoming.receivedAt, limits, open.hardDeadlineAt);

  // 5. Bounded model-assisted classifier, only where deterministic signals are inconclusive.
  if (options.classifierEnabled && looksLikeTopicSwitch(incoming.text)) {
    return { action: 'UNCERTAIN', newQuietDeadlineAt };
  }

  // 4. Deterministic continuation: inside the window, same channel, no retraction → same turn.
  return { action: 'APPEND', reason: 'CONTINUATION', newQuietDeadlineAt };
}
