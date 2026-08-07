import type { RechargeView } from '../../models/credit';
import type { SemanticFingerprint } from '../../models/workflow-instance';
import type {
  StateExecutionResult,
  WorkflowDefinition,
  WorkflowExecutionContext,
  WorkflowServices,
  WorkflowTrigger,
} from '../workflow-definition';
import { DEFAULT_WORKFLOW_POLICY } from '../workflow-definition';

/**
 * Credits Recharge (Konnet Credits Recharge TDR §13).
 *
 * A user saying "Recharge" gets their balance and their permanent funding account in one turn.
 *
 * The workflow makes no LLM call at all. Intent resolution already happened in the pipeline, so
 * everything from here is a lookup — which keeps a money-adjacent flow deterministic, free, and
 * immune to a model having an off day.
 */

export const CREDIT_RECHARGE_WORKFLOW_TYPE = 'CreditRecharge';

const STATE_SHOW_ACCOUNT = 'ShowAccount';
const STATE_COMPLETE = 'Complete';

/** Visual separator used in the funding-account block. */
const DIVIDER = '━━━━━━━━━━━━━━━━━━';

export interface CreditRechargeServices extends WorkflowServices {
  readonly wallet: {
    getRechargeView(params: { userId: string; conversationId: string }): Promise<RechargeView>;
  };
}

function servicesOf(context: WorkflowExecutionContext): CreditRechargeServices {
  const services = context.services as Partial<CreditRechargeServices>;

  if (services.wallet === undefined) {
    throw new Error('Credit recharge requires the wallet service.');
  }

  return services as CreditRechargeServices;
}

function fingerprintFor(trigger: WorkflowTrigger): SemanticFingerprint {
  const base = ['recharge', 'credits', 'wallet', 'balance', 'funding'];

  return {
    intent: 'wallet_funding',
    entities: base,
    keywords: [...new Set([...base, ...trigger.text.split(/\s+/).filter((word) => word.length > 2)])],
  };
}

/** Renders the balance and funding-account block (TDR §13.3). */
export function renderRechargeView(view: RechargeView): string {
  const balance = ['Current Balance', `${view.balanceCredits} Credits`];

  if (view.status === 'unavailable') {
    // Never a generic loop and never silence: the user still sees their real balance and is
    // told plainly what is happening (Execution.md §2.5).
    return [
      ...balance,
      '',
      DIVIDER,
      '',
      'Your funding account is being set up and should be ready soon. Please ask again in a few minutes.',
    ].join('\n');
  }

  return [
    ...balance,
    '',
    DIVIDER,
    '',
    'Transfer money to your konnet Funding Account',
    '',
    'Bank:',
    view.bankName,
    '',
    'Account Number:',
    view.accountNumber,
    '',
    'Account Name:',
    view.accountName,
    '',
    DIVIDER,
    '',
    'Your credits will be added automatically once payment is received.',
  ].join('\n');
}

function summaryFor(view: RechargeView): string {
  return view.status === 'ready'
    ? `Credits recharge: showed funding account, balance ${view.balanceCredits} credits.`
    : `Credits recharge: funding account unavailable, balance ${view.balanceCredits} credits.`;
}

const showAccount = {
  name: STATE_SHOW_ACCOUNT,
  allowedTransitions: [STATE_COMPLETE],
  waitsForInput: false,

  async execute(context: WorkflowExecutionContext): Promise<StateExecutionResult> {
    const services = servicesOf(context);

    const view = await services.wallet.getRechargeView({
      userId: context.trigger.conversation.userId,
      conversationId: context.trigger.conversation.id,
    });

    return {
      transitionTo: STATE_COMPLETE,
      status: 'completed',
      response: { text: renderRechargeView(view) },
      summary: summaryFor(view),
      semanticFingerprint: fingerprintFor(context.trigger),
      dataPatch: { balanceAtView: view.balanceCredits, viewStatus: view.status },
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

export const creditRechargeWorkflow: WorkflowDefinition = {
  type: CREDIT_RECHARGE_WORKFLOW_TYPE,
  initialState: STATE_SHOW_ACCOUNT,
  states: [showAccount, complete],

  policy: {
    ...DEFAULT_WORKFLOW_POLICY,
    // Beats Triage (-100) for wallet intents, exactly as VendorOnboarding took over onboarding.
    priority: 50,
    idleExpiryMs: 24 * 60 * 60 * 1_000,
    resumable: true,
    // One funding view per user; a second "Recharge" reuses the same instance.
    allowConcurrentInstances: false,
  },

  startingIntents: ['wallet_funding', 'wallet_balance'],

  initialData: (trigger) => ({ triggerText: trigger.text }),

  initialSummary: () => 'Credits recharge started.',

  initialFingerprint: fingerprintFor,
};
