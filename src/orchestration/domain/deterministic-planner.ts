import type { DiscoveredIntent } from '../../intent/domain/idce-resolution';
import type { ExecutionPlanState, PlannedAction, PlanEdge } from './action-plan';
import {
  CONTROL_INTENTS,
  PLATFORM_REPLY_INTENTS,
  capabilityForIntent,
  type WorkflowCapability,
  type WorkflowOperation,
} from './capability-catalogue';
import type { ContinuityDecision } from './continuity-decision';
import type { IntentObjectBinding } from './unified-understanding';

/**
 * Deterministic planner (MCOS TDR §16, §34, §34A.10 "simple deterministic interaction → no
 * orchestration prompt", §44 "planning failure → deterministic fallback if obvious").
 *
 * Builds the execution plan without a model whenever the understanding maps unambiguously onto
 * the capability catalogue: every intent has exactly one capability, dependencies come straight
 * from IDCE's execution relations, and continuity picks the operation. Anything richer goes to
 * P3, whose proposal is validated against the same catalogue.
 */

export interface PlannerInput {
  readonly conversationId: string;
  readonly userId: string;
  readonly intents: readonly DiscoveredIntent[];
  readonly bindings: readonly IntentObjectBinding[];
  readonly continuity: ContinuityDecision | null;
  readonly activeWorkflows: readonly { workflowId: string; workflowType: string; status: string }[];
  readonly suspendedWorkflows: readonly { workflowId: string; workflowType: string; status: string }[];
  readonly availableWorkflowTypes: ReadonlySet<string>;
  /** Intents the gate already decided need the user before they can run. */
  readonly needsUserIntentIds: ReadonlySet<string>;
}

/** Intents the deterministic planner turns into actions; the rest are platform replies or control. */
function plannable(intent: DiscoveredIntent): boolean {
  return (
    !PLATFORM_REPLY_INTENTS.has(intent.type) &&
    !(CONTROL_INTENTS.has(intent.type) && intent.type !== 'CANCEL' && intent.type !== 'RESUME')
  );
}

/**
 * True when every plannable intent resolves to one available capability and no intent carries a
 * relation the planner would have to interpret beyond DEPENDS_ON/REQUIRES/PRECEDES.
 */
export function canPlanDeterministically(input: PlannerInput): boolean {
  const intents = input.intents.filter(plannable);
  if (intents.length === 0) return true;
  return intents.every((intent) => {
    const capability = capabilityForIntent(intent.type);
    const control = intent.type === 'CANCEL' || intent.type === 'RESUME';
    return control || (capability !== null && input.availableWorkflowTypes.has(capability.workflowType));
  });
}

export function buildDeterministicPlan(input: PlannerInput): ExecutionPlanState {
  const intents = input.intents.filter(plannable);
  const actions: PlannedAction[] = [];
  const edges: PlanEdge[] = [];
  const actionIdByIntent = new Map<string, string>();
  const all = [...input.activeWorkflows, ...input.suspendedWorkflows];

  // One action per capability per turn: "I need a generator, how much is it and who sells one"
  // is three intents but one BuyerSearch action carrying all three objectives (§16 rule 1 allows
  // one-or-more; the legacy workflows serve the whole demand in one instance).
  const byCapability = new Map<
    string,
    { capability: WorkflowCapability | null; intents: DiscoveredIntent[]; control: boolean }
  >();
  for (const intent of intents) {
    const control = intent.type === 'CANCEL' || intent.type === 'RESUME';
    const capability = control ? null : capabilityForIntent(intent.type);
    const key = control
      ? `control:${intent.type}`
      : (capability?.workflowType ?? `unsupported:${intent.type}`);
    const group = byCapability.get(key) ?? { capability, intents: [], control };
    group.intents.push(intent);
    byCapability.set(key, group);
  }

  let index = 0;
  for (const [key, group] of byCapability) {
    index += 1;
    const actionId = `a${index}`;
    const lead = group.intents.find((intent) => intent.role === 'PRIMARY') ?? group.intents[0]!;
    for (const intent of group.intents) actionIdByIntent.set(intent.intentId, actionId);

    const related =
      input.continuity?.relationships.filter(
        (relationship) =>
          relationship.intentIds.some((id) => group.intents.some((intent) => intent.intentId === id)) ||
          relationship.intentIds.length === 0,
      ) ?? [];
    const targetWorkflowIds = [
      ...new Set([...lead.scope.workflowIds, ...related.flatMap((relationship) => relationship.workflowIds)]),
    ].filter((workflowId) => all.some((workflow) => workflow.workflowId === workflowId));

    const objectIds = [
      ...new Set(
        group.intents.flatMap(
          (intent) => input.bindings.find((binding) => binding.intentId === intent.intentId)?.objectIds ?? [],
        ),
      ),
    ];

    if (group.control) {
      const target =
        targetWorkflowIds[0] ??
        input.activeWorkflows[0]?.workflowId ??
        input.suspendedWorkflows[0]?.workflowId ??
        null;
      const targetType =
        target === null
          ? null
          : (all.find((workflow) => workflow.workflowId === target)?.workflowType ?? null);
      actions.push({
        actionId,
        intentId: lead.intentId,
        workflowType: targetType,
        operation: lead.type === 'CANCEL' ? 'CANCEL' : 'RESUME',
        scope: { type: 'WORKFLOW', objectIds: [], workflowIds: target === null ? [] : [target] },
        dependencies: [],
        concurrencyKey: `conversation:${input.conversationId}`,
        stateConflictKeys: [
          `conversation:${input.conversationId}`,
          ...(target === null ? [] : [`workflow:${target}`]),
        ],
        prerequisites: [],
        priority: lead.priority,
        status: target === null ? 'UNSUPPORTED' : 'READY',
        needsUser: false,
      });
      continue;
    }

    const capability = group.capability;
    if (capability === null || !input.availableWorkflowTypes.has(capability.workflowType)) {
      actions.push({
        actionId,
        intentId: lead.intentId,
        workflowType: null,
        operation: 'START',
        scope: { type: 'OBJECT', objectIds, workflowIds: [] },
        dependencies: [],
        concurrencyKey: null,
        stateConflictKeys: [],
        prerequisites: [],
        priority: lead.priority,
        status: 'UNSUPPORTED',
        needsUser: false,
      });
      continue;
    }

    // Operation from continuity (§15, §29): an existing instance of this capability that the turn
    // continues/resumes/corrects is operated on; otherwise the capability starts new work.
    const existing =
      targetWorkflowIds
        .map((workflowId) => all.find((workflow) => workflow.workflowId === workflowId))
        .find((workflow) => workflow !== undefined && workflow.workflowType === capability.workflowType) ??
      null;
    const kind = input.continuity?.primary ?? 'NO_WORKFLOW_CONTEXT';
    let operation: WorkflowOperation = 'START';
    if (existing !== null) {
      operation =
        kind === 'RESUME' || existing.status === 'suspended'
          ? 'RESUME'
          : kind === 'CORRECTION'
            ? 'MODIFY'
            : kind === 'CANCELLATION'
              ? 'CANCEL'
              : 'CONTINUE';
    } else if (lead.type === 'CONTINUE_VENDOR_ONBOARDING' || lead.type === 'RESUME') {
      const open = all.find((workflow) => workflow.workflowType === capability.workflowType);
      if (open !== undefined) {
        operation = open.status === 'suspended' ? 'RESUME' : 'CONTINUE';
        targetWorkflowIds.push(open.workflowId);
      }
    }
    if (!capability.operations.includes(operation)) operation = 'START';

    // Only an instance of this capability may be operated on: a DIGRESSION away from an
    // onboarding must not hand the platform-info action the onboarding's id (§21, §16).
    const workflowId =
      existing?.workflowId ??
      targetWorkflowIds.find(
        (id) => all.find((workflow) => workflow.workflowId === id)?.workflowType === capability.workflowType,
      ) ??
      null;
    const needsUser = group.intents.some((intent) => input.needsUserIntentIds.has(intent.intentId));
    actions.push({
      actionId,
      intentId: lead.intentId,
      workflowType: capability.workflowType,
      operation,
      scope: {
        type: workflowId !== null ? 'WORKFLOW' : objectIds.length > 0 ? 'OBJECT' : lead.scope.type,
        objectIds,
        workflowIds: workflowId === null ? [] : [workflowId],
      },
      dependencies: [],
      concurrencyKey: `conversation:${input.conversationId}`,
      stateConflictKeys: [
        ...capability.conflictKeys({
          conversationId: input.conversationId,
          userId: input.userId,
          workflowId,
        }),
      ],
      prerequisites: [],
      priority: Math.max(...group.intents.map((intent) => intent.priority)),
      status: needsUser ? 'NEEDS_USER' : 'READY',
      needsUser,
    });
    void key;
  }

  // Dependencies from IDCE execution relations, projected onto actions (§16 example: price
  // inquiry depends on the search).
  for (const intent of intents) {
    const from = actionIdByIntent.get(intent.intentId);
    if (from === undefined) continue;
    for (const dependency of intent.dependencies) {
      const to = actionIdByIntent.get(dependency);
      if (to !== undefined && to !== from && !edges.some((edge) => edge.from === from && edge.to === to)) {
        edges.push({ from, type: 'DEPENDS_ON', to });
      }
    }
  }

  const withDependencies = actions.map((action) => ({
    ...action,
    dependencies: edges
      .filter((edge) => edge.type === 'DEPENDS_ON' && edge.from === action.actionId)
      .map((edge) => edge.to),
  }));

  return {
    actions: withDependencies,
    edges,
    status: withDependencies.some((action) => action.status === 'READY')
      ? 'READY'
      : withDependencies.length === 0
        ? 'COMPLETED'
        : 'BLOCKED',
    source: 'DETERMINISTIC',
  };
}
