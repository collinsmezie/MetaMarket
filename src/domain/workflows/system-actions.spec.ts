import { encodeActionPayload } from './action-payload';
import { SYSTEM_WORKFLOW_ID, resolveSystemAction } from './system-actions';

/**
 * The routing behind a system-initiated button (TDR §25.7).
 *
 * The guarantee that matters: a tap on "⚡ Recharge Now" reaches the recharge workflow without
 * an LLM in the path and without pretending to continue a workflow that does not exist.
 */
describe('resolveSystemAction', () => {
  it('maps the recharge action to the intent CreditRecharge claims', () => {
    const payload = encodeActionPayload({ workflowId: SYSTEM_WORKFLOW_ID, action: 'recharge' });

    expect(resolveSystemAction(payload)).toEqual({ action: 'recharge', intent: 'wallet_funding' });
  });

  it('ignores an ordinary workflow payload, which names a real instance to resume', () => {
    const payload = encodeActionPayload({ workflowId: 'wf_123', action: 'recharge' });

    expect(resolveSystemAction(payload)).toBeNull();
  });

  it('ignores a system action this deployment does not know', () => {
    // Null means "route normally", never "fail" — an old button must not become a dead end.
    expect(resolveSystemAction('mm|system|teleport')).toBeNull();
  });

  it('ignores text the platform did not mint', () => {
    expect(resolveSystemAction('system recharge please')).toBeNull();
    expect(resolveSystemAction(null)).toBeNull();
  });
});
