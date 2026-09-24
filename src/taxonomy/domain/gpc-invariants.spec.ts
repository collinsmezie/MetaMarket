import { validateGpcInvariants } from './gpc-invariants';
import type { GpcCandidate } from './gpc-mapping';

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
const trace = {
  csre_request_id: 'req_csre',
  enrichment_request_id: 'req_enr',
  wrs_evidence_ids: [],
  evidence_system_ids: [],
};

const input = (id: string, surface: string, canonical: string, entityType = 'PRODUCT') => ({
  object_id: id,
  semantic_origin: origin(surface, canonical),
  source_trace: trace,
  canonical_form: canonical,
  entity_type: entityType,
});

const candidate = (
  forObjectId: string,
  gpcCode: string,
  level: GpcCandidate['level'],
  title: string,
): GpcCandidate => ({
  gpcCode,
  level,
  title,
  definition: null,
  segment: null,
  family: null,
  class: null,
  brick: null,
  retrievalSources: ['VECTOR'],
  retrievalScore: 0.8,
  gpcVersion: 'gpc-test',
  forObjectId,
});

const result = (
  source: ReturnType<typeof input>,
  mapping: Record<string, unknown>,
  diagnostics: unknown[] = [],
) => ({
  object_id: source.object_id,
  semantic_origin: { ...source.semantic_origin },
  source_trace: { ...trace },
  mapping: {
    state: 'MAPPED',
    gpc_code: null,
    gpc_level: null,
    gpc_title: null,
    mapping_confidence: 0.9,
    reason_codes: [],
    evidence_ids: [],
    gpc_version: 'gpc-test',
    resolver_version: '4.4',
    ...mapping,
  },
  diagnostic_candidates: diagnostics,
  diagnostics: { required_distinction: null, notes: [] },
});

const response = (objects: unknown[]) => ({
  schema_version: '4.0',
  request_id: 'req_gpc',
  resolver_version: '4.4',
  status: 'SUCCESS',
  objects,
  message_level: { relationships: [], shared_context: [] },
});

describe('validateGpcInvariants', () => {
  const hammer = input('object_1', 'hammer', 'hammer');
  const plumber = input('object_2', 'plumber', 'plumbing service', 'SERVICE');
  const candidates = [
    candidate('object_1', '10003500', 'BRICK', 'Hammers (DIY) (Non Powered)'),
    candidate('object_1', '80011600', 'CLASS', 'Hammers/Mallets/Hatchets/Anvils'),
  ];

  it('accepts a mapping onto a supplied candidate and NOT_APPLICABLE for a service', () => {
    const payload = response([
      result(hammer, {
        state: 'MAPPED',
        gpc_code: '10003500',
        gpc_level: 'BRICK',
        gpc_title: 'Hammers (DIY) (Non Powered)',
      }),
      result(plumber, { state: 'NOT_APPLICABLE', mapping_confidence: 0 }),
    ]);
    expect(validateGpcInvariants(payload, [hammer, plumber], candidates, new Set())).toEqual([]);
  });

  it('rejects invented codes, wrong level/title, forced services, drifted origin and missing objects', () => {
    const payload = response([
      result(hammer, { state: 'MAPPED', gpc_code: '99999999', gpc_level: 'BRICK', gpc_title: 'Made Up' }),
      result(plumber, {
        state: 'MAPPED',
        gpc_code: '10003500',
        gpc_level: 'CLASS',
        gpc_title: 'Hammers (DIY) (Non Powered)',
      }),
    ]);
    const keywords = validateGpcInvariants(payload, [hammer, plumber], candidates, new Set()).map(
      (v) => v.keyword,
    );
    expect(keywords).toEqual(
      expect.arrayContaining(['code_from_supplied_candidates', 'non_product_not_applicable']),
    );

    const drifted = response([
      result(
        { ...hammer, semantic_origin: { ...hammer.semantic_origin, concept: 'claw hammer' } },
        { state: 'NOT_APPLICABLE' },
      ),
    ]);
    expect(
      validateGpcInvariants(drifted, [hammer, plumber], candidates, new Set()).map((v) => v.keyword),
    ).toEqual(expect.arrayContaining(['semantic_origin_preserved', 'every_object_resolved']));
  });

  it('refuses false precision: a category never maps to a product brick', () => {
    const category = input('object_3', 'electrical materials', 'electrical materials', 'PRODUCT_CATEGORY');
    const options = [
      candidate('object_3', '10005541', 'BRICK', 'Electrical Wires'),
      candidate('object_3', '78020000', 'FAMILY', 'Electrical Supplies'),
    ];
    const brick = response([
      result(category, {
        state: 'MAPPED',
        gpc_code: '10005541',
        gpc_level: 'BRICK',
        gpc_title: 'Electrical Wires',
      }),
    ]);
    expect(validateGpcInvariants(brick, [category], options, new Set()).map((v) => v.keyword)).toEqual([
      'no_false_precision',
    ]);
    const family = response([
      result(category, {
        state: 'MAPPED',
        gpc_code: '78020000',
        gpc_level: 'FAMILY',
        gpc_title: 'Electrical Supplies',
      }),
    ]);
    expect(validateGpcInvariants(family, [category], options, new Set())).toEqual([]);
  });

  it('requires competitors for AMBIGUOUS and known provenance for evidence and diagnostics', () => {
    const payload = response([
      result(hammer, { state: 'AMBIGUOUS', evidence_ids: ['ev_x'] }, [
        { gpc_code: '77777777', level: 'BRICK', title: 'Ghost', assessment: 0.5, rejected_reason: null },
      ]),
      result(plumber, { state: 'NOT_APPLICABLE' }),
    ]);
    const keywords = validateGpcInvariants(payload, [hammer, plumber], candidates, new Set(['ev_1'])).map(
      (v) => v.keyword,
    );
    expect(keywords).toEqual(
      expect.arrayContaining([
        'ambiguity_has_competitors',
        'code_from_supplied_candidates',
        'evidence_lineage',
      ]),
    );
  });
});
