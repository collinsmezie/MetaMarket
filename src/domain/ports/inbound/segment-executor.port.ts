import type { Artifact } from '../../models/artifact';
import type { Conversation } from '../../models/conversation';
import type { WorkflowExecutionOutcome } from '../../workflows/workflow-engine';

/**
 * Runs one segment of a message through understanding, routing and execution.
 *
 * This is the unit of work both conversation cores share (Conversation-Core-Comparison TDR
 * §4.5). What differs between them is how the segments are *driven* — a sequential loop on one
 * branch, a checkpointed graph on the other — not what happens inside one.
 *
 * The seam is a port rather than an extracted service on purpose. Pulling the body out of the
 * turn processor would move discovery, routing, suspension policy and workflow lifecycle with
 * it — several hundred lines of working, tested behaviour — for no benefit to either core. A
 * port gives the graph a typed dependency without that risk, and it keeps the comparison
 * focused on orchestration, which is the variable under test.
 */

export const SEGMENT_EXECUTOR = Symbol('SegmentExecutor');

export interface SegmentExecutionInput {
  /**
   * The conversation as the *previous* segment left it. Segments must not share a snapshot:
   * routing against a stale registry resumes a workflow that is no longer in focus.
   */
  readonly conversation: Conversation;
  readonly segment: { readonly text: string; readonly summary: string; readonly index: number };
  readonly artifacts: readonly Artifact[];
  readonly interactivePayload: string | null;
  readonly now: Date;
}

export type SegmentExecutionResult =
  | { readonly outcome: WorkflowExecutionOutcome }
  /** Nothing could serve this segment; the caller decides whether the whole turn fails. */
  | { readonly unroutable: string };

export interface SegmentExecutorPort {
  executeSegment(input: SegmentExecutionInput): Promise<SegmentExecutionResult>;
}
