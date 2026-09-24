import { planFromWire, validatePlan, type PlannedAction } from './action-plan';

const action = (id: string, overrides: Partial<PlannedAction> = {}): PlannedAction => ({
  actionId: id,
  intentId: 'i1',
  workflowType: 'BuyerSearch',
  operation: 'START',
  scope: { type: 'OBJECT', objectIds: [], workflowIds: [] },
  dependencies: [],
  concurrencyKey: null,
  stateConflictKeys: [],
  prerequisites: [],
  priority: 0.5,
  status: 'READY',
  needsUser: false,
  ...overrides,
});

const available = new Set(['BuyerSearch', 'VendorOnboarding', 'PlatformInfo']);

describe('validatePlan', () => {
  it('accepts a plan whose actions bind known intents to available capabilities', () => {
    const plan = {
      actions: [
        action('a1'),
        action('a2', { intentId: 'i2', workflowType: 'PlatformInfo', dependencies: ['a1'] }),
      ],
      edges: [],
    };
    expect(validatePlan(plan, new Set(['i1', 'i2']), available)).toEqual([]);
  });

  it('rejects invented capabilities, unsupported operations, unknown intents and cycles', () => {
    const plan = {
      actions: [
        action('a1', { workflowType: 'Payments' }),
        action('a1', {
          intentId: 'ghost',
          workflowType: 'PlatformInfo',
          operation: 'CANCEL',
          dependencies: ['a2'],
        }),
        action('a2', { dependencies: ['a1'] }),
      ],
      edges: [{ from: 'a2', type: 'DEPENDS_ON' as const, to: 'a9' }],
    };
    const keywords = validatePlan(plan, new Set(['i1']), available).map((violation) => violation.keyword);
    expect(keywords).toEqual(
      expect.arrayContaining([
        'unknown_capability',
        'unique_action_id',
        'unknown_intent',
        'unsupported_operation',
        'dangling_edge',
        'acyclic_dependencies',
      ]),
    );
  });
});

describe('planFromWire', () => {
  it('maps the snake_case P3 payload onto the domain plan', () => {
    const plan = planFromWire(
      {
        status: 'DRAFT',
        actions: [
          {
            action_id: 'a1',
            intent_id: 'i1',
            workflow_type: 'BuyerSearch',
            operation: 'START',
            scope: { type: 'OBJECT', object_ids: ['object_1'], workflow_ids: [] },
            dependencies: [],
            concurrency_key: 'conversation:c1',
            state_conflict_keys: ['conversation:c1'],
            prerequisites: [],
            priority: 0.9,
            status: 'READY',
            needs_user: false,
          },
        ],
        edges: [{ from: 'a1', type: 'PRECEDES', to: 'a1' }],
      },
      'P3',
    );
    expect(plan.source).toBe('P3');
    expect(plan.status).toBe('READY');
    expect(plan.actions[0]).toMatchObject({
      actionId: 'a1',
      workflowType: 'BuyerSearch',
      scope: { objectIds: ['object_1'] },
      priority: 0.9,
    });
    expect(plan.edges[0]).toEqual({ from: 'a1', type: 'PRECEDES', to: 'a1' });
  });
});
