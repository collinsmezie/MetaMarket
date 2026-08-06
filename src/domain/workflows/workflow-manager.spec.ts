import {
  FIXED_NOW,
  InMemoryWorkflowRepository,
  makeConversation,
  makeFingerprint,
  makeInstance,
  makeIntent,
  makeRegistry,
  makeRelationship,
  RecordingStageLogger,
} from '@test/fakes';
import type { EmbeddingProviderPort } from '../ports/outbound/embedding-provider.port';
import { encodeActionPayload } from './action-payload';
import { DEFAULT_WORKFLOW_POLICY, type WorkflowDefinition } from './workflow-definition';
import { WorkflowManager } from './workflow-manager';
import { WorkflowDefinitionRegistry } from './workflow-registry';

/**
 * Specs for layered workflow discovery (MCOS §15).
 *
 * The ordering of the layers is the design: an explicit id must always beat a semantic
 * guess, and the platform must prefer asking over resuming the wrong workflow.
 */

function definition(type: string, intents: readonly string[], priority = 0): WorkflowDefinition {
  return {
    type,
    initialState: 'Start',
    states: [
      {
        name: 'Start',
        allowedTransitions: ['Done'],
        waitsForInput: false,
        execute: async () => ({ transitionTo: 'Done' }),
      },
      {
        name: 'Done',
        allowedTransitions: [],
        waitsForInput: false,
        isFinal: true,
        execute: async () => ({}),
      },
    ],
    policy: { ...DEFAULT_WORKFLOW_POLICY, priority },
    startingIntents: intents,
    initialData: () => ({}),
    initialSummary: () => '',
    initialFingerprint: () => makeFingerprint(),
  };
}

function buildManager(options: { embeddings?: EmbeddingProviderPort | null } = {}) {
  const definitions = new WorkflowDefinitionRegistry();
  definitions.register(definition('BuyerSearch', ['buyer_product_search'], 10));
  definitions.register(definition('VendorOnboarding', ['vendor_onboarding'], 10));
  definitions.register(definition('Triage', ['buyer_product_search', 'unknown'], -100));

  const workflows = new InMemoryWorkflowRepository();
  const logger = new RecordingStageLogger();
  const manager = new WorkflowManager(definitions, workflows, logger, options.embeddings ?? null);

  return { manager, workflows, logger, definitions };
}

describe('WorkflowManager discovery', () => {
  it('Layer 1: resumes the exact workflow named by a tapped button', async () => {
    const { manager, workflows } = buildManager();
    const target = workflows.seed(makeInstance({ id: 'wf_target' }));
    const decoy = workflows.seed(makeInstance({ id: 'wf_decoy' }));

    const decision = await manager.route({
      conversation: makeConversation({
        workflowRegistry: makeRegistry([target, decoy], 'wf_decoy'),
      }),
      relationship: makeRelationship({ relationship: 'continuation' }),
      intent: null,
      text: 'View suppliers',
      interactivePayload: encodeActionPayload({ workflowId: 'wf_target', action: 'view' }),
      now: FIXED_NOW,
    });

    // Beats the active-workflow pointer, which would have chosen the decoy.
    expect(decision).toMatchObject({ action: 'resume', via: 'explicit_workflow_id' });
    expect(decision.action === 'resume' && decision.instance.id).toBe('wf_target');
  });

  it('Layer 1: ignores a button that points at a completed workflow', async () => {
    const { manager, workflows } = buildManager();
    const finished = workflows.seed(makeInstance({ id: 'wf_done', status: 'completed' }));

    const decision = await manager.route({
      conversation: makeConversation({ workflowRegistry: makeRegistry([finished]) }),
      relationship: makeRelationship({ relationship: 'new' }),
      intent: makeIntent(),
      text: 'hammer',
      interactivePayload: encodeActionPayload({ workflowId: 'wf_done', action: 'view' }),
      now: FIXED_NOW,
    });

    // A stale button must not resurrect a finished objective.
    expect(decision.action).toBe('start');
  });

  it('Layer 2: prefers a workflow tracking the deterministic identifier the user quoted', async () => {
    const { manager, workflows } = buildManager();
    const withOrder = workflows.seed(
      makeInstance({ id: 'wf_order', importantEntities: { order_id: 'ORD-991' } }),
    );
    const other = workflows.seed(makeInstance({ id: 'wf_other' }));

    const decision = await manager.route({
      conversation: makeConversation({ workflowRegistry: makeRegistry([withOrder, other], 'wf_other') }),
      relationship: makeRelationship({ relationship: 'continuation' }),
      intent: makeIntent({ entities: { order_id: 'ORD-991' } }),
      text: 'what about ORD-991',
      interactivePayload: null,
      now: FIXED_NOW,
    });

    expect(decision).toMatchObject({ action: 'resume', via: 'deterministic_identifier' });
  });

  it('Layer 4: resumes by lexical fingerprint when one workflow clearly matches', async () => {
    const { manager, workflows } = buildManager();
    const hammer = workflows.seed(
      makeInstance({
        id: 'wf_hammer',
        semanticFingerprint: makeFingerprint({ entities: ['hammer'], keywords: ['hammer', 'nails'] }),
      }),
    );
    const flask = workflows.seed(
      makeInstance({
        id: 'wf_flask',
        semanticFingerprint: makeFingerprint({ entities: ['vacuum flask'], keywords: ['flask'] }),
      }),
    );

    const decision = await manager.route({
      conversation: makeConversation({ workflowRegistry: makeRegistry([hammer, flask]) }),
      relationship: makeRelationship({ relationship: 'continuation' }),
      intent: makeIntent({ entities: {} }),
      text: 'hammer',
      interactivePayload: null,
      now: FIXED_NOW,
    });

    expect(decision).toMatchObject({ action: 'resume', via: 'semantic_fingerprint' });
    expect(decision.action === 'resume' && decision.instance.id).toBe('wf_hammer');
  });

  it('Layer 5: falls through to embedding similarity when lexical matching is inconclusive', async () => {
    const embeddings: EmbeddingProviderPort = {
      model: 'test',
      dimension: 3,
      embed: async () => [1, 0, 0],
      embedBatch: async () => [[1, 0, 0]],
    };

    const { manager, workflows } = buildManager({ embeddings });
    const a = workflows.seed(
      makeInstance({ id: 'wf_a', semanticFingerprint: makeFingerprint({ keywords: ['tools'] }) }),
    );
    const b = workflows.seed(
      makeInstance({ id: 'wf_b', semanticFingerprint: makeFingerprint({ keywords: ['fabric'] }) }),
    );
    workflows.similarityResults = [{ workflowId: 'wf_b', similarity: 0.95 }];

    const decision = await manager.route({
      conversation: makeConversation({ workflowRegistry: makeRegistry([a, b]) }),
      relationship: makeRelationship({ relationship: 'continuation' }),
      intent: makeIntent({ entities: {} }),
      text: 'something soft for sewing',
      interactivePayload: null,
      now: FIXED_NOW,
    });

    expect(decision).toMatchObject({ action: 'resume', via: 'embedding_similarity' });
    expect(decision.action === 'resume' && decision.instance.id).toBe('wf_b');
  });

  it('survives an embedding outage by degrading to the remaining layers', async () => {
    const embeddings: EmbeddingProviderPort = {
      model: 'test',
      dimension: 3,
      embed: async () => {
        throw new Error('embedding provider down');
      },
      embedBatch: async () => [],
    };

    const { manager, workflows, logger } = buildManager({ embeddings });
    const a = workflows.seed(makeInstance({ id: 'wf_a' }));
    const b = workflows.seed(makeInstance({ id: 'wf_b' }));

    const decision = await manager.route({
      conversation: makeConversation({ workflowRegistry: makeRegistry([a, b], 'wf_a') }),
      relationship: makeRelationship({ relationship: 'continuation' }),
      intent: makeIntent({ entities: {} }),
      text: 'anything at all here',
      interactivePayload: null,
      now: FIXED_NOW,
    });

    // Degrades to the active-workflow fallback rather than failing the turn.
    expect(decision).toMatchObject({ action: 'resume', via: 'active_workflow' });
    expect(logger.failures.some((failure) => failure.action.includes('Embedding-based'))).toBe(true);
  });

  it('suspends the active workflow on a topic shift instead of destroying it', async () => {
    const { manager, workflows } = buildManager();
    const active = workflows.seed(makeInstance({ id: 'wf_active', status: 'active' }));

    const decision = await manager.route({
      conversation: makeConversation({ workflowRegistry: makeRegistry([active], 'wf_active') }),
      relationship: makeRelationship({ relationship: 'topic_shift' }),
      intent: makeIntent({ intent: 'vendor_onboarding' }),
      text: 'actually I want to register my shop',
      interactivePayload: null,
      now: FIXED_NOW,
    });

    expect(decision).toMatchObject({ action: 'start', workflowType: 'VendorOnboarding' });
    expect(decision.action === 'start' && decision.suspend?.id).toBe('wf_active');
  });

  it('routes an intent to the highest-priority workflow claiming it', async () => {
    const { manager } = buildManager();

    const decision = await manager.route({
      conversation: makeConversation(),
      relationship: makeRelationship({ relationship: 'new' }),
      intent: makeIntent({ intent: 'buyer_product_search' }),
      text: 'I need a hammer',
      interactivePayload: null,
      now: FIXED_NOW,
    });

    // BuyerSearch (priority 10) beats Triage (priority -100) for the same intent.
    expect(decision).toMatchObject({ action: 'start', workflowType: 'BuyerSearch' });
  });

  it('reports unroutable when no workflow claims the intent', async () => {
    const { manager } = buildManager();

    const decision = await manager.route({
      conversation: makeConversation(),
      relationship: makeRelationship({ relationship: 'new' }),
      intent: makeIntent({ intent: 'book_a_flight' }),
      text: 'book me a flight to Lagos',
      interactivePayload: null,
      now: FIXED_NOW,
    });

    expect(decision.action).toBe('unroutable');
  });

  it('does not resume an expired workflow', async () => {
    const { manager, workflows } = buildManager();
    const expired = workflows.seed(
      makeInstance({ id: 'wf_expired', expiresAt: new Date(FIXED_NOW.getTime() - 1_000) }),
    );

    const decision = await manager.route({
      conversation: makeConversation({ workflowRegistry: makeRegistry([expired], 'wf_expired') }),
      relationship: makeRelationship({ relationship: 'continuation' }),
      intent: makeIntent(),
      text: 'still waiting',
      interactivePayload: null,
      now: FIXED_NOW,
    });

    expect(decision.action).not.toBe('resume');
  });

  it('treats an explicit cancel as a cancellation of the targeted workflow', async () => {
    const { manager, workflows } = buildManager();
    const active = workflows.seed(makeInstance({ id: 'wf_active' }));

    const decision = await manager.route({
      conversation: makeConversation({ workflowRegistry: makeRegistry([active], 'wf_active') }),
      relationship: makeRelationship({ relationship: 'cancel', candidateWorkflowIds: ['wf_active'] }),
      intent: makeIntent({ command: 'cancel' }),
      text: 'cancel that',
      interactivePayload: null,
      now: FIXED_NOW,
    });

    expect(decision).toMatchObject({ action: 'cancel' });
  });
});
