import { Annotation } from '@langchain/langgraph';
import type { Response } from '../../domain/models/response';
import type { DomainEvent } from '../../domain/ports/outbound/event-publisher.port';

/**
 * State of one turn as it moves through the supervisor graph.
 *
 * Everything here must survive a round trip through the Postgres checkpointer, so it holds
 * only plain data. The turn's non-serializable context — the incoming message, the loaded
 * conversation, the clock reading — is resolved from an in-process registry by key
 * ({@link TURN_CONTEXT_KEY}); putting a `Date` or a Prisma-loaded aggregate in checkpointed
 * state would either fail to serialize or come back a different shape than it went in.
 */

/** Config key under which a turn's non-serializable context is looked up. */
export const TURN_CONTEXT_KEY = 'mcosTurnContextKey';

export interface GraphSegment {
  readonly text: string;
  readonly summary: string;
  readonly index: number;
}

export const TurnGraphState = Annotation.Root({
  conversationId: Annotation<string>,

  /** The message split into the requests it carries. Written once, by the segment node. */
  segments: Annotation<readonly GraphSegment[]>({
    reducer: (_existing, update) => update,
    default: () => [],
  }),

  /**
   * Index of the next segment to process.
   *
   * An explicit cursor rather than a shrinking queue: the checkpoint then records exactly how
   * far a turn got, so a resumed turn does not re-run a segment whose workflow side effects —
   * a suspended onboarding, a debited wallet — have already been committed.
   */
  cursor: Annotation<number>({
    reducer: (_existing, update) => update,
    default: () => 0,
  }),

  /** Responses gathered so far, in the order the user asked for them. */
  responses: Annotation<readonly Response[]>({
    reducer: (existing, update) => [...existing, ...update],
    default: () => [],
  }),

  events: Annotation<readonly DomainEvent[]>({
    reducer: (existing, update) => [...existing, ...update],
    default: () => [],
  }),

  /** The workflow that owned the most recently served segment. */
  lastWorkflowId: Annotation<string | null>({
    reducer: (existing, update) => update ?? existing,
    default: () => null,
  }),

  failed: Annotation<boolean>({
    reducer: (existing, update) => existing || update,
    default: () => false,
  }),

  /** Why a segment could not be served. Retained for the fallback envelope's reason. */
  unroutable: Annotation<string | null>({
    reducer: (existing, update) => update ?? existing,
    default: () => null,
  }),
});

export type TurnGraphStateType = typeof TurnGraphState.State;
