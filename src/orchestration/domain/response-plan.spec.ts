import type { ResponseArtifact } from './action-plan';
import { composeArtifacts, isDeliverable, orderArtifacts } from './response-plan';

const artifact = (
  actionId: string,
  text: string,
  overrides: Partial<ResponseArtifact> = {},
): ResponseArtifact => ({
  actionId,
  relevance: 1,
  priority: 0.5,
  text,
  actions: [],
  media: undefined,
  metadata: {},
  audience: 'USER',
  dependencies: [],
  status: 'READY',
  ...overrides,
});

describe('response planning', () => {
  it('orders the primary objective first and limitations last (§28)', () => {
    const ordered = orderArtifacts([
      artifact('a3', 'could not fetch price', { priority: 0.9, metadata: { limitation: true } }),
      artifact('a2', 'listing fee is …', { priority: 0.4 }),
      artifact('a1', 'found vendors', { priority: 0.9 }),
    ]);
    expect(ordered.map((a) => a.actionId)).toEqual(['a1', 'a2', 'a3']);
  });

  it('merges texts, keeps every affordance and lets the newest win on payload collision', () => {
    const composed = composeArtifacts([
      artifact('a1', 'Found 2 vendors', {
        actions: [{ type: 'button', title: 'Old', payload: 'mm|wf|pick|1' }],
      }),
      artifact('a2', 'Listing is free', {
        actions: [
          { type: 'button', title: 'New', payload: 'mm|wf|pick|1' },
          { type: 'button', title: 'Recharge', payload: 'mm|system|recharge' },
        ],
      }),
    ]);
    expect(composed?.text).toBe('Found 2 vendors\n\nListing is free');
    expect(composed?.actions?.map((a) => a.title)).toEqual(['New', 'Recharge']);
    expect(isDeliverable(composed)).toBe(true);
  });

  it('uses a naturalised message when supplied and reports nothing to deliver for empty artifacts', () => {
    const composed = composeArtifacts([artifact('a1', 'A'), artifact('a2', 'B')], 'A, and also B.');
    expect(composed?.text).toBe('A, and also B.');
    expect(composeArtifacts([artifact('a1', '   ')])).toBeNull();
    expect(isDeliverable(null)).toBe(false);
  });
});
