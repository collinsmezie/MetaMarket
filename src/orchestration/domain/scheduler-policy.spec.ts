import { EMPTY_EXECUTION, type ExecutionState, type PlannedAction } from './action-plan';
import { isPlanSettled, nextBatch } from './scheduler-policy';

const action = (id: string, overrides: Partial<PlannedAction> = {}): PlannedAction => ({
  actionId: id,
  intentId: `i-${id}`,
  workflowType: 'BuyerSearch',
  operation: 'START',
  scope: { type: 'OBJECT', objectIds: [], workflowIds: [] },
  dependencies: [],
  concurrencyKey: null,
  stateConflictKeys: ['conversation:c1'],
  prerequisites: [],
  priority: 0.5,
  status: 'READY',
  needsUser: false,
  ...overrides,
});

const executed = (completed: string[], failed: string[] = []): ExecutionState => ({
  ...EMPTY_EXECUTION,
  completedActionIds: completed,
  failedActionIds: failed,
});

describe('nextBatch', () => {
  it('serializes actions that share a mutable conflict key even when nothing depends on anything', () => {
    const step = nextBatch([action('a1'), action('a2')], [], EMPTY_EXECUTION);
    expect(step.batch.map((a) => a.actionId)).toEqual(['a1']);
    expect(step.skipped).toEqual([]);
  });

  it('runs parallel-safe capabilities with disjoint keys in one batch', () => {
    const a1 = action('a1', { workflowType: 'PlatformInfo', stateConflictKeys: ['conversation:c1'] });
    const a2 = action('a2', { workflowType: 'PlatformInfo', stateConflictKeys: ['conversation:c2'] });
    expect(nextBatch([a1, a2], [], EMPTY_EXECUTION).batch.map((a) => a.actionId)).toEqual(['a1', 'a2']);
  });

  it('holds dependants until their predecessors complete, then releases them', () => {
    const plan = [action('a1'), action('a2', { dependencies: ['a1'] })];
    expect(nextBatch(plan, [], EMPTY_EXECUTION).batch.map((a) => a.actionId)).toEqual(['a1']);
    expect(nextBatch(plan, [], executed(['a1'])).batch.map((a) => a.actionId)).toEqual(['a2']);
    expect(isPlanSettled(plan, executed(['a1', 'a2']))).toBe(true);
  });

  it('skips only dependency-blocked actions when a predecessor fails (§24), cascading down the chain', () => {
    const plan = [
      action('a1'),
      action('a2', { dependencies: ['a1'] }),
      action('a3', { dependencies: ['a2'] }),
      action('a4', { workflowType: 'VendorOnboarding', stateConflictKeys: ['vendor-profile:u1'] }),
    ];
    const step = nextBatch(plan, [], executed([], ['a1']));
    expect(step.batch.map((a) => a.actionId)).toEqual(['a4']);
    expect(step.skipped.map((entry) => entry.action.actionId).sort()).toEqual(['a2', 'a3']);
  });

  it('never schedules actions waiting on the user; they settle as skipped', () => {
    const plan = [action('a1', { status: 'NEEDS_USER', needsUser: true }), action('a2')];
    const step = nextBatch(plan, [], EMPTY_EXECUTION);
    expect(step.batch.map((a) => a.actionId)).toEqual(['a2']);
    expect(step.skipped[0]!.action.actionId).toBe('a1');
  });

  it('prefers higher-priority actions first', () => {
    const step = nextBatch(
      [action('a1', { priority: 0.2 }), action('a2', { priority: 0.9 })],
      [],
      EMPTY_EXECUTION,
    );
    expect(step.batch[0]!.actionId).toBe('a2');
  });
});
