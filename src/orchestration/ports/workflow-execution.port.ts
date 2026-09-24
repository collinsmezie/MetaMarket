import type { ConversationWorkingContext, TurnInputState } from '../../conversation/domain/turn-context';
import type { DiscoveredIntent } from '../../intent/domain/idce-resolution';
import type { SemanticObject } from '../../semantics/domain/csre-resolution';
import type { ActionExecutionResult, PlannedAction } from '../domain/action-plan';
import type { ContinuityDecision } from '../domain/continuity-decision';

export const WORKFLOW_EXECUTION = Symbol('WorkflowExecution');

/**
 * Everything the workflow boundary may see for one planned action (MCOS TDR §22, §63.5).
 *
 * The action names the capability, operation and scope; the understanding is supplied as
 * validated contracts, never as raw model output. The executor resolves the workflow instance
 * (registry lookup, §21), builds the workflow trigger and lets the deterministic engine perform
 * every transition.
 */
export interface WorkflowActionInput {
  readonly action: PlannedAction;
  readonly turn: TurnInputState;
  readonly context: ConversationWorkingContext;
  /** Action-scoped text: what the user said about this objective. */
  readonly text: string;
  readonly interactivePayload: string | null;
  readonly intents: readonly DiscoveredIntent[];
  readonly objects: readonly SemanticObject[];
  readonly continuity: ContinuityDecision | null;
  readonly answeringClarification: boolean;
  /** Legacy starting-intent label override (system actions, handoffs). */
  readonly legacyIntentOverride: string | null;
  readonly now: Date;
}

export interface WorkflowExecutionPort {
  execute(input: WorkflowActionInput): Promise<ActionExecutionResult>;
}
