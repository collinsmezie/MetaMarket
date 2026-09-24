import type { Response } from '../../domain/models/response';

export const FAST_PATH = Symbol('FastPath');

export interface FastPathInput {
  readonly conversationId: string;
  readonly userId: string;
  readonly text: string;
  readonly interactivePayload: string | null;
}

/**
 * Deterministic fast paths that bypass semantic orchestration (MCOS TDR §30).
 *
 * A vendor answering a fanned-out request with a known quote/interactive action is decisive on
 * its payload alone: no specialist, no plan, no model. Returns null when the turn is not a fast
 * path — never a guess.
 */
export interface FastPathPort {
  tryHandle(input: FastPathInput): Promise<Response | null>;
}
