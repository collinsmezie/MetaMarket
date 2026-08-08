import { decodeActionPayload, encodeActionPayload } from './action-payload';

/**
 * Vendor answers to a fanned-out request (Buyer Search Workflow TDR §5).
 */

export const VENDOR_RESPONSE_WORKFLOW_ID = 'vendor-response';

export type VendorOptionCode =
  | 'YES_HAVE_IT'
  | 'NO_DONT_HAVE'
  | 'CAN_GET_IT'
  | 'REFER_SOMEONE'
  | 'NOT_MY_LINE';

export interface VendorResponseAction {
  readonly requestId: string;
  readonly options: readonly VendorOptionCode[];
  /** Legacy flag: true if any option is YES_HAVE_IT or CAN_GET_IT. */
  readonly accepted: boolean;
}

const ACTION_MAP: Record<string, VendorOptionCode> = {
  accept: 'YES_HAVE_IT',
  decline: 'NO_DONT_HAVE',
  opt1: 'YES_HAVE_IT',
  opt2: 'NO_DONT_HAVE',
  opt3: 'CAN_GET_IT',
  opt4: 'REFER_SOMEONE',
  opt5: 'NOT_MY_LINE',
};

const CODE_ACTION_MAP: Record<VendorOptionCode, string> = {
  YES_HAVE_IT: 'opt1',
  NO_DONT_HAVE: 'opt2',
  CAN_GET_IT: 'opt3',
  REFER_SOMEONE: 'opt4',
  NOT_MY_LINE: 'opt5',
};

/** Mints the button payload carried out to the vendor. */
export function encodeVendorResponse(params: {
  requestId: string;
  accepted?: boolean;
  option?: VendorOptionCode;
}): string {
  const action = params.option
    ? CODE_ACTION_MAP[params.option]
    : params.accepted
      ? 'opt1'
      : 'opt2';

  return encodeActionPayload({
    workflowId: VENDOR_RESPONSE_WORKFLOW_ID,
    action,
    value: params.requestId,
  });
}

/**
 * Reads a vendor's answer out of an interactive payload.
 */
export function resolveVendorResponse(interactivePayload: string | null): VendorResponseAction | null {
  if (interactivePayload === null) return null;

  const decoded = decodeActionPayload(interactivePayload);
  if (decoded === null || decoded.workflowId !== VENDOR_RESPONSE_WORKFLOW_ID) return null;

  const option = ACTION_MAP[decoded.action];
  if (option === undefined) return null;
  if (decoded.value === undefined || decoded.value.length === 0) return null;

  const accepted = option === 'YES_HAVE_IT' || option === 'CAN_GET_IT';

  return {
    requestId: decoded.value,
    options: [option],
    accepted,
  };
}

/**
 * Parses numeric, range, comma-separated, or text-based vendor replies into option codes (TDR §5.2).
 */
export function parseVendorTextResponse(text: string): readonly VendorOptionCode[] {
  const normalized = text.trim().toLowerCase();
  if (normalized.length === 0) return [];

  const found = new Set<VendorOptionCode>();

  // Parse numbers and ranges like "1", "1, 3", "1-4", "1 and 3", "3, 4"
  const rangeRegex = /(\d)\s*[-–—]\s*(\d)/g;
  let match: RegExpExecArray | null;
  while ((match = rangeRegex.exec(normalized)) !== null) {
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
      const code = optionFromDigit(i);
      if (code) found.add(code);
    }
  }

  // Single digits or comma/space separated digits
  const digitRegex = /\b([1-5])\b/g;
  while ((match = digitRegex.exec(normalized)) !== null) {
    const code = optionFromDigit(parseInt(match[1], 10));
    if (code) found.add(code);
  }

  // Text intent matching if no digits matched or alongside text
  if (found.size === 0) {
    if (
      normalized.includes('yes') ||
      normalized.includes('have it') ||
      normalized.includes('in stock') ||
      normalized.includes('available')
    ) {
      found.add('YES_HAVE_IT');
    }
    if (
      normalized.includes("don't have") ||
      normalized.includes('no stock') ||
      normalized.includes('out of stock') ||
      normalized.includes('not available') ||
      normalized.startsWith('no')
    ) {
      found.add('NO_DONT_HAVE');
    }
    if (
      normalized.includes('can get') ||
      normalized.includes('can source') ||
      normalized.includes('can procure') ||
      normalized.includes('get it')
    ) {
      found.add('CAN_GET_IT');
    }
    if (
      normalized.includes('refer') ||
      normalized.includes('referral') ||
      normalized.includes('know someone')
    ) {
      found.add('REFER_SOMEONE');
    }
    if (
      normalized.includes('not my line') ||
      normalized.includes("don't sell") ||
      normalized.includes('wrong business') ||
      normalized.includes('not my business')
    ) {
      found.add('NOT_MY_LINE');
    }
  }

  return [...found];
}

function optionFromDigit(digit: number): VendorOptionCode | null {
  switch (digit) {
    case 1:
      return 'YES_HAVE_IT';
    case 2:
      return 'NO_DONT_HAVE';
    case 3:
      return 'CAN_GET_IT';
    case 4:
      return 'REFER_SOMEONE';
    case 5:
      return 'NOT_MY_LINE';
    default:
      return null;
  }
}

