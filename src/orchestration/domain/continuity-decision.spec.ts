import { deterministicContinuity, toLegacyRelationship } from './continuity-decision';

const workflow = (workflowId: string, workflowType: string, status: string) => ({
  workflowId,
  workflowType,
  status,
  resumable: true,
});
const intent = (intentId: string, type: string) => ({ intentId, type, workflowIds: [] });

describe('deterministicContinuity', () => {
  it('needs no model when there is nothing to relate to', () => {
    const result = deterministicContinuity({
      active: [],
      suspended: [],
      intents: [intent('i1', 'BUY')],
      answeringClarification: false,
      explicitWorkflowId: null,
    });
    expect(result?.primary).toBe('NO_WORKFLOW_CONTEXT');
  });

  it('follows an explicit workflow reference and an answered clarification', () => {
    const active = [workflow('wf1', 'BuyerSearch', 'active')];
    expect(
      deterministicContinuity({
        active,
        suspended: [workflow('wf2', 'VendorOnboarding', 'suspended')],
        intents: [],
        answeringClarification: false,
        explicitWorkflowId: 'wf2',
      }),
    ).toMatchObject({ primary: 'RESUME', relationships: [{ workflowIds: ['wf2'] }] });
    expect(
      deterministicContinuity({
        active,
        suspended: [],
        intents: [intent('i1', 'CLARIFY')],
        answeringClarification: true,
        explicitWorkflowId: null,
      })?.primary,
    ).toBe('CONTINUATION');
  });

  it('resolves single control intents deterministically and defers the rest to P2', () => {
    const active = [workflow('wf1', 'BuyerSearch', 'active')];
    expect(
      deterministicContinuity({
        active,
        suspended: [],
        intents: [intent('i1', 'CANCEL')],
        answeringClarification: false,
        explicitWorkflowId: null,
      })?.primary,
    ).toBe('CANCELLATION');
    expect(
      deterministicContinuity({
        active,
        suspended: [],
        intents: [intent('i1', 'FIND_PRODUCT')],
        answeringClarification: false,
        explicitWorkflowId: null,
      }),
    ).toBeNull();
  });

  it('maps onto the legacy relationship vocabulary for the workflow trigger', () => {
    expect(toLegacyRelationship('WORKFLOW_SWITCH', false)).toBe('topic_shift');
    expect(toLegacyRelationship('NEW_WORKFLOW', true)).toBe('answer');
    expect(toLegacyRelationship('CANCELLATION', false)).toBe('cancel');
  });
});
