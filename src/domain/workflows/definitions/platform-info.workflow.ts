import type { SemanticFingerprint } from '../../models/workflow-instance';
import type {
  StateExecutionResult,
  WorkflowDefinition,
  WorkflowExecutionContext,
  WorkflowTrigger,
} from '../workflow-definition';
import { DEFAULT_WORKFLOW_POLICY } from '../workflow-definition';

/**
 * Platform Info — answers questions about MetaMarket itself.
 *
 * Exists because a digression had nowhere to go. A vendor mid-onboarding who asks "how much do
 * you charge per month?" is not starting a search, funding a wallet or raising a complaint, so
 * no workflow claimed the intent, routing came back unroutable, and the user got the fallback
 * envelope — a greeting, in answer to a direct question about money.
 *
 * Deliberately the smallest possible workflow: one state, one answer, completed. It must never
 * hold the conversation open, because the objective the user actually came for is parked behind
 * it and the whole point is to get back to that.
 */

export const PLATFORM_INFO_WORKFLOW_TYPE = 'PlatformInfo';

const STATE_ANSWER = 'Answer';
const STATE_COMPLETE = 'Complete';

/** Topics this workflow can speak to, chosen by keyword rather than a second LLM call. */
type Topic = 'pricing' | 'how_it_works' | 'help';

/**
 * Thousands separator, applied explicitly.
 *
 * `toLocaleString` would render "2 000" or "2.000" depending on the host's locale, which is not
 * something a user's reply should depend on.
 */
function grouped(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Answers, with the numbers read from configuration rather than written into prose.
 *
 * Hardcoding "100 credits" here would make this file lie the day the fee changes — which is
 * exactly how the Triage placeholder became a problem.
 */
function answerFor(topic: Topic, credits: { visibilityFee: number; onboardingGrant: number }): string {
  switch (topic) {
    case 'pricing':
      return [
        'Listing your business on MetaMarket is completely free — there is no monthly charge.',
        '',
        `You get ${grouped(credits.onboardingGrant)} Konnet credits when you finish setting up. After that, credits are only spent when a buyer's request actually reaches you: ${credits.visibilityFee} credits when your shop is revealed to a buyer looking for what you sell.`,
        '',
        'So you pay for real buyers, never for being listed.',
      ].join('\n');

    case 'how_it_works':
      return [
        'MetaMarket connects buyers to shops that actually stock what they need.',
        '',
        '• Sellers tell me what they sell, once, in their own words.',
        '• Buyers ask for what they need, in their own words.',
        '• I match the two and put the buyer in touch with the shops most likely to have it.',
        '',
        'It is free to list, and you only spend credits when a buyer reaches you.',
      ].join('\n');

    case 'help':
      return [
        'Here is what I can do:',
        '',
        '• *Selling?* Tell me what you stock and I will list your business so buyers can find you.',
        '• *Buying?* Tell me what you need and where, and I will find shops that have it.',
        '• *Credits?* Ask about your balance or say "recharge" to top up.',
        '',
        'You can ask me anything in the middle of something else — I will pick up where we left off.',
      ].join('\n');
  }
}

/**
 * Classifies the question by keyword.
 *
 * An LLM call here would be a third model round trip on a turn whose answer is fixed text, and
 * the intent that routed here has already done the hard part. Pricing is the default because it
 * is overwhelmingly what people ask, and the pricing answer also states what the platform does.
 */
function topicOf(text: string): Topic {
  const lower = text.toLowerCase();

  if (/\b(help|what can you do|options|menu|guide)\b/.test(lower)) return 'help';
  if (/\b(how does|how do you|how it works|what is metamarket|what do you do)\b/.test(lower)) {
    return 'how_it_works';
  }

  return 'pricing';
}

function fingerprintFor(trigger: WorkflowTrigger): SemanticFingerprint {
  return {
    intent: trigger.intent?.intent ?? 'platform_faq',
    entities: [],
    keywords: [
      ...new Set(
        trigger.text
          .toLowerCase()
          .split(/\s+/)
          .filter((word) => word.length > 2),
      ),
    ],
  };
}

interface PlatformInfoServices {
  readonly credits: { readonly visibilityFee: number; readonly onboardingGrant: number };
}

function servicesOf(context: WorkflowExecutionContext): PlatformInfoServices {
  const credits = context.services.credits as PlatformInfoServices['credits'] | undefined;

  if (credits === undefined) {
    throw new Error('Platform info requires the credits pricing service.');
  }

  return { credits };
}

const answer = {
  name: STATE_ANSWER,
  allowedTransitions: [STATE_COMPLETE],
  waitsForInput: false,

  async execute(context: WorkflowExecutionContext): Promise<StateExecutionResult> {
    const { credits } = servicesOf(context);
    const topic = topicOf(context.trigger.text);

    return {
      transitionTo: STATE_COMPLETE,
      // Completed in the same turn: whatever the user was doing before is parked behind this,
      // and leaving an open instance would put this question in the way of getting back to it.
      status: 'completed',
      response: { text: answerFor(topic, credits) },
      summary: `Answered a platform question about ${topic.replace('_', ' ')}.`,
      semanticFingerprint: fingerprintFor(context.trigger),
      dataPatch: { topic, question: context.trigger.text },
    };
  },
};

const complete = {
  name: STATE_COMPLETE,
  allowedTransitions: [] as readonly string[],
  waitsForInput: false,
  isFinal: true,
  async execute(): Promise<StateExecutionResult> {
    return { status: 'completed' };
  },
};

export const platformInfoWorkflow: WorkflowDefinition = {
  type: PLATFORM_INFO_WORKFLOW_TYPE,
  initialState: STATE_ANSWER,
  states: [answer, complete],

  policy: {
    ...DEFAULT_WORKFLOW_POLICY,
    // Beats Triage (-100) on its own intents. Nothing else claims them.
    priority: 40,
    // One-shot, so nothing is gained by keeping it resumable — and a resumable instance would
    // become a candidate the discovery layers have to rule out on every later turn.
    resumable: false,
    idleExpiryMs: 60 * 60 * 1_000,
    // Each question is its own instance; a user may ask two in one conversation.
    allowConcurrentInstances: true,
  },

  startingIntents: ['platform_faq', 'pricing_question', 'help'],

  initialData: (trigger) => ({ question: trigger.text }),

  initialSummary: (trigger) => `Platform question: "${trigger.text.slice(0, 100)}"`,

  initialFingerprint: fingerprintFor,
};
