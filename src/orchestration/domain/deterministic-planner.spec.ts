import type { DiscoveredIntent } from '../../intent/domain/idce-resolution';
import { buildDeterministicPlan, canPlanDeterministically, type PlannerInput } from './deterministic-planner';

const intent = (id: string, type: string, overrides: Partial<DiscoveredIntent> = {}): DiscoveredIntent => ({
  intentId: id,
  type: type as DiscoveredIntent['type'],
  role: id === 'i1' ? 'PRIMARY' : 'SECONDARY',
  status: 'RESOLVED',
  confidence: 0.9,
  explicitness: 'EXPLICIT',
  priority: 0.8,
  scope: { type: 'OBJECT', objectIds: [], workflowIds: [], conversationScope: false },
  evidence: { explicit: true, implicit: false, contextUsed: false, signals: [] },
  dependencies: [],
  relatedIntents: [],
  constraints: [],
  sourceSpans: [],
  routingHints: [],
  ...overrides,
});

const base = (intents: DiscoveredIntent[], overrides: Partial<PlannerInput> = {}): PlannerInput => ({
  conversationId: 'c1',
  userId: 'u1',
  intents,
  bindings: intents.map((i) => ({
    intentId: i.intentId,
    objectIds: ['object_1'],
    via: 'SINGLE_INTENT' as const,
  })),
  continuity: null,
  activeWorkflows: [],
  suspendedWorkflows: [],
  availableWorkflowTypes: new Set([
    'BuyerSearch',
    'VendorOnboarding',
    'CreditRecharge',
    'PlatformInfo',
    'Triage',
  ]),
  needsUserIntentIds: new Set(),
  ...overrides,
});

describe('deterministic planner', () => {
  it('folds several intents served by one capability into one START action', () => {
    const input = base([
      intent('i1', 'FIND_PRODUCT'),
      intent('i2', 'PRICE_INQUIRY'),
      intent('i3', 'FIND_VENDOR'),
    ]);
    expect(canPlanDeterministically(input)).toBe(true);
    const plan = buildDeterministicPlan(input);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({
      workflowType: 'BuyerSearch',
      operation: 'START',
      status: 'READY',
      scope: { objectIds: ['object_1'] },
    });
    expect(plan.actions[0]!.stateConflictKeys).toContain('conversation:c1');
  });

  it('keeps independent objectives as independent actions and projects IDCE dependencies onto them', () => {
    const input = base([
      intent('i1', 'FIND_SERVICE'),
      intent('i2', 'PLATFORM_INFORMATION'),
      intent('i3', 'RECHARGE_CREDITS', { dependencies: ['i2'] }),
    ]);
    const plan = buildDeterministicPlan(input);
    expect(plan.actions.map((a) => a.workflowType)).toEqual([
      'BuyerSearch',
      'PlatformInfo',
      'CreditRecharge',
    ]);
    expect(plan.edges).toEqual([{ from: 'a3', type: 'DEPENDS_ON', to: 'a2' }]);
    expect(plan.actions[2]!.dependencies).toEqual(['a2']);
    expect(plan.actions[2]!.stateConflictKeys).toContain('wallet:u1');
  });

  it('continues an existing instance when continuity points at it, and resumes a suspended one', () => {
    const active = [{ workflowId: 'wf1', workflowType: 'VendorOnboarding', status: 'active' }];
    const continuation = buildDeterministicPlan(
      base([intent('i1', 'CONTINUE_VENDOR_ONBOARDING')], {
        activeWorkflows: active,
        continuity: {
          primary: 'CONTINUATION',
          relationships: [{ relationship: 'CONTINUATION', intentIds: ['i1'], workflowIds: ['wf1'] }],
          confidence: 1,
          reason: '',
          source: 'DETERMINISTIC',
        },
      }),
    );
    expect(continuation.actions[0]).toMatchObject({
      workflowType: 'VendorOnboarding',
      operation: 'CONTINUE',
      scope: { workflowIds: ['wf1'] },
    });

    const resume = buildDeterministicPlan(
      base([intent('i1', 'RESUME')], {
        suspendedWorkflows: [{ workflowId: 'wf2', workflowType: 'BuyerSearch', status: 'suspended' }],
      }),
    );
    expect(resume.actions[0]).toMatchObject({
      workflowType: 'BuyerSearch',
      operation: 'RESUME',
      scope: { workflowIds: ['wf2'] },
    });
  });

  it('turns CANCEL into a CANCEL action on the focused workflow and marks unsupported objectives', () => {
    const cancel = buildDeterministicPlan(
      base([intent('i1', 'CANCEL')], {
        activeWorkflows: [{ workflowId: 'wf1', workflowType: 'BuyerSearch', status: 'active' }],
      }),
    );
    expect(cancel.actions[0]).toMatchObject({
      operation: 'CANCEL',
      workflowType: 'BuyerSearch',
      scope: { workflowIds: ['wf1'] },
    });

    const unsupported = buildDeterministicPlan(
      base([intent('i1', 'BUY')], { availableWorkflowTypes: new Set(['PlatformInfo']) }),
    );
    expect(unsupported.actions[0]!.status).toBe('UNSUPPORTED');
    expect(
      canPlanDeterministically(
        base([intent('i1', 'BUY')], { availableWorkflowTypes: new Set(['PlatformInfo']) }),
      ),
    ).toBe(false);
  });

  it('never hands a digression the parked workflow of another capability', () => {
    const plan = buildDeterministicPlan(
      base([intent('i1', 'PLATFORM_INFORMATION')], {
        activeWorkflows: [{ workflowId: 'wf1', workflowType: 'VendorOnboarding', status: 'active' }],
        continuity: {
          primary: 'DIGRESSION',
          relationships: [{ relationship: 'DIGRESSION', intentIds: ['i1'], workflowIds: ['wf1'] }],
          confidence: 0.9,
          reason: '',
          source: 'P2',
        },
      }),
    );
    expect(plan.actions[0]).toMatchObject({
      workflowType: 'PlatformInfo',
      operation: 'START',
      scope: { workflowIds: [] },
    });
  });

  it('leaves greetings to the platform reply and marks gated intents NEEDS_USER', () => {
    expect(buildDeterministicPlan(base([intent('i1', 'GREETING')])).actions).toHaveLength(0);
    const gated = buildDeterministicPlan(
      base([intent('i1', 'FIND_PRODUCT')], { needsUserIntentIds: new Set(['i1']) }),
    );
    expect(gated.actions[0]!.status).toBe('NEEDS_USER');
    expect(gated.status).toBe('BLOCKED');
  });
});
