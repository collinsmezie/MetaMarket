import { Annotation } from '@langchain/langgraph';
import type { Response } from '../../../domain/models/response';
import type { ConversationWorkingContext, TurnInputState } from '../../../conversation/domain/turn-context';
import type { IDCEResolution } from '../../../intent/domain/idce-resolution';
import type { CSREResolution } from '../../../semantics/domain/csre-resolution';
import type { EnrichmentResolution } from '../../../enrichment/domain/enrichment-resolution';
import type { GpcResolution } from '../../../taxonomy/domain/gpc-mapping';
import type { ExecutionPlanState, ExecutionState, ResponseArtifact } from '../../domain/action-plan';
import { EMPTY_EXECUTION, EMPTY_PLAN } from '../../domain/action-plan';
import { EMPTY_UNDERSTANDING, type UnderstandingState } from '../../domain/unified-understanding';

/**
 * LangGraph state for the conversation orchestrator (MCOS TDR §7–§9).
 *
 * Bounded orchestration state for one logical turn inside a conversation-scoped thread
 * (`thread_id = conversation:{id}`, `run_id = turn:{turnId}`). Everything here is plain JSON so
 * it survives the Postgres checkpointer; MCOS tables remain the only owner of business truth.
 * Every channel replaces on update — a turn explicitly initialises the whole envelope (§8.2), so
 * nothing from a previous turn can leak into the next one. The two specialist slots are separate
 * channels because IDCE and CSRE write them concurrently (§65.3); no channel is appended to, so
 * parallel writers never race.
 */

/** `ConversationWorkingContext` with the pending clarification's dates as ISO strings. */
export interface GraphWorkingContext extends Omit<ConversationWorkingContext, 'pendingClarification'> {
  readonly pendingClarification: PendingClarificationView | null;
}

export interface PendingClarificationView {
  readonly clarificationId: string;
  readonly originatingTurnId: string;
  readonly question: string;
  readonly targetActionIds: readonly string[];
  readonly targetIntentIds: readonly string[];
  readonly blocking: boolean;
  readonly status: string;
  readonly issueKey: string | null;
  readonly askedAt: string;
  readonly expectedResolution: string | null;
}

export type FastPathKind = 'NONE' | 'EMPTY_INPUT' | 'VENDOR_RESPONSE' | 'WORKFLOW_ACTION' | 'SYSTEM_ACTION';

export interface FastPathState {
  readonly kind: FastPathKind;
  readonly workflowId: string | null;
  readonly workflowType: string | null;
  readonly action: string | null;
  readonly legacyIntent: string | null;
}

export const NO_FAST_PATH: FastPathState = {
  kind: 'NONE',
  workflowId: null,
  workflowType: null,
  action: null,
  legacyIntent: null,
};

/** One specialist's validated result for this turn (MCOS §63.6 failure contract). */
export interface SpecialistSlot<T> {
  readonly status: 'PENDING' | 'SUCCESS' | 'PARTIAL' | 'ERROR' | 'SKIPPED';
  readonly output: T | null;
  readonly requestId: string | null;
  readonly error: { code: string; message: string } | null;
}

export const PENDING_SLOT = { status: 'PENDING', output: null, requestId: null, error: null } as const;

export interface ClarificationState {
  readonly clarificationId: string | null;
  readonly question: string | null;
  readonly issueKey: string | null;
  readonly targetActionIds: readonly string[];
  readonly targetIntentIds: readonly string[];
  readonly blocking: boolean;
  readonly outcome: 'ASKED' | 'ALREADY_ACTIVE' | 'LOOP_PREVENTED' | 'NOT_NEEDED' | 'DECLINED';
  readonly source: 'IDCE' | 'CSRE' | 'P4' | 'PLAN' | 'NONE';
  /** Whether the bound pending clarification of a previous turn was resolved by this turn. */
  readonly resolvedPrevious: boolean;
}

export interface ResponseState {
  readonly composed: Response | null;
  readonly delivered: boolean;
  readonly source: 'DETERMINISTIC' | 'P5_P6' | 'FAST_PATH' | 'FALLBACK' | 'NONE';
}

export interface RecoveryRecord {
  readonly node: string;
  readonly code: string;
  readonly message: string;
}

export type GraphLifecycleStatus = 'RUNNING' | 'COMMITTED' | 'PARTIAL' | 'WAITING_USER' | 'FAILED';

export interface LifecycleState {
  readonly status: GraphLifecycleStatus;
  readonly nodes: readonly string[];
}

const replace = <T>(_existing: T, update: T): T => update;

export const ConversationGraphState = Annotation.Root({
  conversationId: Annotation<string>({ reducer: replace, default: () => '' }),
  turnId: Annotation<string>({ reducer: replace, default: () => '' }),
  runId: Annotation<string>({ reducer: replace, default: () => '' }),
  input: Annotation<TurnInputState | null>({ reducer: replace, default: () => null }),
  context: Annotation<GraphWorkingContext | null>({ reducer: replace, default: () => null }),
  /** Assembled text after fast-path resolution (replayed suggestion label, numbered option). */
  effectiveText: Annotation<string>({ reducer: replace, default: () => '' }),
  /** Interactive payload still meaningful to workflows (a replayed suggestion is consumed as text). */
  effectivePayload: Annotation<string | null>({ reducer: replace, default: () => null }),
  fastPath: Annotation<FastPathState>({ reducer: replace, default: () => NO_FAST_PATH }),
  idce: Annotation<SpecialistSlot<IDCEResolution>>({ reducer: replace, default: () => PENDING_SLOT }),
  csre: Annotation<SpecialistSlot<CSREResolution>>({ reducer: replace, default: () => PENDING_SLOT }),
  /** Downstream semantic enrichment of the CSRE objects (MCOS §38), recorded when it settles. */
  enrichment: Annotation<SpecialistSlot<EnrichmentResolution>>({
    reducer: replace,
    default: () => PENDING_SLOT,
  }),
  /** Sovereign GPC mapping of the enriched objects (MCOS §38, §63.4), recorded when it settles. */
  gpc: Annotation<SpecialistSlot<GpcResolution>>({ reducer: replace, default: () => PENDING_SLOT }),
  understanding: Annotation<UnderstandingState>({ reducer: replace, default: () => EMPTY_UNDERSTANDING }),
  plan: Annotation<ExecutionPlanState>({ reducer: replace, default: () => EMPTY_PLAN }),
  execution: Annotation<ExecutionState>({ reducer: replace, default: () => EMPTY_EXECUTION }),
  artifacts: Annotation<readonly ResponseArtifact[]>({ reducer: replace, default: () => [] }),
  clarification: Annotation<ClarificationState | null>({ reducer: replace, default: () => null }),
  response: Annotation<ResponseState>({
    reducer: replace,
    default: () => ({ composed: null, delivered: false, source: 'NONE' }),
  }),
  recovery: Annotation<readonly RecoveryRecord[]>({ reducer: replace, default: () => [] }),
  lifecycle: Annotation<LifecycleState>({
    reducer: replace,
    default: () => ({ status: 'RUNNING', nodes: [] }),
  }),
});

export type ConversationGraphStateType = typeof ConversationGraphState.State;
export type ConversationGraphUpdate = typeof ConversationGraphState.Update;

/** Config key under which the per-run non-serializable context is looked up. */
export const RUN_CONTEXT_KEY = 'mcosRunContextKey';
