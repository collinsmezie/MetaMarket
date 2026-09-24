import { validateEnrichmentInvariants } from './enrichment-invariants';

const origin = (phrase: string, concept: string) => ({
  phrase,
  concept,
  market_concept_id: null,
  concept_status: 'PROPOSED',
  relationship: 'EXPRESSES',
  origin: 'CSRE',
  request_id: 'req_csre',
  semantic_confidence: 0.95,
});

const input = (id: string, surface: string, canonical: string, brand: string | null = null) => ({
  object_id: id,
  semantic_origin: origin(surface, canonical),
  surface_form: surface,
  canonical_form: canonical,
  entity_type: 'PRODUCT',
  brand,
  model: null,
});

const profile = (source: ReturnType<typeof input>, overrides: Record<string, unknown> = {}) => ({
  object_id: source.object_id,
  semantic_origin: { ...source.semantic_origin },
  canonical_form: source.canonical_form,
  entity_type: source.entity_type,
  definition: 'x',
  brand: source.brand,
  model: null,
  variant: null,
  attributes: {},
  functional_profile: { primary_function: null, secondary_functions: [], mechanism: null },
  use_cases: [],
  commercial_terminology: {
    synonyms: [],
    aliases: [],
    informal_terms: [],
    regional_terms: [],
    industry_terms: [],
  },
  taxonomy_semantics: {
    domain_hints: [],
    category_hints: [],
    subcategory_hints: [],
    object_family: [],
    taxonomy_vocabulary: [],
  },
  distinguishing_features: [],
  confusable_concepts: [],
  embedding_representations: {
    canonical_embedding_text: 'x',
    functional_embedding_text: '',
    taxonomy_embedding_text: '',
    search_terms: [],
    semantic_keywords: [],
    negative_terms: [],
  },
  evidence: [],
  confidence: { enrichment: 0.9, functional_profile: 0.9, taxonomy_semantics: 0.9 },
  evidence_required: false,
  evidence_request: null,
  resolution_concern: null,
  ...overrides,
});

const resolution = (objects: unknown[], status = 'ENRICHED') => ({
  schema_version: '4.0',
  request_id: 'req_enr',
  enrichment_status: status,
  source_resolution: { resolver_version: '5.4', resolution_request_id: 'req_csre' },
  objects,
  relationships: [],
  message_context: { functional_context: [], shared_constraints: [] },
});

describe('validateEnrichmentInvariants', () => {
  const hammer = input('object_1', 'hammer', 'hammer');
  const milk = input('object_2', 'Peak milk', 'milk', 'Peak');

  it('accepts one faithful profile per input object', () => {
    expect(
      validateEnrichmentInvariants(resolution([profile(hammer), profile(milk)]), [hammer, milk], new Set()),
    ).toEqual([]);
  });

  it('rejects re-resolution, fabricated specificity, missing or unknown objects', () => {
    const payload = resolution([
      profile(hammer, {
        canonical_form: 'claw hammer',
        brand: 'Stanley',
        semantic_origin: { ...hammer.semantic_origin, concept: 'claw hammer' },
      }),
      profile(input('object_9', 'ghost', 'ghost')),
    ]);
    const keywords = validateEnrichmentInvariants(payload, [hammer, milk], new Set()).map((v) => v.keyword);
    expect(keywords).toEqual(
      expect.arrayContaining([
        'identity_preserved',
        'no_unsupported_specificity',
        'semantic_origin_preserved',
        'unknown_object',
        'every_object_enriched',
      ]),
    );
  });

  it('ties evidence flags, lineage and status together', () => {
    const payload = resolution(
      [
        profile(hammer, {
          evidence_required: true,
          evidence_request: null,
          evidence: [{ evidence_id: 'ev_unknown', derived_fields: ['definition'] }],
        }),
        profile(milk),
      ],
      'ENRICHED',
    );
    const keywords = validateEnrichmentInvariants(payload, [hammer, milk], new Set(['ev_1'])).map(
      (v) => v.keyword,
    );
    expect(keywords).toEqual(
      expect.arrayContaining(['evidence_request_consistency', 'evidence_lineage', 'status_consistency']),
    );

    const ok = resolution(
      [
        profile(hammer, {
          evidence_required: true,
          evidence_request: {
            question: 'q',
            reason: 'r',
            candidates: [],
            geographic_context: null,
            preferred_source_types: [],
            requested_fields: [],
          },
          evidence: [{ evidence_id: 'ev_1', derived_fields: ['definition'] }],
        }),
        profile(milk),
      ],
      'EVIDENCE_REQUIRED',
    );
    expect(validateEnrichmentInvariants(ok, [hammer, milk], new Set(['ev_1']))).toEqual([]);
  });
});
