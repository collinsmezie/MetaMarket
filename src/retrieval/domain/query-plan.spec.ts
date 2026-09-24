import { planQueries } from './query-plan';
import type { WrsServiceRequest } from './wrs-evidence';

const request = (overrides: Partial<WrsServiceRequest> = {}): WrsServiceRequest => ({
  schemaVersion: '4.0',
  requestId: 'req',
  consumer: { component: 'CSRE', version: '5.4', purpose: 'p' },
  question: 'What does "iron sponge" refer to in Nigerian markets?',
  context: { phrase: 'iron sponge', geographic_context: 'Lagos, Nigeria', country_code: 'ng' },
  candidates: [
    { candidateId: 'c1', label: 'steel wool scouring pad', description: null },
    { candidateId: 'c2', label: 'metal sponge filter', description: null },
  ],
  relationshipTarget: null,
  evidenceRequirements: [],
  requestedFields: ['local_price_range'],
  outputContract: {},
  conversationId: null,
  turnId: null,
  runId: null,
  contextSnapshotId: null,
  ...overrides,
});

describe('planQueries', () => {
  it('derives question, locality, candidate and field queries within the budget, deduplicated', () => {
    const queries = planQueries(request(), 4);
    expect(queries.map((q) => q.purpose)).toEqual(['QUESTION', 'LOCALITY', 'CANDIDATE', 'CANDIDATE']);
    expect(queries[1]).toEqual({ query: 'iron sponge Lagos, Nigeria', purpose: 'LOCALITY', country: 'NG' });
    expect(queries[2]!.query).toBe('iron sponge steel wool scouring pad Lagos, Nigeria');
    expect(planQueries(request(), 8).map((q) => q.purpose)).toContain('REQUESTED_FIELD');
  });

  it('is deterministic and falls back to the question when the context names no subject', () => {
    const bare = request({ context: {}, candidates: [], requestedFields: [] });
    expect(planQueries(bare, 4)).toEqual(planQueries(bare, 4));
    expect(planQueries(bare, 4)).toEqual([
      {
        query: bare.question.replace(/"/g, ' ').replace(/\s+/g, ' ').trim(),
        purpose: 'QUESTION',
        country: null,
      },
    ]);
  });
});
