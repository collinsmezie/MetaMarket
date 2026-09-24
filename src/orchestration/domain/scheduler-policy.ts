import { capabilityForWorkflowType } from './capability-catalogue';
import { predecessorsOf, type ExecutionState, type PlanEdge, type PlannedAction } from './action-plan';

/**
 * Dependency-aware scheduler policy (MCOS TDR §17–§18, §24).
 *
 *   Parallelize independent work; serialize state-conflicting work.
 *
 * An action joins the next batch only when every predecessor completed, and it may share the
 * batch with another action only when neither touches a common mutable conflict key and both
 * capabilities declare themselves parallel-safe. A failed predecessor skips its dependents
 * (§24: only dependency-blocked actions are skipped); everything else still runs. Every step
 * makes progress: an action that can never run is skipped rather than left pending forever.
 */

export interface ScheduleStep {
  /** Actions to execute now (concurrently when more than one). */
  readonly batch: readonly PlannedAction[];
  /** Actions skipped because a predecessor failed, was skipped or is blocked on the user. */
  readonly skipped: readonly { readonly action: PlannedAction; readonly reason: string }[];
}

const RUNNABLE_STATUSES: ReadonlySet<string> = new Set(['READY']);

export function nextBatch(
  actions: readonly PlannedAction[],
  edges: readonly PlanEdge[],
  execution: ExecutionState,
): ScheduleStep {
  const completed = new Set(execution.completedActionIds);
  const failed = new Set(execution.failedActionIds);
  const skippedBefore = new Set(execution.skippedActionIds);
  const running = new Set(execution.runningActionIds);
  const settled = (id: string) => completed.has(id) || failed.has(id) || skippedBefore.has(id);

  const pending = actions.filter((action) => !settled(action.actionId) && !running.has(action.actionId));

  const skipped: { action: PlannedAction; reason: string }[] = [];
  const skippedNow = new Set<string>();
  const ready: PlannedAction[] = [];
  const skip = (action: PlannedAction, reason: string) => {
    skipped.push({ action, reason });
    skippedNow.add(action.actionId);
  };

  // Fixed point: skipping cascades through dependants within the same step.
  let changed = true;
  while (changed) {
    changed = false;
    for (const action of pending) {
      if (skippedNow.has(action.actionId) || ready.some((entry) => entry.actionId === action.actionId))
        continue;
      if (!RUNNABLE_STATUSES.has(action.status)) {
        skip(action, `Action status ${action.status}`);
        changed = true;
        continue;
      }
      const predecessors = [...predecessorsOf(action, edges)];
      const blockedBy = predecessors.find(
        (id) => failed.has(id) || skippedBefore.has(id) || skippedNow.has(id),
      );
      if (blockedBy !== undefined) {
        skip(action, `Predecessor ${blockedBy} did not complete`);
        changed = true;
        continue;
      }
      if (predecessors.every((id) => completed.has(id))) {
        ready.push(action);
        changed = true;
      }
    }
  }

  // Nothing runnable and nothing skipped while work is still pending means the remaining
  // actions wait on predecessors that will never settle in this run. Guarantee progress.
  if (ready.length === 0 && skipped.length === 0 && running.size === 0) {
    for (const action of pending) skip(action, 'Unschedulable: predecessors never settle');
  }

  ready.sort((a, b) => b.priority - a.priority || a.actionId.localeCompare(b.actionId));

  const batch: PlannedAction[] = [];
  const claimedKeys = new Set<string>();
  for (const action of ready) {
    if (batch.length === 0) {
      batch.push(action);
      action.stateConflictKeys.forEach((key) => claimedKeys.add(key));
      continue;
    }
    const parallelSafe =
      action.workflowType !== null &&
      (capabilityForWorkflowType(action.workflowType)?.parallelSafe ?? false) &&
      batch.every(
        (other) =>
          other.workflowType !== null &&
          (capabilityForWorkflowType(other.workflowType)?.parallelSafe ?? false),
      );
    const conflicts = action.stateConflictKeys.some((key) => claimedKeys.has(key));
    const sameConcurrencyKey =
      action.concurrencyKey !== null && batch.some((other) => other.concurrencyKey === action.concurrencyKey);
    if (parallelSafe && !conflicts && !sameConcurrencyKey) {
      batch.push(action);
      action.stateConflictKeys.forEach((key) => claimedKeys.add(key));
    }
  }

  return { batch, skipped };
}

export function isPlanSettled(actions: readonly PlannedAction[], execution: ExecutionState): boolean {
  const settled = new Set([
    ...execution.completedActionIds,
    ...execution.failedActionIds,
    ...execution.skippedActionIds,
  ]);
  return actions.every((action) => settled.has(action.actionId));
}
