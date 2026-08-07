import type { SemanticFingerprint } from '../../models/workflow-instance';
import { encodeActionPayload } from '../action-payload';
import type {
  StateExecutionResult,
  WorkflowDefinition,
  WorkflowExecutionContext,
  WorkflowTrigger,
} from '../workflow-definition';
import { DEFAULT_WORKFLOW_POLICY } from '../workflow-definition';

/**
 * Triage workflow — the Phase 1 business workflow.
 *
 * Phase 1 delivers the Conversation OS itself; the marketplace capabilities that fulfil a
 * request (Capability Discovery, Matching, Evidence, fan-out) arrive in Phases 2–5. Triage
 * exercises the platform end to end — states, transitions, summaries, fingerprints,
 * suspension and resumption — while telling users honestly what the platform can do today
 * rather than pretending to search a marketplace that has no vendors in it yet.
 *
 * It is designed to be replaced: when the Buyer Search and Vendor Onboarding workflows
 * register in later phases, they claim these intents by priority and Triage stops matching
 * them, with no change to the platform.
 */

export const TRIAGE_WORKFLOW_TYPE = 'Triage';

const STATE_CLASSIFY = 'Classify';
const STATE_AWAIT_DETAIL = 'AwaitDetail';
const STATE_COMPLETE = 'Complete';

/** Intents the marketplace will serve, mapped to the phase that delivers them. */
const PLANNED_CAPABILITIES: Readonly<Record<string, { label: string; response: string }>> = {
  buyer_product_search: {
    label: 'find a supplier',
    response:
      'Got it — you are looking for a supplier. Vendor matching goes live once sellers are onboarded, and I will come back to you here as soon as it does.',
  },
  vendor_onboarding: {
    label: 'list your business',
    response:
      'Got it — you want to list your business. Seller onboarding opens shortly, and I will walk you through it right here when it does.',
  },
  complaint: {
    label: 'raise a complaint',
    response: 'Understood — I have logged that you want to raise a complaint, and a human will follow up.',
  },
  wallet_funding: {
    label: 'fund your wallet',
    response: 'Understood — wallet funding is not available yet, but I have noted your request.',
  },
};

function fingerprintFor(trigger: WorkflowTrigger): SemanticFingerprint {
  const intent = trigger.intent?.intent ?? 'unknown';
  const entityValues = Object.values(trigger.intent?.entities ?? {})
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === 'string');

  const products = (trigger.semanticRequest?.products ?? []).flatMap((product) => [
    product.normalized,
    ...product.aliases,
  ]);

  return {
    intent,
    entities: [...new Set([...entityValues, ...products])],
    ...(trigger.semanticRequest?.category !== undefined
      ? { category: trigger.semanticRequest.category.name }
      : {}),
    // The raw phrasing matters for lexical discovery: users repeat their own words, not the
    // normalized trade name, when they return to a topic days later.
    keywords: [...new Set([...trigger.text.split(/\s+/).filter((word) => word.length > 2), ...products])],
  };
}

const classify = {
  name: STATE_CLASSIFY,
  allowedTransitions: [STATE_AWAIT_DETAIL, STATE_COMPLETE],
  waitsForInput: false,

  async execute(context: WorkflowExecutionContext): Promise<StateExecutionResult> {
    const { trigger } = context;
    const intent = trigger.intent?.intent ?? 'unknown';
    const known = PLANNED_CAPABILITIES[intent];
    const fingerprint = fingerprintFor(trigger);

    if (known === undefined) {
      // Unrecognised: ask one open question rather than guessing, and park for the answer.
      return {
        transitionTo: STATE_AWAIT_DETAIL,
        response: {
          text: [
            'I want to make sure I help you with the right thing.',
            '',
            'Are you looking to buy something, or do you want to list your business so buyers can find you?',
          ].join('\n'),
          actions: [
            {
              type: 'triage_choice',
              title: 'I want to buy',
              payload: encodeActionPayload({ workflowId: context.instance.id, action: 'buy' }),
            },
            {
              type: 'triage_choice',
              title: 'I want to sell',
              payload: encodeActionPayload({ workflowId: context.instance.id, action: 'sell' }),
            },
          ],
        },
        summary: `Triage: intent unclear from "${trigger.text}". Asked whether the user is buying or selling.`,
        semanticFingerprint: fingerprint,
        dataPatch: { originalMessage: trigger.text },
      };
    }

    return {
      transitionTo: STATE_COMPLETE,
      response: { text: known.response },
      summary: `Triage: user wants to ${known.label}. Acknowledged; capability pending.`,
      semanticFingerprint: fingerprint,
      dataPatch: { resolvedIntent: intent, originalMessage: trigger.text },
    };
  },
};

const awaitDetail = {
  name: STATE_AWAIT_DETAIL,
  allowedTransitions: [STATE_COMPLETE, STATE_AWAIT_DETAIL],
  waitsForInput: true,

  async execute(context: WorkflowExecutionContext): Promise<StateExecutionResult> {
    const { trigger } = context;

    // A tapped button is unambiguous; prefer it over re-reading the text.
    const choice = this.readChoice(trigger);

    if (choice === null) {
      return {
        response: {
          text: 'Sorry, I still did not catch that. Are you buying, or do you want to list your business?',
        },
        summary: `${context.instance.summary} User's reply was still unclear.`,
      };
    }

    const known = PLANNED_CAPABILITIES[choice];

    return {
      transitionTo: STATE_COMPLETE,
      response: { text: known.response },
      summary: `Triage: user wants to ${known.label}. Acknowledged; capability pending.`,
      dataPatch: { resolvedIntent: choice },
    };
  },

  /** Reads the user's choice from a button tap, or failing that from their words. */
  readChoice(trigger: WorkflowTrigger): 'buyer_product_search' | 'vendor_onboarding' | null {
    if (trigger.interactivePayload !== null) {
      if (trigger.interactivePayload.endsWith('|buy')) return 'buyer_product_search';
      if (trigger.interactivePayload.endsWith('|sell')) return 'vendor_onboarding';
    }

    const intent = trigger.intent?.intent;
    if (intent === 'buyer_product_search' || intent === 'vendor_onboarding') return intent;

    const text = trigger.text.toLowerCase();
    if (/\b(buy|buying|need|looking for|want to get)\b/.test(text)) return 'buyer_product_search';
    if (/\b(sell|selling|shop|business|vendor|supplier|list)\b/.test(text)) return 'vendor_onboarding';

    return null;
  },
};

const complete = {
  name: STATE_COMPLETE,
  allowedTransitions: [] as readonly string[],
  waitsForInput: false,
  isFinal: true,

  async execute(): Promise<StateExecutionResult> {
    // Terminal: reached only via a transition that already carried the closing response.
    return { status: 'completed' };
  },
};

export const triageWorkflow: WorkflowDefinition = {
  type: TRIAGE_WORKFLOW_TYPE,
  initialState: STATE_CLASSIFY,
  states: [classify, awaitDetail, complete],

  policy: {
    ...DEFAULT_WORKFLOW_POLICY,
    // Lowest priority so purpose-built workflows in later phases win the same intents.
    priority: -100,
    // A day of silence means the user moved on; do not resurrect the question next week.
    idleExpiryMs: 24 * 60 * 60 * 1_000,
    allowConcurrentInstances: false,
  },

  // Claims every intent in Phase 1, including `unknown`, so no message goes unanswered.
  startingIntents: [
    'unknown',
    'smalltalk',
    'buyer_product_search',
    'vendor_onboarding',
    'complaint',
    'wallet_funding',
  ],

  initialData: (trigger) => ({ originalMessage: trigger.text }),

  initialSummary: (trigger) => `Triage started for: "${trigger.text.slice(0, 120)}"`,

  initialFingerprint: fingerprintFor,
};
