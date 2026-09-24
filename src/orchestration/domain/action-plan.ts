import type { Response } from '../../domain/models/response';
import {
  capabilityForWorkflowType,
  WORKFLOW_OPERATIONS,
  type WorkflowOperation,
} from './capability-catalogue';

/**
 * Planning and execution contracts (MCOS TDR §9.2–§9.3, §16, §23, §27, §63.9).
 *
 * The planner proposes; the deterministic layer validates, schedules and executes. Nothing here
 * mutates business state — actions are executed only through `WorkflowExecutionPort` (§22).
 */

export type ActionStatus = 'READY' | 'BLOCKED' | 'NEEDS_USER' | 'UNSUPPORTED';

export interface ActionScope {
  readonly type: string;
  readonly objectIds: readonly string[];
  readonly workflowIds: readonly string[];
}

export interface PlannedAction {
  readonly actionId: string;
  readonly intentId: string;
  readonly workflowType: string | null;
  readonly operation: WorkflowOperation | string;
  readonly scope: ActionScope;
  readonly dependencies: readonly string[];
  readonly concurrencyKey: string | null;
  readonly stateConflictKeys: readonly string[];
  readonly prerequisites: readonly string[];
  readonly priority: number;
  readonly status: ActionStatus;
  readonly needsUser: boolean;
}

export type PlanEdgeType = 'DEPENDS_ON' | 'PRECEDES' | 'BLOCKED_BY';

export interface PlanEdge {
  readonly from: string;
  readonly type: PlanEdgeType;
  readonly to: string;
}

export type PlanStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'BLOCKED' | 'COMPLETED' | 'PARTIAL' | 'FAILED';

export interface ExecutionPlanState {
  readonly actions: readonly PlannedAction[];
  readonly edges: readonly PlanEdge[];
  readonly status: PlanStatus;
  readonly source: 'DETERMINISTIC' | 'P3' | 'FAST_PATH' | 'NONE';
}

export const EMPTY_PLAN: ExecutionPlanState = { actions: [], edges: [], status: 'DRAFT', source: 'NONE' };

/** Domain-provided response action (MCOS §63.9), aligned with the canonical `Response.actions`. */
export interface SuggestedAction {
  readonly type: string;
  readonly title: string;
  readonly payload: string;
  readonly description?: string;
}

export interface ResponseArtifact {
  readonly actionId: string;
  readonly relevance: number;
  readonly priority: number;
  readonly text: string;
  readonly actions: readonly SuggestedAction[];
  readonly media: Response['media'];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly audience: 'USER';
  readonly dependencies: readonly string[];
  readonly status: 'READY' | 'BLOCKED';
}

export interface BlockingIssue {
  readonly code: string;
  readonly message: string;
  readonly issueKey: string | null;
}

export type ActionResultStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'BLOCKED' | 'SKIPPED' | 'NEEDS_USER';

export interface ActionExecutionResult {
  readonly actionId: string;
  readonly status: ActionResultStatus;
  readonly businessStateChanged: boolean;
  readonly workflowId: string | null;
  readonly workflowType: string | null;
  readonly responseArtifacts: readonly ResponseArtifact[];
  readonly emittedEventTypes: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly blockingIssues: readonly BlockingIssue[];
  /** Workflows this action parked to make room for new work (MCOS §16), for the resume nudge (§28). */
  readonly suspendedWorkflowIds: readonly string[];
  readonly error: { code: string; message: string } | null;
}

export interface ExecutionState {
  readonly completedActionIds: readonly string[];
  readonly runningActionIds: readonly string[];
  readonly failedActionIds: readonly string[];
  readonly skippedActionIds: readonly string[];
  readonly results: readonly ActionExecutionResult[];
}

export const EMPTY_EXECUTION: ExecutionState = {
  completedActionIds: [],
  runningActionIds: [],
  failedActionIds: [],
  skippedActionIds: [],
  results: [],
};

export interface PlanViolation {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * Deterministic validation of a proposed plan (P3 rules 2–8; §16–§18): unique action ids,
 * intents that exist, capabilities that exist and support the operation, dependencies that
 * resolve, and an acyclic dependency graph.
 */
export function validatePlan(
  plan: { actions: readonly PlannedAction[]; edges: readonly PlanEdge[] },
  knownIntentIds: ReadonlySet<string>,
  knownWorkflowTypes: ReadonlySet<string>,
): PlanViolation[] {
  const violations: PlanViolation[] = [];
  const ids = new Set<string>();

  plan.actions.forEach((action, index) => {
    const base = `/actions/${index}`;
    if (ids.has(action.actionId))
      violations.push(
        violation(`${base}/action_id`, 'unique_action_id', `Duplicate action_id "${action.actionId}"`),
      );
    ids.add(action.actionId);

    if (!knownIntentIds.has(action.intentId)) {
      violations.push(
        violation(
          `${base}/intent_id`,
          'unknown_intent',
          `intent_id "${action.intentId}" is not an intent of this turn`,
          { known: [...knownIntentIds] },
        ),
      );
    }

    if (action.workflowType !== null) {
      const capability = capabilityForWorkflowType(action.workflowType);
      if (capability === null || !knownWorkflowTypes.has(action.workflowType)) {
        violations.push(
          violation(
            `${base}/workflow_type`,
            'unknown_capability',
            `"${action.workflowType}" is not an available workflow capability`,
            { available: [...knownWorkflowTypes] },
          ),
        );
      } else if (
        !(WORKFLOW_OPERATIONS as readonly string[]).includes(action.operation) ||
        !capability.operations.includes(action.operation as WorkflowOperation)
      ) {
        violations.push(
          violation(
            `${base}/operation`,
            'unsupported_operation',
            `"${action.workflowType}" does not support operation "${action.operation}"`,
            { supported: capability.operations },
          ),
        );
      }
    }
    if (action.status === 'NEEDS_USER' && !action.needsUser) {
      violations.push(
        violation(
          `${base}/needs_user`,
          'needs_user_consistency',
          'status NEEDS_USER requires needs_user true',
        ),
      );
    }
  });

  plan.actions.forEach((action, index) => {
    action.dependencies.forEach((dependency) => {
      if (!ids.has(dependency))
        violations.push(
          violation(
            `/actions/${index}/dependencies`,
            'dangling_dependency',
            `Unknown dependency "${dependency}"`,
          ),
        );
      if (dependency === action.actionId)
        violations.push(
          violation(`/actions/${index}/dependencies`, 'self_dependency', 'An action cannot depend on itself'),
        );
    });
  });
  plan.edges.forEach((edge, index) => {
    if (!ids.has(edge.from) || !ids.has(edge.to))
      violations.push(
        violation(
          `/edges/${index}`,
          'dangling_edge',
          `Edge references unknown action (${edge.from} → ${edge.to})`,
        ),
      );
  });

  if (hasCycle(plan.actions, plan.edges)) {
    violations.push(violation('/actions', 'acyclic_dependencies', 'Action dependencies form a cycle'));
  }

  return violations;
}

/** Effective predecessor set: declared dependencies plus DEPENDS_ON / BLOCKED_BY / PRECEDES edges. */
export function predecessorsOf(action: PlannedAction, edges: readonly PlanEdge[]): ReadonlySet<string> {
  const predecessors = new Set<string>(action.dependencies);
  for (const edge of edges) {
    if ((edge.type === 'DEPENDS_ON' || edge.type === 'BLOCKED_BY') && edge.from === action.actionId)
      predecessors.add(edge.to);
    if (edge.type === 'PRECEDES' && edge.to === action.actionId) predecessors.add(edge.from);
  }
  predecessors.delete(action.actionId);
  return predecessors;
}

export function hasCycle(actions: readonly PlannedAction[], edges: readonly PlanEdge[]): boolean {
  const state = new Map<string, 'visiting' | 'done'>();
  const byId = new Map(actions.map((action) => [action.actionId, action]));
  const visit = (id: string): boolean => {
    const mark = state.get(id);
    if (mark === 'visiting') return true;
    if (mark === 'done') return false;
    state.set(id, 'visiting');
    const action = byId.get(id);
    if (action !== undefined) {
      for (const predecessor of predecessorsOf(action, edges)) {
        if (byId.has(predecessor) && visit(predecessor)) return true;
      }
    }
    state.set(id, 'done');
    return false;
  };
  return actions.some((action) => visit(action.actionId));
}

/** P3 wire → domain (snake_case per MCOS §63.7). */
export function planFromWire(
  wire: Record<string, unknown>,
  source: ExecutionPlanState['source'],
): ExecutionPlanState {
  const actions = ((wire.actions as Array<Record<string, unknown>>) ?? []).map((action) => {
    const scope = (action.scope ?? {}) as Record<string, unknown>;
    return {
      actionId: String(action.action_id),
      intentId: String(action.intent_id),
      workflowType: (action.workflow_type as string | null) ?? null,
      operation: String(action.operation),
      scope: {
        type: String(scope.type ?? 'OBJECT'),
        objectIds: Array.isArray(scope.object_ids) ? (scope.object_ids as unknown[]).map(String) : [],
        workflowIds: Array.isArray(scope.workflow_ids) ? (scope.workflow_ids as unknown[]).map(String) : [],
      },
      dependencies: ((action.dependencies as unknown[]) ?? []).map(String),
      concurrencyKey: (action.concurrency_key as string | null) ?? null,
      stateConflictKeys: ((action.state_conflict_keys as unknown[]) ?? []).map(String),
      prerequisites: ((action.prerequisites as unknown[]) ?? []).map(String),
      priority: Number(action.priority ?? 0.5),
      status: String(action.status ?? 'READY') as ActionStatus,
      needsUser: action.needs_user === true,
    };
  });
  const edges = ((wire.edges as Array<Record<string, unknown>>) ?? []).map((edge) => ({
    from: String(edge.from),
    type: String(edge.type) as PlanEdgeType,
    to: String(edge.to),
  }));
  const status = (wire.status as PlanStatus | undefined) ?? 'READY';
  return { actions, edges, status: status === 'DRAFT' ? 'READY' : status, source };
}

function violation(
  path: string,
  keyword: string,
  message: string,
  params: Record<string, unknown> = {},
): PlanViolation {
  return { path, keyword, message, params };
}
