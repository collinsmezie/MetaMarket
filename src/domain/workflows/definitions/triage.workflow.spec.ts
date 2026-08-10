import {
  FrozenClock,
  InMemoryWorkflowRepository,
  makeInstance,
  makeIntent,
  makeTrigger,
  RecordingStageLogger,
  SequentialIdGenerator,
} from '@test/fakes';
import { encodeActionPayload } from '../action-payload';
import { WorkflowEngine } from '../workflow-engine';
import { WorkflowDefinitionRegistry } from '../workflow-registry';
import { triageWorkflow, TRIAGE_WORKFLOW_TYPE } from './triage.workflow';

function buildEngine() {
  const registry = new WorkflowDefinitionRegistry();
  registry.register(triageWorkflow);

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

function seed(workflows: InMemoryWorkflowRepository, state: string) {
  return workflows.seed(makeInstance({ workflowType: TRIAGE_WORKFLOW_TYPE, currentState: state }));
}

/**
 * Triage exists to work out what the user wants and then get out of the way.
 *
 * The bug these pin (observed in production, 2026-08-07): a user said "hi", was asked "buying or
 * selling?", tapped **I want to sell**, and was told "Seller onboarding opens shortly" — months
 * after onboarding shipped. Priority cannot fix that on its own, because tapping the button
 * resumes this instance by id and never passes through intent routing again.
 */
describe('Triage workflow', () => {
  it('is a valid state machine', () => {
    expect(() => new WorkflowDefinitionRegistry().register(triageWorkflow)).not.toThrow();
  });

  it('hands off to whoever owns the intent when the user taps "sell"', async () => {
    const { engine, workflows } = buildEngine();
    const instance = seed(workflows, 'AwaitDetail');

    const outcome = await engine.execute(
      instance,
      makeTrigger({
        text: 'I want to sell',
        interactivePayload: encodeActionPayload({ workflowId: instance.id, action: 'sell' }),
      }),
      {},
    );

    expect(outcome.handoff).toEqual({ intent: 'vendor_onboarding' });
    expect(outcome.instance.status).toBe('completed');
  });

  it('hands off when the user taps "buy"', async () => {
    const { engine, workflows } = buildEngine();
    const instance = seed(workflows, 'AwaitDetail');

    const outcome = await engine.execute(
      instance,
      makeTrigger({
        text: 'I want to buy',
        interactivePayload: encodeActionPayload({ workflowId: instance.id, action: 'buy' }),
      }),
      {},
    );

    expect(outcome.handoff).toEqual({ intent: 'buyer_product_search' });
  });

  it('hands off from the classify state too, not only from a tapped answer', async () => {
    const { engine, workflows } = buildEngine();
    const instance = seed(workflows, 'Classify');

    const outcome = await engine.execute(
      instance,
      makeTrigger({ text: 'I want to recharge', intent: makeIntent({ intent: 'wallet_funding' }) }),
      {},
    );

    expect(outcome.handoff).toEqual({ intent: 'wallet_funding' });
  });

  it('answers directly for an intent no other workflow implements', async () => {
    // Nothing owns `complaint`, so Triage's own answer is the honest one.
    const { engine, workflows } = buildEngine();
    const instance = seed(workflows, 'Classify');

    const outcome = await engine.execute(
      instance,
      makeTrigger({ text: 'this is terrible', intent: makeIntent({ intent: 'complaint' }) }),
      {},
    );

    expect(outcome.handoff).toBeUndefined();
    expect(outcome.responses[0].text).toContain('complaint');
  });

  it('suppresses text response on handoff to prevent duplicate messages', async () => {
    // When handoff occurs, the text response is omitted so the successor workflow generates the reply.
    const { engine, workflows } = buildEngine();
    const instance = seed(workflows, 'AwaitDetail');

    const outcome = await engine.execute(
      instance,
      makeTrigger({
        text: 'I want to sell',
        interactivePayload: encodeActionPayload({ workflowId: instance.id, action: 'sell' }),
      }),
      {},
    );

    expect(outcome.responses).toHaveLength(0);
  });

  it('asks again rather than guessing when the reply is still unclear', async () => {
    const { engine, workflows } = buildEngine();
    const instance = seed(workflows, 'AwaitDetail');

    const outcome = await engine.execute(
      instance,
      makeTrigger({ text: 'hmm', intent: makeIntent({ intent: 'unknown' }) }),
      {},
    );

    expect(outcome.handoff).toBeUndefined();
    expect(outcome.responses[0].text).toContain('I want to make sure I help you with the right thing');
  });

  it('stays the lowest-priority workflow, so it never wins an intent someone else owns', () => {
    expect(triageWorkflow.policy.priority).toBeLessThan(0);
  });
});
