/**
 * Workflow capability catalogue (MCOS TDR §16, §18, §21, §34A.4 "available workflow
 * capabilities", Overarching §20).
 *
 * The planner — model-assisted or deterministic — may only propose actions on capabilities
 * declared here; the deterministic execution layer rejects anything else (P3 rule 5 "do not
 * invent unsupported workflow capabilities"). Each capability declares which IDCE intent types it
 * serves, which operations it supports, the state it mutates (conflict keys, §18) and whether it
 * is parallel-safe (§17). Intent is not workflow (IDCE §3.4): the mapping lives here, in the
 * orchestrator, not in the taxonomy and not in the workflow definitions.
 */

export const WORKFLOW_OPERATIONS = ['START', 'CONTINUE', 'RESUME', 'MODIFY', 'CANCEL'] as const;

/**
 * Whether downstream semantic processing (Enrichment → GPC) must finish before the workflow
 * runs (final decision lock: GPC must not universally block MarketConcept-first discovery).
 * REQUIRED blocks execution, OPTIONAL is awaited briefly, BACKGROUND never blocks.
 */
export type TaxonomyBlockingPolicy = 'REQUIRED' | 'OPTIONAL' | 'BACKGROUND';
export type WorkflowOperation = (typeof WORKFLOW_OPERATIONS)[number];

export interface WorkflowCapability {
  readonly workflowType: string;
  /** IDCE intent types this capability serves when the turn starts new work. */
  readonly intentTypes: readonly string[];
  readonly operations: readonly WorkflowOperation[];
  /** Legacy starting-intent label the current workflow definition expects (migration seam). */
  readonly legacyIntent: (intentType: string) => string;
  /** Mutable state touched by an action of this capability (§18); scoped at plan time. */
  readonly conflictKeys: (scope: {
    conversationId: string;
    userId: string;
    workflowId: string | null;
  }) => readonly string[];
  /** Whether the domain declares this capability safe to run beside other actions (§17). */
  readonly parallelSafe: boolean;
  /** How this capability depends on Enrichment/GPC having completed for the turn's objects. */
  readonly taxonomyPolicy: TaxonomyBlockingPolicy;
  readonly description: string;
}

/** Deterministic conversation-level replies that need no workflow (Overarching §20 Greeting/Random). */
export const PLATFORM_REPLY_INTENTS: ReadonlySet<string> = new Set([
  'GREETING',
  'THANKS',
  'ACKNOWLEDGE',
  'NON_ACTIONABLE',
]);

/** Conversation-control intents that act on existing work rather than starting new work. */
export const CONTROL_INTENTS: ReadonlySet<string> = new Set([
  'CANCEL',
  'RESUME',
  'CONFIRM',
  'DENY',
  'CORRECT',
  'CLARIFY',
  'PAUSE',
  'REPEAT',
  'REPHRASE',
]);

export const CAPABILITY_CATALOGUE: readonly WorkflowCapability[] = [
  {
    workflowType: 'BuyerSearch',
    intentTypes: [
      'BUY',
      'FIND_PRODUCT',
      'FIND_VENDOR',
      'FIND_SERVICE',
      'SEARCH',
      'DISCOVER',
      'RECOMMEND',
      'COMPARE',
      'ALTERNATIVES',
      'SUBSTITUTE',
      'REQUEST_QUOTE',
      'PLACE_ORDER',
      'PRICE_INQUIRY',
      'AVAILABILITY_INQUIRY',
      'PRODUCT_INFORMATION',
      'VENDOR_INFORMATION',
      'DELIVERY_INFORMATION',
      'LOCATION_INFORMATION',
      'NEGOTIATE',
    ],
    operations: ['START', 'CONTINUE', 'RESUME', 'MODIFY', 'CANCEL'],
    legacyIntent: () => 'buyer_product_search',
    conflictKeys: ({ conversationId, workflowId }) => [
      `conversation:${conversationId}`,
      ...(workflowId === null ? [] : [`workflow:${workflowId}`]),
    ],
    parallelSafe: false,
    taxonomyPolicy: 'BACKGROUND',
    description:
      'Buyer demand → vendor discovery, reveal and fan-out; price and availability enquiries route to the same discovery flow with a caveat.',
  },
  {
    workflowType: 'VendorOnboarding',
    intentTypes: [
      'SELL',
      'OFFER',
      'START_VENDOR_ONBOARDING',
      'CONTINUE_VENDOR_ONBOARDING',
      'UPDATE_INVENTORY',
      'UPDATE_CAPABILITY',
      'UPDATE_LOCATION',
      'UPDATE_SERVICE_AREA',
      'UPDATE_PROFILE',
    ],
    operations: ['START', 'CONTINUE', 'RESUME', 'MODIFY', 'CANCEL'],
    legacyIntent: () => 'vendor_onboarding',
    conflictKeys: ({ conversationId, userId, workflowId }) => [
      `conversation:${conversationId}`,
      `vendor-profile:${userId}`,
      ...(workflowId === null ? [] : [`workflow:${workflowId}`]),
    ],
    parallelSafe: false,
    taxonomyPolicy: 'BACKGROUND',
    description: 'Vendor registration and capability declaration.',
  },
  {
    workflowType: 'CreditRecharge',
    intentTypes: ['RECHARGE_CREDITS', 'CHECK_BALANCE', 'VIEW_ACCOUNT'],
    operations: ['START', 'CONTINUE', 'RESUME', 'CANCEL'],
    legacyIntent: (intentType) => (intentType === 'RECHARGE_CREDITS' ? 'wallet_funding' : 'wallet_balance'),
    conflictKeys: ({ conversationId, userId, workflowId }) => [
      `conversation:${conversationId}`,
      `wallet:${userId}`,
      ...(workflowId === null ? [] : [`workflow:${workflowId}`]),
    ],
    parallelSafe: false,
    taxonomyPolicy: 'BACKGROUND',
    description: 'Konnet credit balance and recharge (payment link).',
  },
  {
    workflowType: 'PlatformInfo',
    intentTypes: ['PLATFORM_INFORMATION', 'POLICY_INFORMATION', 'HELP', 'CONTACT_SUPPORT', 'REPORT_PROBLEM'],
    operations: ['START'],
    legacyIntent: (intentType) => (intentType === 'HELP' ? 'help' : 'platform_faq'),
    conflictKeys: ({ conversationId }) => [`conversation:${conversationId}`],
    parallelSafe: true,
    taxonomyPolicy: 'BACKGROUND',
    description: 'Answers questions about the platform itself (fees, how it works).',
  },
  {
    workflowType: 'Triage',
    intentTypes: ['UNKNOWN_INTENT', 'OUT_OF_SCOPE'],
    operations: ['START', 'CONTINUE', 'RESUME'],
    legacyIntent: () => 'unknown',
    conflictKeys: ({ conversationId }) => [`conversation:${conversationId}`],
    parallelSafe: false,
    taxonomyPolicy: 'BACKGROUND',
    description: 'Works out whether the user is buying or selling when nothing else can.',
  },
];

const BY_INTENT = new Map<string, WorkflowCapability>();
for (const capability of CAPABILITY_CATALOGUE) {
  for (const intentType of capability.intentTypes) {
    if (!BY_INTENT.has(intentType)) BY_INTENT.set(intentType, capability);
  }
}
const BY_TYPE = new Map(CAPABILITY_CATALOGUE.map((capability) => [capability.workflowType, capability]));

export function capabilityForIntent(intentType: string): WorkflowCapability | null {
  return BY_INTENT.get(intentType) ?? null;
}

export function capabilityForWorkflowType(workflowType: string): WorkflowCapability | null {
  return BY_TYPE.get(workflowType) ?? null;
}

/** Compact catalogue view handed to the P3 planner as DATA (§34A.4 inputs). */
export function describeCatalogue(): readonly Record<string, unknown>[] {
  return CAPABILITY_CATALOGUE.map((capability) => ({
    workflow_type: capability.workflowType,
    intent_types: capability.intentTypes,
    operations: capability.operations,
    parallel_safe: capability.parallelSafe,
    taxonomy_policy: capability.taxonomyPolicy,
    description: capability.description,
  }));
}
