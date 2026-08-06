import {
  FrozenClock,
  InMemoryWorkflowRepository,
  makeInstance,
  makeTrigger,
  RecordingStageLogger,
  SequentialIdGenerator,
} from '@test/fakes';
import { EMPTY_ONBOARDING_FIELDS, type OnboardingFields } from '../../models/vendor';
import { WorkflowEngine } from '../workflow-engine';
import { WorkflowDefinitionRegistry } from '../workflow-registry';
import type { OnboardingServices } from './vendor-onboarding.workflow';
import { vendorOnboardingWorkflow, VENDOR_ONBOARDING_WORKFLOW_TYPE } from './vendor-onboarding.workflow';

/**
 * These specs pin the two rules that make onboarding tolerable for a busy trader:
 * at most one clarification ever, and never asking for something already said.
 */

interface ExtractionScript {
  fields?: Partial<OnboardingFields>;
  inferredState?: string | null;
  confirmation?: 'yes' | 'no' | null;
}

function buildServices(options: {
  extractions: readonly ExtractionScript[];
  clarification?: { question: string; ambiguityScore: number };
}) {
  const extractions = [...options.extractions];
  const observed: string[] = [];
  const finalized: { businessName: string; city: string; state: string }[] = [];
  const questionsAsked: (string | null)[] = [];

  const services: OnboardingServices = {
    extraction: {
      async extract(params) {
        questionsAsked.push(params.pendingQuestion);
        const next = extractions.shift() ?? {};

        return {
          fields: next.fields ?? {},
          stateInferredFromCity: (next.inferredState ?? null) !== null,
          inferredState: next.inferredState ?? null,
          stateConfidence: next.inferredState !== undefined ? 0.9 : 0,
          confirmation: next.confirmation ?? null,
        };
      },
    },
    discovery: {
      async observeStatement(params) {
        observed.push(params.statement);
        return {
          clarificationQuestion: options.clarification?.question ?? null,
          ambiguityScore: options.clarification?.ambiguityScore ?? 0,
        };
      },
    },
    vendors: {
      async ensureVendor() {
        return { vendorId: 'vendor_1' };
      },
      async finalizeProfile(params) {
        finalized.push({
          businessName: params.businessName,
          city: params.city,
          state: params.state,
        });
      },
    },
  };

  return { services, observed, finalized, questionsAsked };
}

function buildEngine() {
  const registry = new WorkflowDefinitionRegistry();
  registry.register(vendorOnboardingWorkflow);

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

function seed(workflows: InMemoryWorkflowRepository, state: string, data: Record<string, unknown> = {}) {
  return workflows.seed(
    makeInstance({
      workflowType: VENDOR_ONBOARDING_WORKFLOW_TYPE,
      currentState: state,
      data: { vendorId: 'vendor_1', fields: EMPTY_ONBOARDING_FIELDS, statements: [], ...data },
    }),
  );
}

describe('Vendor onboarding workflow', () => {
  it('is a valid state machine', () => {
    // Registration validates transitions, initial state and reachability of a final state.
    expect(() => new WorkflowDefinitionRegistry().register(vendorOnboardingWorkflow)).not.toThrow();
  });

  it('outranks Triage on the vendor_onboarding intent', () => {
    expect(vendorOnboardingWorkflow.policy.priority).toBeGreaterThan(0);
    expect(vendorOnboardingWorkflow.startingIntents).toContain('vendor_onboarding');
  });

  it('asks what the vendor sells when the opening message says nothing useful', async () => {
    const { engine, workflows } = buildEngine();
    const { services } = buildServices({ extractions: [{}] });
    const instance = seed(workflows, 'AskCapability');

    const outcome = await engine.execute(instance, makeTrigger({ text: 'hello' }), services);

    expect(outcome.responses[0].text).toContain('What do you sell');
    expect(outcome.instance.currentState).toBe('AwaitCapability');
  });

  it('skips straight past questions the opening message already answered', async () => {
    // "I sell plumbing materials. My shop is Emeka Plumbing and I'm in Aba."
    const { engine, workflows } = buildEngine();
    const { services, finalized } = buildServices({
      extractions: [
        {
          fields: {
            capabilityStatement: 'I sell plumbing materials',
            businessName: 'Emeka Plumbing',
            city: 'Aba',
          },
          inferredState: 'Abia',
        },
      ],
    });

    const instance = seed(workflows, 'AskCapability');
    const outcome = await engine.execute(
      instance,
      makeTrigger({ text: 'I sell plumbing materials...' }),
      services,
    );

    // Only the state needs confirming; capability, name and city are never asked for.
    expect(outcome.responses[0].text).toBe("That's Aba in Abia State, right?");
    expect(outcome.instance.currentState).toBe('ConfirmState');
    expect(finalized).toHaveLength(0);
  });

  it('completes the profile once the inferred state is confirmed', async () => {
    const { engine, workflows } = buildEngine();
    const { services, finalized } = buildServices({ extractions: [{ confirmation: 'yes' }] });

    const instance = seed(workflows, 'ConfirmState', {
      fields: {
        capabilityStatement: 'I sell plumbing materials',
        businessName: 'Emeka Plumbing',
        city: 'Aba',
        state: null,
      },
      proposedState: 'Abia',
    });

    const outcome = await engine.execute(instance, makeTrigger({ text: 'yes' }), services);

    expect(finalized).toEqual([{ businessName: 'Emeka Plumbing', city: 'Aba', state: 'Abia' }]);
    expect(outcome.instance.status).toBe('completed');
    expect(outcome.responses.at(-1)?.text).toContain('Emeka Plumbing');
  });

  it('asks for the state outright when the vendor rejects the inference', async () => {
    const { engine, workflows } = buildEngine();
    const { services, finalized } = buildServices({ extractions: [{ confirmation: 'no' }] });

    const instance = seed(workflows, 'ConfirmState', {
      fields: {
        capabilityStatement: 'plumbing',
        businessName: 'Emeka Plumbing',
        city: 'Aba',
        state: null,
      },
      proposedState: 'Abia',
    });

    const outcome = await engine.execute(instance, makeTrigger({ text: 'no' }), services);

    expect(outcome.responses[0].text).toContain('Which state');
    expect(finalized).toHaveLength(0);
  });

  it('spends its one clarification when the capability is genuinely ambiguous', async () => {
    const { engine, workflows } = buildEngine();
    const { services } = buildServices({
      extractions: [{ fields: { capabilityStatement: 'I sell electrical things' } }],
      clarification: {
        question: 'Is it mainly house wiring materials, home electronics, or electrical repair?',
        ambiguityScore: 0.8,
      },
    });

    const instance = seed(workflows, 'AskCapability');
    const outcome = await engine.execute(
      instance,
      makeTrigger({ text: 'I sell electrical things' }),
      services,
    );

    expect(outcome.responses[0].text).toContain('house wiring materials');
    expect(outcome.instance.currentState).toBe('AwaitClarification');
    expect(outcome.instance.data.clarificationAsked).toBe(true);
  });

  it('never asks a second clarification, however ambiguous the answer stays', async () => {
    // The budget is one question, full stop. Remaining uncertainty is kept in the DNA as
    // hypotheses for the marketplace to resolve (Vendor-Onboarding.md §2).
    const { engine, workflows } = buildEngine();
    const { services } = buildServices({
      extractions: [{ fields: { capabilityStatement: 'still vague' } }],
      clarification: { question: 'Another clarifying question?', ambiguityScore: 0.95 },
    });

    const instance = seed(workflows, 'AwaitClarification', {
      fields: { ...EMPTY_ONBOARDING_FIELDS, capabilityStatement: 'I sell electrical things' },
      clarificationAsked: true,
    });

    const outcome = await engine.execute(instance, makeTrigger({ text: 'just electrical' }), services);

    expect(outcome.responses[0].text).not.toContain('Another clarifying question');
    expect(outcome.responses[0].text).toContain('Which city');
  });

  it('does not spend the clarification on a statement that is merely short', async () => {
    const { engine, workflows } = buildEngine();
    const { services } = buildServices({
      extractions: [{ fields: { capabilityStatement: 'I sell cement' } }],
      // The CDE judged this unambiguous despite being brief.
      clarification: { question: 'What kind exactly?', ambiguityScore: 0.2 },
    });

    const instance = seed(workflows, 'AskCapability');
    const outcome = await engine.execute(instance, makeTrigger({ text: 'I sell cement' }), services);

    expect(outcome.instance.currentState).toBe('AwaitLocation');
    expect(outcome.instance.data.clarificationAsked).toBe(false);
  });

  it('feeds every capability statement to the discovery engine exactly once', async () => {
    const { engine, workflows } = buildEngine();
    const { services, observed } = buildServices({
      extractions: [{ fields: { capabilityStatement: 'I sell cement' } }, { fields: { city: 'Aba' } }],
    });

    const first = seed(workflows, 'AskCapability');
    await engine.execute(first, makeTrigger({ text: 'I sell cement' }), services);

    const second = await workflows.findById(first.id);
    await engine.execute(second!, makeTrigger({ text: 'Aba' }), services);

    // The second turn carried no new statement, so nothing is re-observed.
    expect(observed).toEqual(['I sell cement']);
  });

  it('asks for the business name last, once everything else is known', async () => {
    const { engine, workflows } = buildEngine();
    const { services } = buildServices({ extractions: [{ fields: { state: 'Abia' } }] });

    const instance = seed(workflows, 'AwaitLocation', {
      fields: { ...EMPTY_ONBOARDING_FIELDS, capabilityStatement: 'cement', city: 'Aba' },
    });

    const outcome = await engine.execute(instance, makeTrigger({ text: 'Abia' }), services);

    expect(outcome.responses[0].text).toContain('business name');
    expect(outcome.instance.currentState).toBe('AwaitBusinessName');
  });

  it('creates a searchable profile at the end', async () => {
    const { engine, workflows } = buildEngine();
    const { services, finalized } = buildServices({
      extractions: [{ fields: { businessName: 'Divine Electricals' } }],
    });

    const instance = seed(workflows, 'AwaitBusinessName', {
      fields: {
        capabilityStatement: 'electrical materials',
        city: 'Aba',
        state: 'Abia',
        businessName: null,
      },
    });

    const outcome = await engine.execute(instance, makeTrigger({ text: 'Divine Electricals' }), services);

    expect(finalized[0].businessName).toBe('Divine Electricals');
    expect(outcome.instance.status).toBe('completed');
    expect(outcome.instance.importantEntities.vendor_id).toBe('vendor_1');
  });

  it('records the resolved details in the workflow summary and fingerprint', async () => {
    const { engine, workflows } = buildEngine();
    const { services } = buildServices({
      extractions: [{ fields: { capabilityStatement: 'I sell cement', city: 'Aba' }, inferredState: 'Abia' }],
    });

    const instance = seed(workflows, 'AskCapability');
    const outcome = await engine.execute(instance, makeTrigger({ text: 'I sell cement in Aba' }), services);

    expect(outcome.instance.summary).toContain('Aba');
    expect(outcome.instance.semanticFingerprint.entities).toContain('I sell cement');
  });
});
