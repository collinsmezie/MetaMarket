import { validateIdceInvariants } from './idce-invariants';

function intent(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    intent_id: id,
    type: 'BUY',
    role: 'SECONDARY',
    status: 'RESOLVED',
    confidence: 0.9,
    explicitness: 'EXPLICIT',
    priority: 0.5,
    scope: { type: 'OBJECT', object_ids: ['o1'], workflow_ids: [], conversation_scope: false },
    evidence: { explicit: true, implicit: false, context_used: false, signals: ['need'] },
    dependencies: [],
    related_intents: [],
    constraints: [],
    source_spans: ['I need'],
    routing_hints: [],
    ...overrides,
  };
}

function resolution(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    resolution_status: 'RESOLVED',
    intents: [intent('i1', { role: 'PRIMARY' })],
    relations: [],
    clarification: null,
    unresolved: [],
    context_used: {
      conversation_history: false,
      active_workflows: false,
      semantic_objects: false,
      location: false,
      venue: false,
    },
    model_metadata: { prompt_version: 'x', schema_version: '1.0' },
    ...overrides,
  };
}

describe('IDCE semantic invariants', () => {
  it('accepts a well-formed multi-intent resolution with acyclic dependencies', () => {
    const payload = resolution({
      intents: [
        intent('i1', { role: 'PRIMARY', type: 'FIND_PRODUCT' }),
        intent('i2', { type: 'PRICE_INQUIRY', role: 'DEPENDENT', dependencies: ['i1'] }),
        intent('i3', { type: 'FIND_VENDOR' }),
      ],
      relations: [{ from: 'i2', type: 'DEPENDS_ON', to: 'i1' }],
    });
    expect(validateIdceInvariants(payload)).toEqual([]);
  });

  it('rejects labels outside the taxonomy, pointing the model at UNKNOWN_INTENT', () => {
    const violations = validateIdceInvariants(
      resolution({ intents: [intent('i1', { role: 'PRIMARY', type: 'BUYER_SEARCH_WORKFLOW' })] }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.keyword).toBe('intent_taxonomy');
    expect(violations[0]!.message).toContain('UNKNOWN_INTENT');
  });

  it('rejects dangling references and duplicate ids', () => {
    const violations = validateIdceInvariants(
      resolution({
        intents: [
          intent('i1', { role: 'PRIMARY', dependencies: ['ghost'] }),
          intent('i1', { role: 'PRIMARY' }),
        ],
        relations: [{ from: 'i1', type: 'SUPPORTS', to: 'nowhere' }],
      }),
    );
    const keywords = violations.map((violation) => violation.keyword);
    expect(keywords).toContain('dangling_reference');
    expect(keywords).toContain('unique_intent_id');
    expect(keywords).toContain('single_primary');
  });

  it('rejects dependency cycles across dependencies and execution relations', () => {
    const violations = validateIdceInvariants(
      resolution({
        intents: [intent('i1', { role: 'PRIMARY', dependencies: ['i2'] }), intent('i2')],
        relations: [{ from: 'i2', type: 'PRECEDES', to: 'i1' }],
      }),
    );
    expect(violations.some((violation) => violation.keyword === 'acyclic_dependencies')).toBe(true);
  });

  it('enforces clarification consistency in both directions', () => {
    const missingQuestion = validateIdceInvariants(
      resolution({
        clarification: {
          required: true,
          reason: 'OTHER',
          target_intent_ids: ['i1'],
          question: null,
          blocking: true,
          expected_resolution: null,
        },
      }),
    );
    expect(missingQuestion.some((violation) => violation.path === '/clarification/question')).toBe(true);

    const notRequiredButFilled = validateIdceInvariants(
      resolution({
        clarification: {
          required: false,
          reason: 'OTHER',
          target_intent_ids: [],
          question: 'Why?',
          blocking: false,
          expected_resolution: null,
        },
      }),
    );
    expect(notRequiredButFilled.some((violation) => violation.keyword === 'clarification_consistency')).toBe(
      true,
    );

    const consistent = validateIdceInvariants(
      resolution({
        intents: [intent('i1', { role: 'PRIMARY', status: 'AMBIGUOUS' })],
        clarification: {
          required: true,
          reason: 'INTENT_SCOPE_AMBIGUITY',
          target_intent_ids: ['i1'],
          question: 'Buy it or find sellers?',
          blocking: true,
          expected_resolution: null,
        },
      }),
    );
    expect(consistent).toEqual([]);
  });
});
