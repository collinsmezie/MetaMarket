import type { Response } from '../../domain/models/response';
import type { ConversationTurnSummary } from '../domain/logical-turn';
import type { ConversationWorkingContext, TurnInputState } from '../domain/turn-context';

export const TURN_ORCHESTRATOR = Symbol('TurnOrchestrator');

/**
 * Result of orchestrating one logical turn (MCOS TDR §10 "COMMIT TURN OUTCOME", §63.9).
 *
 * `status` is the turn's durable outcome. Delivery has already been durably accepted by the
 * delivery subsystem before this is returned (MCOS §46): graph completion ≠ delivery, but turn
 * commit requires the outbound command to be accepted.
 */
export interface TurnOutcome {
  readonly status: 'COMMITTED' | 'PARTIAL' | 'WAITING_USER' | 'FAILED';
  readonly responses: readonly Response[];
  readonly responseIds: readonly string[];
  readonly workflowIds: readonly string[];
  readonly intentTypes: readonly string[];
  readonly objectIds: readonly string[];
  readonly summary: string;
  readonly error: { code: string; message: string; retryable: boolean } | null;
}

/**
 * The MCOS → orchestrator seam (MCOS §57 "external seam", §63).
 *
 * MCOS calls this exactly once per sealed logical turn, with the conversation lock held and the
 * latest committed business state loaded into the working context. The implementation is the
 * LangGraph conversation orchestrator; during migration it is an adapter over the legacy core.
 */
export interface TurnOrchestratorPort {
  runTurn(input: TurnInputState, context: ConversationWorkingContext): Promise<TurnOutcome>;
}

export function summaryFromOutcome(turnId: string, outcome: TurnOutcome): ConversationTurnSummary {
  return {
    turnId,
    outcome: outcome.status,
    intentTypes: outcome.intentTypes,
    objectIds: outcome.objectIds,
    workflowIds: outcome.workflowIds,
    summary: outcome.summary,
  };
}
