import { isSpanOf, validateCsreInvariants } from './csre-invariants';

const object = (id: string, surface: string, overrides: Record<string, unknown> = {}) => ({
  object_id: id,
  semantic_origin: {
    phrase: surface,
    concept: surface,
    market_concept_id: null,
    concept_status: 'PROPOSED',
    relationship: 'EXPRESSES',
    origin: 'CSRE',
    request_id: 'req_1',
    semantic_confidence: 0.9,
  },
  surface_form: surface,
  canonical_form: surface,
  entity_type: 'PRODUCT',
  definition: '',
  brand: null,
  model: null,
  attributes: {},
  aliases: [],
  commercial_interpretation: {
    relevance: 'DIRECT_PRODUCT',
    commercial_offering: true,
    reason: '',
    confidence: 0.9,
  },
  confidence: { semantic_resolution: 0.9, commercial_relevance: 0.9 },
  ambiguity: { present: false, remaining_candidates: [] },
  functional_context: [],
  relationships: [],
  ...overrides,
});

const resolution = (
  objects: unknown[],
  status: string,
  clarification = { required: false, question: null },
) => ({
  schema_version: '5.0',
  request_id: 'req_1',
  resolution_status: status,
  original_message: 'I need a hammer and nails for roofing',
  objects,
  context: {
    venues: [],
    regional_context: {
      country: 'Nigeria',
      region: null,
      regional_terms: [],
      regional_interpretation_used: false,
    },
    functional_context: ['roofing'],
    location_context: null,
    qualifiers: [],
  },
  clarification,
  evidence: [],
});

const MESSAGE = 'I need a hammer and nails for roofing';

describe('validateCsreInvariants', () => {
  it('accepts a well-formed composite resolution', () => {
    const payload = resolution(
      [
        object('object_1', 'hammer', {
          relationships: [{ type: 'used_for', objects: ['object_1', 'object_2'], context: 'roofing' }],
        }),
        object('object_2', 'nails'),
      ],
      'COMPOSITE',
    );
    expect(validateCsreInvariants(payload, MESSAGE)).toEqual([]);
  });

  it('rejects duplicate ids, foreign entity types, paraphrased spans and dangling relationships', () => {
    const payload = resolution(
      [
        object('object_1', 'hammer', { entity_type: 'GADGET' }),
        object('object_1', 'roofing nails', {
          relationships: [{ type: 'used_for', objects: ['object_9'], context: null }],
        }),
      ],
      'COMPOSITE',
    );
    const keywords = validateCsreInvariants(payload, MESSAGE).map((v) => v.keyword);
    expect(keywords).toEqual(
      expect.arrayContaining([
        'unique_object_id',
        'entity_type_vocabulary',
        'surface_form_span',
        'dangling_relationship',
      ]),
    );
  });

  it('ties resolution_status to the object count and the phrase to the surface form', () => {
    const single = resolution([object('object_1', 'hammer')], 'COMPOSITE');
    expect(validateCsreInvariants(single, MESSAGE).map((v) => v.keyword)).toEqual([
      'status_matches_object_count',
    ]);

    const none = resolution([], 'RESOLVED');
    expect(validateCsreInvariants(none, MESSAGE).map((v) => v.keyword)).toEqual([
      'status_matches_object_count',
    ]);

    const drifted = resolution(
      [
        object('object_1', 'hammer', {
          semantic_origin: { ...object('x', 'hammer').semantic_origin, phrase: 'a hammer' },
        }),
      ],
      'RESOLVED',
    );
    expect(validateCsreInvariants(drifted, MESSAGE).map((v) => v.keyword)).toEqual([
      'phrase_is_surface_form',
    ]);
  });

  it('enforces concept status, ambiguity and clarification consistency', () => {
    const payload = resolution(
      [
        object('object_1', 'hammer', {
          semantic_origin: { ...object('x', 'hammer').semantic_origin, concept_status: 'KNOWN' },
          ambiguity: { present: true, remaining_candidates: [] },
        }),
      ],
      'AMBIGUOUS',
      { required: true, question: null },
    );
    expect(validateCsreInvariants(payload, MESSAGE).map((v) => v.keyword)).toEqual([
      'known_concept_has_id',
      'ambiguity_has_candidates',
      'clarification_consistency',
    ]);
  });

  it('keeps venues out of the object list', () => {
    const payload = {
      ...resolution([object('object_1', 'hammer'), object('object_2', 'hardware store')], 'COMPOSITE'),
      original_message: 'I need a hammer from a hardware store',
    };
    payload.context.venues = [
      { expression: 'hardware store', canonical_venue: 'hardware store', venue_type: 'RETAIL_VENUE' },
    ] as never;
    expect(
      validateCsreInvariants(payload, 'I need a hammer from a hardware store').map((v) => v.keyword),
    ).toEqual(['venue_is_not_object']);
  });

  it('rejects a hedged definition presented with high confidence and no ambiguity', () => {
    const hedged = {
      ...object('object_1', 'kpakpando lamps'),
      canonical_form: 'kpakpando lamp',
      definition: "A type of lamp referred to as 'kpakpando', likely a local or regional product.",
    };
    const payload = { ...resolution([hedged], 'RESOLVED'), original_message: 'I want 5 kpakpando lamps' };
    expect(validateCsreInvariants(payload, 'I want 5 kpakpando lamps').map((v) => v.keyword)).toEqual([
      'unfamiliar_term_false_precision',
    ]);
    const honest = {
      ...hedged,
      confidence: { semantic_resolution: 0.4, commercial_relevance: 0.6 },
      ambiguity: {
        present: true,
        remaining_candidates: [
          { meaning: 'decorative lamp', entity_type: 'PRODUCT', definition: 'a lamp', plausibility: 0.5 },
        ],
      },
    };
    const ok = { ...resolution([honest], 'AMBIGUOUS'), original_message: 'I want 5 kpakpando lamps' };
    expect(validateCsreInvariants(ok, 'I want 5 kpakpando lamps').map((v) => v.keyword)).toEqual([]);
  });

  it('matches spans case- and whitespace-insensitively', () => {
    expect(isSpanOf('I dey  find Wall Socket', 'wall socket')).toBe(true);
    expect(isSpanOf('I need a gen', 'generator')).toBe(false);
  });
});
