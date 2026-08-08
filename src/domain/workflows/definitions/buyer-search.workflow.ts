import type { SemanticFingerprint } from '../../models/workflow-instance';
import { encodeActionPayload } from '../action-payload';
import type {
  StateExecutionResult,
  WorkflowDefinition,
  WorkflowExecutionContext,
  WorkflowServices,
  WorkflowTrigger,
} from '../workflow-definition';
import { DEFAULT_WORKFLOW_POLICY } from '../workflow-definition';

/**
 * Buyer Search with demand-driven fulfilment (MCOS Refinement #11 §1).
 *
 * Resolve → match → rank → deliver the top vendor immediately → notify and bill them → create
 * the request → fan out to the rest → wait → present responders → monitor.
 *
 * Long-running by design: it does not complete when vendors are presented, but stays open while
 * marketplace events arrive (§9). The workflow orchestrates and publishes events; it computes no
 * ranking, no distribution strategy and no billing itself (§10).
 */

export const BUYER_SEARCH_WORKFLOW_TYPE = 'BuyerSearch';

const STATE_RESOLVE = 'ResolveDemand';
const STATE_AWAIT_CLARIFICATION = 'AwaitClarification';
const STATE_PRESENT_IMMEDIATE = 'PresentImmediate';
const STATE_AWAIT_RESPONSES = 'WaitingForVendorResponses';
const STATE_PRESENT_RESPONDERS = 'PresentResponders';
const STATE_COMPLETE = 'Complete';

/** Ranked vendor as the workflow sees it — the engine supplies these, it does not rank. */
interface RankedVendorView {
  readonly vendorId: string;
  readonly businessName: string;
  readonly city: string | null;
  readonly state: string | null;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface BuyerSearchServices extends WorkflowServices {
  readonly matching: {
    match(params: { query: string; history?: readonly string[]; customerCity?: string | null }): Promise<
      | {
          outcome: 'ranked';
          resolved: {
            demand: { products: readonly string[]; rawQuery: string };
            primaryCapabilities: readonly { id: string; name: string }[];
          };
          vendors: readonly RankedVendorView[];
        }
      | { outcome: 'clarification_needed'; question: string; options: readonly string[] }
      | { outcome: 'no_capability' }
    >;
  };
  readonly distribution: {
    distribute(params: {
      conversationId: string;
      workflowId: string;
      customerId: string;
      query: string;
      capabilityId: string | null;
      capabilityName: string | null;
      product: string | null;
      customerCity: string | null;
      ranked: readonly RankedVendorView[];
    }): Promise<{
      requestId: string;
      immediate: readonly RankedVendorView[];
      fannedOut: readonly RankedVendorView[];
    }>;
    revealedVendors(requestId: string): Promise<readonly { vendorId: string; rank: number }[]>;
    recordSelection(params: { requestId: string; vendorId: string }): Promise<void>;
  };
}

interface BuyerSearchData extends Record<string, unknown> {
  readonly query: string;
  readonly requestId: string | null;
  readonly capabilityId: string | null;
  readonly capabilityName: string | null;
  readonly presentedVendorIds: readonly string[];
  readonly clarificationAsked: boolean;
}

function dataOf(context: WorkflowExecutionContext): BuyerSearchData {
  const data = context.data as Partial<BuyerSearchData>;

  return {
    query: data.query ?? '',
    requestId: data.requestId ?? null,
    capabilityId: data.capabilityId ?? null,
    capabilityName: data.capabilityName ?? null,
    presentedVendorIds: data.presentedVendorIds ?? [],
    clarificationAsked: data.clarificationAsked ?? false,
  };
}

function servicesOf(context: WorkflowExecutionContext): BuyerSearchServices {
  const services = context.services as Partial<BuyerSearchServices>;

  if (services.matching === undefined || services.distribution === undefined) {
    throw new Error('Buyer search requires the matching and distribution services.');
  }

  return services as BuyerSearchServices;
}

function fingerprintFor(trigger: WorkflowTrigger, query: string): SemanticFingerprint {
  const products = (trigger.semanticRequest?.products ?? []).flatMap((product) => [
    product.normalized,
    ...product.aliases,
  ]);

  return {
    intent: 'buyer_product_search',
    entities: [...new Set([query, ...products])],
    ...(trigger.semanticRequest?.category !== undefined
      ? { category: trigger.semanticRequest.category.name }
      : {}),
    keywords: [...new Set([...query.split(/\s+/).filter((word) => word.length > 2), ...products])],
  };
}

/** Formats vendor cards for the customer. */
function renderVendors(vendors: readonly RankedVendorView[], workflowId: string) {
  const text = vendors
    .map((vendor, index) => {
      const place =
        vendor.city !== null ? ` — ${vendor.city}${vendor.state !== null ? `, ${vendor.state}` : ''}` : '';
      // One reason, not all of them: a WhatsApp message full of justification is unreadable.
      const reason = vendor.reasons[0] !== undefined ? `\n   ${vendor.reasons[0]}` : '';
      return `${index + 1}. *${vendor.businessName}*${place}${reason}`;
    })
    .join('\n\n');

  const actions = vendors.slice(0, 3).map((vendor) => ({
    type: 'select_vendor',
    title: vendor.businessName.slice(0, 20),
    // Carries the workflow id, so a tap resumes this exact search deterministically.
    payload: encodeActionPayload({ workflowId, action: 'select', value: vendor.vendorId }),
  }));

  return { text, actions };
}

const resolveDemand = {
  name: STATE_RESOLVE,
  allowedTransitions: [
    STATE_AWAIT_CLARIFICATION,
    STATE_AWAIT_RESPONSES,
    STATE_PRESENT_IMMEDIATE,
    STATE_COMPLETE,
  ],
  waitsForInput: false,

  async execute(context: WorkflowExecutionContext): Promise<StateExecutionResult> {
    const services = servicesOf(context);
    const data = dataOf(context);
    const { trigger } = context;

    const query = data.query.length > 0 ? data.query : trigger.text;

    const customerCity = trigger.conversation.memory.facts['location.city']?.value;

    const result = await services.matching.match({
      query,
      history: trigger.recentHistory.slice(-4).map((entry) => `${entry.role}: ${entry.content}`),
      customerCity: typeof customerCity === 'string' ? customerCity : null,
    });

    const resolvedProduct =
      result.outcome === 'ranked'
        ? (result as any).resolvedProduct ??
          result.resolved.primaryCapabilities[0]?.name ??
          result.resolved.demand.products[0] ??
          query
        : query;

    if (result.outcome === 'clarification_needed') {
      return {
        transitionTo: STATE_AWAIT_CLARIFICATION,
        response: { text: result.question },
        dataPatch: { query, clarificationAsked: true },
        summary: `Buyer search: "${query}" is ambiguous; asked which type.`,
        semanticFingerprint: fingerprintFor(trigger, query),
      };
    }

    if (result.outcome === 'no_capability' || result.vendors.length === 0) {
      return {
        transitionTo: STATE_AWAIT_RESPONSES,
        response: {
          text: "We're on it. We'll notify you as soon as we find the right vendors that can fulfill your request.",
        },
        dataPatch: { query, resolvedProduct },
        summary: `Buyer search for "${resolvedProduct}": Optimistic fallback issued while searching vendors.`,
        semanticFingerprint: fingerprintFor(trigger, query),
      };
    }

    const capability = result.resolved.primaryCapabilities[0] ?? null;

    const distribution = await services.distribution.distribute({
      conversationId: trigger.conversation.id,
      workflowId: context.instance.id,
      customerId: trigger.conversation.userId,
      query,
      capabilityId: capability?.id ?? null,
      capabilityName: capability?.name ?? resolvedProduct,
      product: resolvedProduct,
      customerCity: typeof customerCity === 'string' ? customerCity : null,
      ranked: result.vendors,
    });

    if (distribution.immediate.length === 0) {
      const waitingCount = distribution.fannedOut.length;
      return {
        transitionTo: STATE_AWAIT_RESPONSES,
        response: {
          text: `We're on it. We'll notify you as soon as we find the right vendors that can fulfill your request for *${resolvedProduct}*.${
            waitingCount > 0 ? ` (Fanned out to ${waitingCount} vendor${waitingCount === 1 ? '' : 's'})` : ''
          }`,
        },
        dataPatch: {
          query,
          resolvedProduct,
          requestId: distribution.requestId,
          capabilityId: capability?.id ?? null,
          capabilityName: capability?.name ?? resolvedProduct,
          presentedVendorIds: [],
        },
        summary: `Buyer search: "${resolvedProduct}". Awaiting ${waitingCount} fanned out vendors.`,
        semanticFingerprint: fingerprintFor(trigger, query),
        importantEntities: { request_id: distribution.requestId },
      };
    }

    const rendered = renderVendors(distribution.immediate, context.instance.id);

    const waiting =
      distribution.fannedOut.length > 0
        ? `\n\nI have also asked ${distribution.fannedOut.length} other supplier${distribution.fannedOut.length === 1 ? '' : 's'} — I will send them over as they reply.`
        : '';

    return {
      transitionTo: STATE_AWAIT_RESPONSES,
      response: {
        text: `Here ${distribution.immediate.length === 1 ? 'is' : 'are'} the best match${distribution.immediate.length === 1 ? '' : 'es'} for *${resolvedProduct}*:\n\n${rendered.text}${waiting}`,
        actions: rendered.actions,
      },
      dataPatch: {
        query,
        resolvedProduct,
        requestId: distribution.requestId,
        capabilityId: capability?.id ?? null,
        capabilityName: capability?.name ?? resolvedProduct,
        presentedVendorIds: distribution.immediate.map((vendor) => vendor.vendorId),
      },
      summary: `Buyer search: "${resolvedProduct}". Delivered ${distribution.immediate.length} vendor(s), awaiting ${distribution.fannedOut.length} more.`,
      semanticFingerprint: fingerprintFor(trigger, query),
      importantEntities: { request_id: distribution.requestId },
    };
  },
};

const awaitClarification = {
  name: STATE_AWAIT_CLARIFICATION,
  allowedTransitions: [STATE_RESOLVE],
  waitsForInput: true,

  async execute(context: WorkflowExecutionContext): Promise<StateExecutionResult> {
    const data = dataOf(context);

    // Re-run resolution with the clarified query. The budget is spent, so the ambiguity check
    // will not fire again on the next pass.
    return {
      transitionTo: STATE_RESOLVE,
      dataPatch: { query: `${data.query} ${context.trigger.text}`.trim() },
    };
  },
};

const presentImmediate = {
  name: STATE_PRESENT_IMMEDIATE,
  allowedTransitions: [STATE_AWAIT_RESPONSES],
  waitsForInput: false,

  async execute(): Promise<StateExecutionResult> {
    // Reserved for flows that split delivery from resolution; resolution presents directly today.
    return { transitionTo: STATE_AWAIT_RESPONSES };
  },
};

const awaitResponses = {
  name: STATE_AWAIT_RESPONSES,
  allowedTransitions: [STATE_PRESENT_RESPONDERS, STATE_AWAIT_RESPONSES, STATE_COMPLETE],
  waitsForInput: true,

  async execute(context: WorkflowExecutionContext): Promise<StateExecutionResult> {
    const services = servicesOf(context);
    const data = dataOf(context);
    const { trigger } = context;

    // A tap on a vendor card is the customer choosing — the strongest evidence signal there is.
    if (trigger.interactivePayload !== null && data.requestId !== null) {
      const [, , action, chosen] = trigger.interactivePayload.split('|');

      // The action is checked, not just the position. Reading the fourth segment of whatever
      // arrives would let any other button's payload be recorded as a vendor selection — and
      // `vendor.selected` is the strongest signal the Evidence Service accepts, so a wrong one
      // is expensive to unlearn.
      if (action === 'select' && chosen !== undefined && chosen.length > 0) {
        await services.distribution.recordSelection({ requestId: data.requestId, vendorId: chosen });

        return {
          transitionTo: STATE_COMPLETE,
          response: {
            text: 'Good choice — I have let them know you are interested. Did they have what you needed?',
          },
          summary: `${context.instance.summary} Customer selected a vendor.`,
          status: 'completed',
        };
      }
    }

    if (data.requestId === null) {
      return { transitionTo: STATE_COMPLETE, status: 'completed' };
    }

    // Otherwise the customer said something while waiting: show anyone who has replied since.
    const revealed = await services.distribution.revealedVendors(data.requestId);
    const fresh = revealed.filter((entry) => !data.presentedVendorIds.includes(entry.vendorId));

    if (fresh.length === 0) {
      return {
        response: { text: 'Still waiting on the other suppliers — I will send them the moment they reply.' },
      };
    }

    return {
      transitionTo: STATE_PRESENT_RESPONDERS,
      dataPatch: {
        presentedVendorIds: [...data.presentedVendorIds, ...fresh.map((entry) => entry.vendorId)],
      },
    };
  },
};

const presentResponders = {
  name: STATE_PRESENT_RESPONDERS,
  allowedTransitions: [STATE_AWAIT_RESPONSES, STATE_COMPLETE],
  waitsForInput: false,

  async execute(context: WorkflowExecutionContext): Promise<StateExecutionResult> {
    const data = dataOf(context);

    return {
      transitionTo: STATE_AWAIT_RESPONSES,
      response: {
        text: `${data.presentedVendorIds.length} supplier${data.presentedVendorIds.length === 1 ? ' has' : 's have'} confirmed they can help. Reply with a number to pick one.`,
      },
      summary: `${context.instance.summary} Presented responding vendors.`,
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

export const buyerSearchWorkflow: WorkflowDefinition = {
  type: BUYER_SEARCH_WORKFLOW_TYPE,
  initialState: STATE_RESOLVE,
  states: [resolveDemand, awaitClarification, presentImmediate, awaitResponses, presentResponders, complete],

  policy: {
    ...DEFAULT_WORKFLOW_POLICY,
    // Outranks Triage for buyer intent.
    priority: 50,
    // Matches the request TTL: a search outlives the conversation turn that started it.
    idleExpiryMs: 24 * 60 * 60 * 1_000,
    // Several simultaneous searches are expected (MCOS §17).
    allowConcurrentInstances: true,
  },

  startingIntents: ['buyer_product_search'],

  initialData: (trigger) => ({
    query: trigger.text,
    requestId: null,
    capabilityId: null,
    capabilityName: null,
    presentedVendorIds: [] as string[],
    clarificationAsked: false,
  }),

  initialSummary: (trigger) => `Buyer search started for: "${trigger.text.slice(0, 120)}"`,

  initialFingerprint: (trigger) => fingerprintFor(trigger, trigger.text),
};
