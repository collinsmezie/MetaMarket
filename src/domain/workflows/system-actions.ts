import { decodeActionPayload } from './action-payload';

/**
 * System actions — buttons the platform offers outside any workflow instance.
 *
 * Every ordinary action payload names the workflow that minted it, so a tap resumes that exact
 * instance (action-payload.ts). System-initiated pushes have no instance to name: the wallet's
 * missed-lead notification (Konnet Credits Recharge TDR §25.7) is sent by a listener, not by a
 * workflow turn, and the vendor tapping "⚡ Recharge Now" is starting something new rather than
 * continuing anything.
 *
 * `system` is therefore a reserved, non-instance workflow id, and the action maps deterministically
 * to a starting intent. Deterministic matters twice over: a tapped button carries no ambiguity to
 * resolve, and routing a money flow through an LLM classification would make it fail whenever the
 * model does.
 */

/** Reserved workflow id. No instance may ever use it, so no tap can resume one by accident. */
export const SYSTEM_WORKFLOW_ID = 'system';

/**
 * Action → the intent it starts.
 *
 * `wallet_funding` is claimed by CreditRecharge at priority 50, so the tap lands in the recharge
 * workflow with no payment code of its own.
 */
const SYSTEM_ACTION_INTENTS: Readonly<Record<string, string>> = {
  recharge: 'wallet_funding',
};

export interface SystemAction {
  readonly action: string;
  readonly intent: string;
}

/**
 * Reads a system action from an interactive payload.
 *
 * Returns null for anything else — an ordinary workflow payload, a payload the platform did not
 * mint, or a `system` action this deployment does not recognise. A null means "route normally",
 * never "fail", so an unknown action degrades to ordinary understanding rather than a dead end.
 */
export function resolveSystemAction(interactivePayload: string | null): SystemAction | null {
  if (interactivePayload === null) return null;

  const decoded = decodeActionPayload(interactivePayload);
  if (decoded === null || decoded.workflowId !== SYSTEM_WORKFLOW_ID) return null;

  const intent = SYSTEM_ACTION_INTENTS[decoded.action];
  if (intent === undefined) return null;

  return { action: decoded.action, intent };
}
