import {
  FrozenClock,
  InMemoryWorkflowRepository,
  makeInstance,
  makeTrigger,
  RecordingStageLogger,
  SequentialIdGenerator,
} from '@test/fakes';
import type { RechargeView } from '../../models/credit';
import { WorkflowEngine } from '../workflow-engine';
import { WorkflowDefinitionRegistry } from '../workflow-registry';
import type { CreditRechargeServices } from './credit-recharge.workflow';
import {
  creditRechargeWorkflow,
  CREDIT_RECHARGE_WORKFLOW_TYPE,
  renderRechargeView,
} from './credit-recharge.workflow';

const READY: RechargeView = {
  status: 'ready',
  balanceCredits: 18,
  bankName: 'Paystack-Titan',
  accountNumber: '8134567892',
  accountName: 'konnet - Collins',
};

function buildEngine() {
  const registry = new WorkflowDefinitionRegistry();
  registry.register(creditRechargeWorkflow);

  const workflows = new InMemoryWorkflowRepository();
  const engine = new WorkflowEngine(
    registry,
    workflows,
    new FrozenClock(),
    new SequentialIdGenerator(),
    new RecordingStageLogger(),
  );

  return { engine, workflows };
}

function buildServices(view: RechargeView) {
  const calls: { userId: string }[] = [];

  const services: CreditRechargeServices = {
    wallet: {
      async getRechargeView(params) {
        calls.push({ userId: params.userId });
        return view;
      },
    },
  };

  return { services, calls };
}

describe('renderRechargeView', () => {
  it('shows the balance and the funding-account block', () => {
    const text = renderRechargeView(READY);

    expect(text).toContain('Current Balance');
    expect(text).toContain('18 Credits');
    expect(text).toContain('Transfer money to your konnet Funding Account');
    expect(text).toContain('Paystack-Titan');
    expect(text).toContain('8134567892');
    expect(text).toContain('konnet - Collins');
    expect(text).toContain('Your credits will be added automatically once payment is received.');
  });

  it('still shows the real balance when the account is unavailable', () => {
    // A provider outage must not cost the user their balance or produce a generic fallback.
    const text = renderRechargeView({
      status: 'unavailable',
      balanceCredits: 18,
      reason: 'provisioning_failed',
    });

    expect(text).toContain('18 Credits');
    expect(text).toContain('being set up');
    expect(text).not.toContain('Account Number');
  });
});

describe('CreditRecharge workflow', () => {
  it('is a valid state machine', () => {
    expect(() => new WorkflowDefinitionRegistry().register(creditRechargeWorkflow)).not.toThrow();
  });

  it('claims the wallet intents at a priority that beats Triage', () => {
    expect(creditRechargeWorkflow.startingIntents).toEqual(['wallet_funding', 'wallet_balance']);
    // Triage sits at -100, so registering this is all the routing needs.
    expect(creditRechargeWorkflow.policy.priority).toBeGreaterThan(-100);
  });

  it('shows the funding account and completes in a single turn', async () => {
    const { engine, workflows } = buildEngine();
    const { services, calls } = buildServices(READY);

    const instance = workflows.seed(
      makeInstance({ workflowType: CREDIT_RECHARGE_WORKFLOW_TYPE, currentState: 'ShowAccount' }),
    );

    const outcome = await engine.execute(instance, makeTrigger({ text: 'Recharge' }), services);

    expect(outcome.responses[0].text).toContain('8134567892');
    expect(outcome.instance.status).toBe('completed');
    expect(calls).toHaveLength(1);
  });

  it('degrades to the unavailable copy without failing the turn', async () => {
    const { engine, workflows } = buildEngine();
    const { services } = buildServices({
      status: 'unavailable',
      balanceCredits: 5,
      reason: 'provisioning_failed',
    });

    const instance = workflows.seed(
      makeInstance({ workflowType: CREDIT_RECHARGE_WORKFLOW_TYPE, currentState: 'ShowAccount' }),
    );

    const outcome = await engine.execute(instance, makeTrigger({ text: 'Recharge' }), services);

    expect(outcome.failed).toBe(false);
    expect(outcome.responses[0].text).toContain('5 Credits');
    expect(outcome.instance.status).toBe('completed');
  });

  it('records the balance it showed, for auditing what the user saw', async () => {
    const { engine, workflows } = buildEngine();
    const { services } = buildServices(READY);

    const instance = workflows.seed(
      makeInstance({ workflowType: CREDIT_RECHARGE_WORKFLOW_TYPE, currentState: 'ShowAccount' }),
    );

    const outcome = await engine.execute(instance, makeTrigger({ text: 'Recharge' }), services);

    expect(outcome.instance.data.balanceAtView).toBe(18);
    expect(outcome.instance.summary).toContain('18 credits');
  });

  it('dead-letters rather than crashing when the wallet service is missing', async () => {
    const { engine, workflows } = buildEngine();
    const instance = workflows.seed(
      makeInstance({ workflowType: CREDIT_RECHARGE_WORKFLOW_TYPE, currentState: 'ShowAccount' }),
    );

    const outcome = await engine.execute(instance, makeTrigger({ text: 'Recharge' }), {});

    expect(outcome.failed).toBe(true);
    expect(outcome.instance.status).toBe('suspended');
  });
});
