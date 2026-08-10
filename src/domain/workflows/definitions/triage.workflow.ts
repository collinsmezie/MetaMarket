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
 * It is designed to be replaced, by two mechanisms rather than one. A *new* message reaches the
 * right workflow by priority: Buyer Search, Vendor Onboarding and Credit Recharge outrank Triage
 * on the intents they own, so Triage simply stops matching. But a user who already asked
 * "buying or selling?" and tapped an answer resumes *this instance* by id, which never passes
 * through intent routing again — so once Triage knows what they meant it hands the turn off
 * (`StateExecutionResult.handoff`) to the workflow that owns the intent.
 *
 * The placeholder copy below survives only as the fallback for a deployment where nothing is
 * registered for an intent. A placeholder that outlives the feature it was standing in for is
 * no longer a placeholder; it is the platform lying to a user about what it can do.
 */

export const TRIAGE_WORKFLOW_TYPE = 'Triage';

const STATE_CLASSIFY = 'Classify';
const STATE_AWAIT_DETAIL = 'AwaitDetail';
const STATE_COMPLETE = 'Complete';

/**
 * What Triage can conclude a user wants, and what it does about it.
 *
 * `handsOff: true` means a purpose-built workflow owns this intent, so Triage steps aside and
 * the platform runs that workflow in the same turn. The `response` is then only a fallback for
 * a deployment where nothing is registered for the intent.
 *
 * This matters most on the resumed path. A user who tapped "I want to sell" resumes *this*
 * instance by its id (discovery Layer 1) and never passes through intent routing again, so
 * priority alone cannot supersede Triage here. Without the handoff, Triage answers on behalf of
 * capabilities it does not implement — and a placeholder written before a feature shipped
 * becomes a lie the day it does.
 */
const PLANNED_CAPABILITIES: Readonly<
  Record<string, { label: string; response: string; handsOff?: boolean }>
> = {
  buyer_product_search: {
    label: 'find a supplier',
    handsOff: true,
    response:
      'Got it — you are looking for a supplier. Vendor matching goes live once sellers are onboarded, and I will come back to you here as soon as it does.',
  },
  vendor_onboarding: {
    label: 'list your business',
    handsOff: true,
    response:
      'Got it — you want to list your business. Seller onboarding opens shortly, and I will walk you through it right here when it does.',
  },
  complaint: {
    label: 'raise a complaint',
    response: 'Understood — I have logged that you want to raise a complaint, and a human will follow up.',
  },
  wallet_funding: {
    label: 'fund your wallet',
    handsOff: true,
    response: 'Understood — wallet funding is not available yet, but I have noted your request.',
  },
};

/** The closing result for a resolved intent: hand off where something better exists. */
function concludeWith(
  intent: string,
  known: { label: string; response: string; handsOff?: boolean },
  extra: Omit<StateExecutionResult, 'transitionTo' | 'response' | 'handoff'>,
): StateExecutionResult {
  return {
    transitionTo: STATE_COMPLETE,
    ...(known.handsOff !== true ? { response: { text: known.response } } : {}),
    ...(known.handsOff === true ? { handoff: { intent } } : {}),
    ...extra,
  };
}

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

/**
 * The buy/sell buttons.
 *
 * Offered on every ask, including the re-ask. Dropping them the second time was what turned an
 * unclear reply into a dead end: a user answering "Hi" got a text-only question back, so the one
 * unambiguous way to answer was taken away at exactly the moment it was needed most, and the
 * exchange repeated sixteen times.
 */
function choiceActions(workflowId: string) {
  return [
    {
      type: 'triage_choice',
      title: 'I want to Buy',
      payload: encodeActionPayload({ workflowId, action: 'buy' }),
    },
    {
      type: 'triage_choice',
      title: 'I want to Sell',
      payload: encodeActionPayload({ workflowId, action: 'sell' }),
    },
  ];
}

/**
 * Re-asks before giving up.
 *
 * Bounded because a question the user has ignored three times is not going to work the fourth;
 * past that Triage says what it can do and closes, which is a better answer than an endless
 * loop the user cannot escape.
 */
const MAX_CLARIFICATION_ATTEMPTS = 3;

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
            'Hello! Welcome to MetaMarket. I want to make sure I help you with the right thing.',
            '',
            'Are you looking to buy something, or do you want to list your business so buyers can find you?',
          ].join('\n'),
          actions: choiceActions(context.instance.id),
        },
        summary: `Triage: intent unclear from "${trigger.text}". Asked whether the user is buying or selling.`,
        semanticFingerprint: fingerprint,
        dataPatch: { originalMessage: trigger.text, clarificationAttempts: 0 },
      };
    }

    return concludeWith(intent, known, {
      summary: `Triage: user wants to ${known.label}.`,
      semanticFingerprint: fingerprint,
      dataPatch: { resolvedIntent: intent, originalMessage: trigger.text },
    });
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
      const attempts = Number(context.data.clarificationAttempts ?? 0) + 1;

      // Give up rather than loop. The summary counts attempts instead of appending a sentence
      // per turn: it is replayed into every continuity prompt, so an ever-growing string costs
      // tokens and latency on each subsequent message and eventually crowds out the history it
      // was meant to summarise.
      if (attempts >= MAX_CLARIFICATION_ATTEMPTS) {
        return {
          transitionTo: STATE_COMPLETE,
          status: 'completed',
          response: {
            text: [
              'Pls Whenever you are ready, just tell me what you need. For example: "I need cement in Aba", or "I sell electrical materials".',
            ].join('\n'),
          },
          summary: `Triage: the user never clarified after ${attempts} attempts; closed the conversation.`,
          dataPatch: { clarificationAttempts: attempts },
        };
      }

      return {
        response: {
          text: [
            'Hello! Welcome to MetaMarket. I want to make sure I help you with the right thing.',
            '',
            'Are you looking to buy something, or do you want to list your business so buyers can find you?',
          ].join('\n'),
          actions: choiceActions(context.instance.id),
        },
        summary: `Triage: intent unclear from "${context.data.originalMessage ?? ''}". Re-asked (${attempts}/${MAX_CLARIFICATION_ATTEMPTS}).`,
        dataPatch: { clarificationAttempts: attempts },
      };
    }

    const known = PLANNED_CAPABILITIES[choice];

    return concludeWith(choice, known, {
      summary: `Triage: user wants to ${known.label}.`,
      dataPatch: { resolvedIntent: choice },
    });
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
