import type { SemanticFingerprint } from '../../models/workflow-instance';
import type { InformationDensity } from '../../models/capability';
import type { OnboardingFields } from '../../models/vendor';
import { EMPTY_ONBOARDING_FIELDS, mergeFields } from '../../models/vendor';
import type {
  StateExecutionResult,
  WorkflowDefinition,
  WorkflowExecutionContext,
  WorkflowServices,
  WorkflowTrigger,
} from '../workflow-definition';
import { DEFAULT_WORKFLOW_POLICY } from '../workflow-definition';

/**
 * Vendor Onboarding (Vendor-Onboarding.md).
 *
 * The design constraint that shapes every state here is that onboarding must collect the
 * minimum needed to create a Vendor DNA, and nothing more. An informal trader on WhatsApp
 * wants to get back to business, not build a digital profile (CDE "knowledge acquisition
 * under extreme interaction constraints"), so:
 *
 *  - Exactly ONE clarification question is permitted, ever. Remaining uncertainty is kept as
 *    probabilistic hypotheses for the marketplace to resolve later.
 *  - Every message is mined for every outstanding field, so a vendor who volunteers three
 *    things at once is never asked for them again.
 *  - The state is inferred from the city and confirmed conversationally rather than asked for.
 *
 * The engine drives the transitions; the services below only supply extracted information.
 */

export const VENDOR_ONBOARDING_WORKFLOW_TYPE = 'VendorOnboarding';

const STATE_ASK_CAPABILITY = 'AskCapability';
const STATE_AWAIT_CAPABILITY = 'AwaitCapability';
const STATE_AWAIT_CLARIFICATION = 'AwaitClarification';
const STATE_AWAIT_LOCATION = 'AwaitLocation';
const STATE_CONFIRM_STATE = 'ConfirmState';
const STATE_AWAIT_BUSINESS_NAME = 'AwaitBusinessName';
const STATE_CREATE_PROFILE = 'CreateProfile';
const STATE_COMPLETE = 'Complete';

/** Above this the CDE judges the description too vague to leave unclarified. */
const CLARIFICATION_AMBIGUITY_THRESHOLD = 0.55;

/**
 * Densities that leave the engine nothing to work with.
 *
 * Anything at `medium` or above names a real commercial domain and can be expanded into
 * concrete capability hypotheses, so it is worth more than a question.
 */
const CONTENTLESS_DENSITIES: readonly InformationDensity[] = ['very_low', 'low'];

function isContentless(density: InformationDensity | null): boolean {
  return density !== null && CONTENTLESS_DENSITIES.includes(density);
}

/**
 * Services the workflow needs, supplied by the engine.
 *
 * Declared as an interface so the workflow can be unit-tested with fakes and so the
 * capabilities it may reach are explicit.
 */
export interface OnboardingServices extends WorkflowServices {
  readonly extraction: {
    extract(params: { message: string; pendingQuestion: string | null; known: OnboardingFields }): Promise<{
      fields: Partial<OnboardingFields>;
      stateInferredFromCity: boolean;
      inferredState: string | null;
      stateConfidence: number;
      confirmation: 'yes' | 'no' | null;
    }>;
  };
  readonly discovery: {
    observeStatement(params: {
      vendorId: string;
      statement: string;
      source: 'onboarding_statement' | 'clarification_answer';
      priorStatements?: readonly string[];
      conversationId?: string;
      workflowId?: string;
    }): Promise<{
      clarificationQuestion: string | null;
      ambiguityScore: number;
      /** How much the statement actually told the engine; the clarification gate. */
      informationDensity: InformationDensity;
    }>;
  };
  readonly vendors: {
    ensureVendor(params: { userId: string; conversationId: string }): Promise<{ vendorId: string }>;
    finalizeProfile(params: {
      vendorId: string;
      businessName: string;
      city: string;
      state: string;
      summary: string;
    }): Promise<void>;
  };
}

/** Workflow data, persisted between turns. */
interface OnboardingData extends Record<string, unknown> {
  readonly vendorId: string | null;
  readonly fields: OnboardingFields;
  /** Spent at most once — the clarification budget (Vendor-Onboarding.md §2). */
  readonly clarificationAsked: boolean;
  readonly pendingQuestion: string | null;
  /** State proposed to the vendor and awaiting a yes/no. */
  readonly proposedState: string | null;
  readonly statements: readonly string[];
}

function dataOf(context: WorkflowExecutionContext): OnboardingData {
  const data = context.data as Partial<OnboardingData>;

  return {
    vendorId: data.vendorId ?? null,
    fields: data.fields ?? EMPTY_ONBOARDING_FIELDS,
    clarificationAsked: data.clarificationAsked ?? false,
    pendingQuestion: data.pendingQuestion ?? null,
    proposedState: data.proposedState ?? null,
    statements: data.statements ?? [],
  };
}

function servicesOf(context: WorkflowExecutionContext): OnboardingServices {
  const services = context.services as Partial<OnboardingServices>;

  if (
    services.extraction === undefined ||
    services.discovery === undefined ||
    services.vendors === undefined
  ) {
    throw new Error('Vendor onboarding requires the extraction, discovery and vendor services.');
  }

  return services as OnboardingServices;
}

function fingerprintFor(trigger: WorkflowTrigger, fields: OnboardingFields): SemanticFingerprint {
  const entities = [fields.capabilityStatement, fields.businessName, fields.city, fields.state].filter(
    (value): value is string => value !== null,
  );

  return {
    intent: 'vendor_onboarding',
    entities,
    ...(fields.city !== null ? { category: fields.city } : {}),
    keywords: [...new Set([...entities, ...trigger.text.split(/\s+/).filter((word) => word.length > 2)])],
  };
}

/**
 * Picks the next state from what is still missing.
 *
 * Centralised so every state ends the same way: whatever the vendor happened to supply, the
 * workflow always advances to the first genuinely outstanding field rather than to a fixed
 * next step. That is what makes the ordering flexible without the states knowing about
 * each other.
 */
function nextStateFor(data: OnboardingData): string {
  if (data.fields.capabilityStatement === null) return STATE_AWAIT_CAPABILITY;
  if (data.fields.city === null) return STATE_AWAIT_LOCATION;
  if (data.fields.state === null) {
    return data.proposedState !== null ? STATE_CONFIRM_STATE : STATE_AWAIT_LOCATION;
  }
  if (data.fields.businessName === null) return STATE_AWAIT_BUSINESS_NAME;
  return STATE_CREATE_PROFILE;
}

/** The question that goes with a state, so a state never has to hardcode its own prompt twice. */
function questionFor(state: string, data: OnboardingData): string {
  switch (state) {
    case STATE_AWAIT_CAPABILITY:
      return 'What do you sell or what service do you provide?';
    case STATE_AWAIT_LOCATION:
      return data.fields.city === null
        ? 'Which city and state is your business located in?'
        : 'Which state is that in?';
    case STATE_CONFIRM_STATE:
      return `That's ${data.fields.city} in ${data.proposedState} State, right?`;
    case STATE_AWAIT_BUSINESS_NAME:
      return "Lastly, what's your business name?";
    default:
      return '';
  }
}

/**
 * Shared turn handler.
 *
 * Every waiting state runs the same three steps — mine the message for all fields, feed any
 * capability statement to the CDE, then advance to whatever is still missing — because the
 * Information Before Questions principle means no state may assume it received only the
 * answer it asked for.
 */
async function handleTurn(context: WorkflowExecutionContext): Promise<StateExecutionResult> {
  const services = servicesOf(context);
  const data = dataOf(context);
  const { trigger } = context;

  const vendorId =
    data.vendorId ??
    (
      await services.vendors.ensureVendor({
        userId: trigger.conversation.userId,
        conversationId: trigger.conversation.id,
      })
    ).vendorId;

  const extraction = await services.extraction.extract({
    message: trigger.text,
    pendingQuestion: data.pendingQuestion,
    known: data.fields,
  });

  let fields = mergeFields(data.fields, extraction.fields);
  let proposedState = data.proposedState;

  // A confirmation resolves the state that was proposed last turn.
  if (context.instance.currentState === STATE_CONFIRM_STATE && data.proposedState !== null) {
    if (extraction.confirmation === 'yes') {
      fields = { ...fields, state: data.proposedState };
      proposedState = null;
    } else if (extraction.confirmation === 'no') {
      // The vendor rejected the inference; ask outright rather than guessing again.
      proposedState = null;
    }
  }

  if (extraction.inferredState !== null && fields.state === null) {
    proposedState = extraction.inferredState;
  }

  // Feed any new capability statement to the CDE before deciding what to ask next, so the
  // clarification decision is based on the engine's actual uncertainty.
  let clarificationQuestion: string | null = null;
  let ambiguityScore = 0;
  let informationDensity: InformationDensity | null = null;
  const statements = [...data.statements];

  const newStatement = extraction.fields.capabilityStatement;
  if (newStatement !== undefined && newStatement !== null && !statements.includes(newStatement)) {
    const observed = await services.discovery.observeStatement({
      vendorId,
      statement: newStatement,
      source: data.clarificationAsked ? 'clarification_answer' : 'onboarding_statement',
      priorStatements: statements,
      conversationId: trigger.conversation.id,
      workflowId: context.instance.id,
    });

    statements.push(newStatement);
    clarificationQuestion = observed.clarificationQuestion;
    ambiguityScore = observed.ambiguityScore;
    informationDensity = observed.informationDensity;
  }

  // `clarificationAsked` is always written, never left absent: the budget is the one piece of
  // state a reader of the stored row must be able to see without inferring it from a default.
  const patch: Partial<OnboardingData> = {
    vendorId,
    fields,
    statements,
    proposedState,
    clarificationAsked: data.clarificationAsked,
  };

  // The one clarification, spent only when the statement carries too little information to
  // expand at all. After this the budget is gone for good and remaining uncertainty stays in
  // the DNA as hypotheses.
  //
  // Information density is the gate, not ambiguity. "I sell sport materials" is broad but
  // genuinely useful: it names a commercial domain the engine can expand into balls, boots,
  // jerseys and fitness equipment, so asking "what kind?" wastes the vendor's patience on
  // something the platform can work out for itself. Only statements that say nothing at all —
  // "I sell things", "market items", "anything" — leave nothing to expand.
  //
  // This is the CDE's own position: broad statements "are not a problem to solve — they are
  // seeds from which the Capability Discovery System grows an increasingly accurate
  // understanding", and the marketplace refines them afterwards through real evidence.
  const shouldClarify =
    !data.clarificationAsked &&
    clarificationQuestion !== null &&
    isContentless(informationDensity) &&
    ambiguityScore >= CLARIFICATION_AMBIGUITY_THRESHOLD &&
    fields.capabilityStatement !== null;

  if (shouldClarify) {
    return {
      transitionTo: STATE_AWAIT_CLARIFICATION,
      response: { text: clarificationQuestion ?? '' },
      dataPatch: { ...patch, clarificationAsked: true, pendingQuestion: clarificationQuestion },
      summary: `Vendor onboarding: capability "${fields.capabilityStatement}" is ambiguous; asked one clarification.`,
      semanticFingerprint: fingerprintFor(trigger, fields),
    };
  }

  const nextState = nextStateFor({ ...dataOf(context), ...patch } as OnboardingData);

  if (nextState === STATE_CREATE_PROFILE) {
    return {
      transitionTo: STATE_CREATE_PROFILE,
      dataPatch: { ...patch, pendingQuestion: null },
      semanticFingerprint: fingerprintFor(trigger, fields),
    };
  }

  const question = questionFor(nextState, { ...dataOf(context), ...patch } as OnboardingData);

  return {
    transitionTo: nextState,
    response: { text: question },
    dataPatch: { ...patch, pendingQuestion: question },
    summary: summaryFor(fields),
    semanticFingerprint: fingerprintFor(trigger, fields),
  };
}

function summaryFor(fields: OnboardingFields): string {
  const known = [
    fields.capabilityStatement !== null ? `sells "${fields.capabilityStatement}"` : null,
    fields.city !== null ? `in ${fields.city}${fields.state !== null ? `, ${fields.state}` : ''}` : null,
    fields.businessName !== null ? `trading as ${fields.businessName}` : null,
  ].filter((part): part is string => part !== null);

  return `Vendor onboarding: ${known.length > 0 ? known.join(', ') : 'no details captured yet'}.`;
}

/** Entry state: asks the opening question, or skips it if the vendor already said enough. */
const askCapability = {
  name: STATE_ASK_CAPABILITY,
  allowedTransitions: [
    STATE_AWAIT_CAPABILITY,
    STATE_AWAIT_CLARIFICATION,
    STATE_AWAIT_LOCATION,
    STATE_CONFIRM_STATE,
    STATE_AWAIT_BUSINESS_NAME,
    STATE_CREATE_PROFILE,
  ],
  waitsForInput: false,

  async execute(context: WorkflowExecutionContext): Promise<StateExecutionResult> {
    // The message that started onboarding often already contains the answer — "I sell
    // electrical materials" is both the trigger and the capability statement.
    return handleTurn(context);
  },
};

const waitingState = (name: string) => ({
  name,
  allowedTransitions: [
    STATE_AWAIT_CAPABILITY,
    STATE_AWAIT_CLARIFICATION,
    STATE_AWAIT_LOCATION,
    STATE_CONFIRM_STATE,
    STATE_AWAIT_BUSINESS_NAME,
    STATE_CREATE_PROFILE,
  ],
  waitsForInput: true,
  execute: handleTurn,
});

/** Assembles the profile. The vendor is searchable from this moment (Step 5). */
const createProfile = {
  name: STATE_CREATE_PROFILE,
  allowedTransitions: [STATE_COMPLETE],
  waitsForInput: false,

  async execute(context: WorkflowExecutionContext): Promise<StateExecutionResult> {
    const services = servicesOf(context);
    const data = dataOf(context);

    if (data.vendorId === null || data.fields.city === null || data.fields.state === null) {
      throw new Error('Cannot create a vendor profile before the vendor and location are resolved.');
    }

    const businessName = data.fields.businessName ?? '';
    const summary = summaryFor(data.fields);

    await services.vendors.finalizeProfile({
      vendorId: data.vendorId,
      businessName,
      city: data.fields.city,
      state: data.fields.state,
      summary,
    });

    return {
      transitionTo: STATE_COMPLETE,
      response: {
        text: [
          `All set, ${businessName}.`,
          '',
          `You're listed in ${data.fields.city}, ${data.fields.state} State. Buyers looking for what you sell can now find you.`,
          '',
          "I'll check in now and then to learn more about your business — no forms, just a quick question here and there.",
        ].join('\n'),
      },
      dataPatch: { pendingQuestion: null },
      summary: `${summary} Profile created and searchable.`,
      importantEntities: { vendor_id: data.vendorId },
      status: 'completed',
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

export const vendorOnboardingWorkflow: WorkflowDefinition = {
  type: VENDOR_ONBOARDING_WORKFLOW_TYPE,
  initialState: STATE_ASK_CAPABILITY,
  states: [
    askCapability,
    waitingState(STATE_AWAIT_CAPABILITY),
    waitingState(STATE_AWAIT_CLARIFICATION),
    waitingState(STATE_AWAIT_LOCATION),
    waitingState(STATE_CONFIRM_STATE),
    waitingState(STATE_AWAIT_BUSINESS_NAME),
    createProfile,
    complete,
  ],

  policy: {
    ...DEFAULT_WORKFLOW_POLICY,
    // Outranks Triage so a vendor who says "I sell cement" gets real onboarding.
    priority: 50,
    // A week: onboarding abandoned midway is worth resuming, but not indefinitely.
    idleExpiryMs: 7 * 24 * 60 * 60 * 1_000,
    // One vendor, one onboarding.
    allowConcurrentInstances: false,
  },

  startingIntents: ['vendor_onboarding'],

  initialData: (trigger) => ({
    vendorId: null,
    fields: EMPTY_ONBOARDING_FIELDS,
    clarificationAsked: false,
    pendingQuestion: null,
    proposedState: null,
    statements: [] as string[],
    triggerText: trigger.text,
  }),

  initialSummary: () => 'Vendor onboarding started.',

  initialFingerprint: (trigger) => fingerprintFor(trigger, EMPTY_ONBOARDING_FIELDS),
};
