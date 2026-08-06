import {
  FrozenClock,
  InMemoryWorkflowRepository,
  makeInstance,
  makeTrigger,
  RecordingStageLogger,
  SequentialIdGenerator,
} from '@test/fakes';
import { isFallbackResponse } from '../models/response';
import type { StateExecutionResult, WorkflowDefinition } from './workflow-definition';
import { DEFAULT_WORKFLOW_POLICY } from './workflow-definition';
import { WorkflowEngine } from './workflow-engine';
import { WorkflowDefinitionRegistry } from './workflow-registry';

/**
 * The engine is the guarantee behind "deterministic workflow execution" (MCOS §3.5) and
 * "no hung sessions" (Execution.md §2.5). These specs pin both.
 */

const NEVER_CALLED = jest.fn();

function buildDefinition(states: WorkflowDefinition['states']): WorkflowDefinition {
  return {
    type: 'TestFlow',
    initialState: states[0].name,
    states,
    policy: DEFAULT_WORKFLOW_POLICY,
    startingIntents: ['test_intent'],
    initialData: () => ({}),
    initialSummary: () => 'test',
    initialFingerprint: () => ({ intent: 'test_intent', entities: [], keywords: [] }),
  };
}

function buildEngine(definition: WorkflowDefinition) {
  const registry = new WorkflowDefinitionRegistry();
  registry.register(definition);

  const workflows = new InMemoryWorkflowRepository();
  const logger = new RecordingStageLogger();
  const engine = new WorkflowEngine(
    registry,
    workflows,
    new FrozenClock(),
    new SequentialIdGenerator(),
    logger,
  );

  return { engine, workflows, logger };
}

const finalState = {
  name: 'Done',
  allowedTransitions: [] as readonly string[],
  waitsForInput: false,
  isFinal: true,
  execute: async (): Promise<StateExecutionResult> => ({ status: 'completed' }),
};

describe('WorkflowEngine', () => {
  beforeEach(() => NEVER_CALLED.mockClear());

  it('executes a state and persists the requested transition with an audit record', async () => {
    const definition = buildDefinition([
      {
        name: 'Start',
        allowedTransitions: ['Done'],
        waitsForInput: false,
        execute: async () => ({ transitionTo: 'Done', response: { text: 'all set' } }),
      },
      finalState,
    ]);

    const { engine, workflows } = buildEngine(definition);
    const instance = workflows.seed(makeInstance({ workflowType: 'TestFlow', currentState: 'Start' }));

    const outcome = await engine.execute(instance, makeTrigger(), {});

    expect(outcome.failed).toBe(false);
    expect(outcome.instance.currentState).toBe('Done');
    expect(outcome.instance.status).toBe('completed');
    expect(outcome.responses).toEqual([{ text: 'all set' }]);
    expect(workflows.transitions).toHaveLength(1);
    expect(workflows.transitions[0]).toMatchObject({ fromState: 'Start', toState: 'Done' });
  });

  it('stops at a state that waits for input instead of running on', async () => {
    const definition = buildDefinition([
      {
        name: 'Ask',
        allowedTransitions: ['Wait'],
        waitsForInput: false,
        execute: async () => ({ transitionTo: 'Wait', response: { text: 'which one?' } }),
      },
      {
        name: 'Wait',
        allowedTransitions: ['Done'],
        waitsForInput: true,
        // Running this in the same turn would make the bot ask and answer itself.
        execute: NEVER_CALLED.mockResolvedValue({ transitionTo: 'Done' }),
      },
      finalState,
    ]);

    const { engine, workflows } = buildEngine(definition);
    const instance = workflows.seed(makeInstance({ workflowType: 'TestFlow', currentState: 'Ask' }));

    const outcome = await engine.execute(instance, makeTrigger(), {});

    expect(outcome.instance.currentState).toBe('Wait');
    expect(NEVER_CALLED).not.toHaveBeenCalled();
    expect(outcome.responses).toHaveLength(1);
  });

  it('rejects an undeclared transition and fails the workflow rather than corrupting state', async () => {
    const definition = buildDefinition([
      {
        name: 'Start',
        allowedTransitions: ['Done'],
        waitsForInput: false,
        // 'Elsewhere' exists but is not reachable from Start.
        execute: async () => ({ transitionTo: 'Elsewhere' }),
      },
      { name: 'Elsewhere', allowedTransitions: [], waitsForInput: false, execute: NEVER_CALLED },
      finalState,
    ]);

    const { engine, workflows, logger } = buildEngine(definition);
    const instance = workflows.seed(makeInstance({ workflowType: 'TestFlow', currentState: 'Start' }));

    const outcome = await engine.execute(instance, makeTrigger(), {});

    expect(outcome.failed).toBe(true);
    expect(outcome.instance.status).toBe('failed');
    expect(outcome.instance.currentState).toBe('Start');
    expect(NEVER_CALLED).not.toHaveBeenCalled();
    expect(logger.failures.some((failure) => failure.action.includes('undeclared'))).toBe(true);
  });

  it('suspends the workflow and returns a fallback when a handler throws', async () => {
    const definition = buildDefinition([
      {
        name: 'Start',
        allowedTransitions: ['Done'],
        waitsForInput: false,
        execute: async () => {
          throw new Error('database unavailable');
        },
      },
      finalState,
    ]);

    const { engine, workflows } = buildEngine(definition);
    const instance = workflows.seed(makeInstance({ workflowType: 'TestFlow', currentState: 'Start' }));

    const outcome = await engine.execute(instance, makeTrigger(), {});

    // Suspended, not failed: a transient error must not discard the user's progress.
    expect(outcome.instance.status).toBe('suspended');
    expect(outcome.failed).toBe(true);
    expect(isFallbackResponse(outcome.responses[0])).toBe(true);
    expect(outcome.instance.data.lastError).toBe('database unavailable');
    expect(workflows.transitions[0].error).toBe('database unavailable');
  });

  it('aborts a transition cycle instead of looping on the user forever', async () => {
    const definition = buildDefinition([
      {
        name: 'A',
        allowedTransitions: ['B'],
        waitsForInput: false,
        execute: async () => ({ transitionTo: 'B' }),
      },
      {
        name: 'B',
        allowedTransitions: ['A'],
        waitsForInput: false,
        execute: async () => ({ transitionTo: 'A' }),
      },
      finalState,
    ]);

    const { engine, workflows, logger } = buildEngine(definition);
    const instance = workflows.seed(makeInstance({ workflowType: 'TestFlow', currentState: 'A' }));

    const outcome = await engine.execute(instance, makeTrigger(), {});

    expect(outcome.failed).toBe(true);
    expect(outcome.instance.status).toBe('failed');
    expect(logger.failures.some((failure) => failure.action.includes('transition cap'))).toBe(true);
  });

  it('merges dataPatch into existing workflow data rather than replacing it', async () => {
    const definition = buildDefinition([
      {
        name: 'Start',
        allowedTransitions: ['Done'],
        waitsForInput: false,
        execute: async () => ({ transitionTo: 'Done', dataPatch: { city: 'Aba' } }),
      },
      finalState,
    ]);

    const { engine, workflows } = buildEngine(definition);
    const instance = workflows.seed(
      makeInstance({ workflowType: 'TestFlow', currentState: 'Start', data: { businessName: 'Divine' } }),
    );

    const outcome = await engine.execute(instance, makeTrigger(), {});

    expect(outcome.instance.data).toEqual({ businessName: 'Divine', city: 'Aba' });
  });

  it('reactivates a suspended workflow when it is executed again', async () => {
    const definition = buildDefinition([
      {
        name: 'Start',
        allowedTransitions: ['Done'],
        waitsForInput: false,
        execute: async () => ({ response: { text: 'still here' } }),
      },
      finalState,
    ]);

    const { engine, workflows } = buildEngine(definition);
    const instance = workflows.seed(
      makeInstance({ workflowType: 'TestFlow', currentState: 'Start', status: 'suspended' }),
    );

    const outcome = await engine.execute(instance, makeTrigger(), {});

    expect(outcome.instance.status).toBe('active');
  });

  it('publishes a completion event when a workflow terminates', async () => {
    const definition = buildDefinition([
      {
        name: 'Start',
        allowedTransitions: ['Done'],
        waitsForInput: false,
        execute: async () => ({ transitionTo: 'Done', response: { text: 'done' } }),
      },
      finalState,
    ]);

    const { engine, workflows } = buildEngine(definition);
    const instance = workflows.seed(makeInstance({ workflowType: 'TestFlow', currentState: 'Start' }));

    const outcome = await engine.execute(instance, makeTrigger(), {});

    expect(outcome.events.map((event) => event.eventType)).toContain('workflow.completed');
  });

  it('records no transition when a state stays put', async () => {
    const definition = buildDefinition([
      {
        name: 'Start',
        allowedTransitions: ['Done'],
        waitsForInput: true,
        execute: async () => ({ response: { text: 'say again?' } }),
      },
      finalState,
    ]);

    const { engine, workflows } = buildEngine(definition);
    const instance = workflows.seed(makeInstance({ workflowType: 'TestFlow', currentState: 'Start' }));

    await engine.execute(instance, makeTrigger(), {});

    expect(workflows.transitions).toHaveLength(0);
  });
});
