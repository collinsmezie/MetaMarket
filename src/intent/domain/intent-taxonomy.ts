/**
 * IDCE intent taxonomy — the authoritative base vocabulary (IDCE TDR v1.6 §4, §22.5).
 *
 * Intent is not workflow (§3.4): these are user objectives, mapped to workflow operations by
 * LangGraph's routing policy. Implementations reject values outside this vocabulary unless an
 * explicit extension namespace is enabled (§22.5).
 */

export const INTENT_TAXONOMY_VERSION = 'idce-taxonomy-1.6';

export const COMMERCIAL_TRANSACTION_INTENTS = [
  'BUY',
  'SELL',
  'OFFER',
  'REQUEST_QUOTE',
  'PLACE_ORDER',
  'CANCEL_ORDER',
  'MODIFY_ORDER',
  'CONFIRM_PURCHASE',
  'NEGOTIATE',
] as const;

export const DISCOVERY_INTENTS = [
  'FIND_PRODUCT',
  'FIND_VENDOR',
  'FIND_SERVICE',
  'SEARCH',
  'DISCOVER',
  'RECOMMEND',
  'COMPARE',
  'ALTERNATIVES',
  'SUBSTITUTE',
] as const;

export const INFORMATION_INTENTS = [
  'PRICE_INQUIRY',
  'AVAILABILITY_INQUIRY',
  'PRODUCT_INFORMATION',
  'VENDOR_INFORMATION',
  'DELIVERY_INFORMATION',
  'LOCATION_INFORMATION',
  'PLATFORM_INFORMATION',
  'POLICY_INFORMATION',
] as const;

export const ACCOUNT_INTENTS = [
  'RECHARGE_CREDITS',
  'CHECK_BALANCE',
  'VIEW_ACCOUNT',
  'UPDATE_PROFILE',
  'CHANGE_SETTINGS',
  'HELP',
  'CONTACT_SUPPORT',
  'REPORT_PROBLEM',
] as const;

export const CONVERSATION_CONTROL_INTENTS = [
  'GREETING',
  'THANKS',
  'ACKNOWLEDGE',
  'CONFIRM',
  'DENY',
  'CORRECT',
  'CLARIFY',
  'CANCEL',
  'RESUME',
  'PAUSE',
  'REPEAT',
  'REPHRASE',
] as const;

export const VENDOR_WORKFLOW_INTENTS = [
  'START_VENDOR_ONBOARDING',
  'CONTINUE_VENDOR_ONBOARDING',
  'UPDATE_INVENTORY',
  'UPDATE_CAPABILITY',
  'UPDATE_LOCATION',
  'UPDATE_SERVICE_AREA',
] as const;

export const META_INTENTS = ['NON_ACTIONABLE', 'OUT_OF_SCOPE', 'UNKNOWN_INTENT'] as const;

export const INTENT_TYPES = [
  ...COMMERCIAL_TRANSACTION_INTENTS,
  ...DISCOVERY_INTENTS,
  ...INFORMATION_INTENTS,
  ...ACCOUNT_INTENTS,
  ...CONVERSATION_CONTROL_INTENTS,
  ...VENDOR_WORKFLOW_INTENTS,
  ...META_INTENTS,
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];

const INTENT_TYPE_SET: ReadonlySet<string> = new Set(INTENT_TYPES);

export function isIntentType(value: string): value is IntentType {
  return INTENT_TYPE_SET.has(value);
}

/** Grouped view supplied to the prompt so the model sees the vocabulary it may use. */
export const INTENT_TAXONOMY_GROUPS = {
  commercial_transaction: COMMERCIAL_TRANSACTION_INTENTS,
  discovery_and_marketplace: DISCOVERY_INTENTS,
  information: INFORMATION_INTENTS,
  account_and_system: ACCOUNT_INTENTS,
  conversation_control: CONVERSATION_CONTROL_INTENTS,
  vendor_workflow: VENDOR_WORKFLOW_INTENTS,
  unsupported_or_meta: META_INTENTS,
} as const;

/** Execution relations that must stay acyclic (IDCE §18.3 rule 12). */
export const EXECUTION_RELATION_TYPES = ['DEPENDS_ON', 'REQUIRES', 'PRECEDES'] as const;
