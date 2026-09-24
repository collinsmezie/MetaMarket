import type { CollectedSource } from './wrs-evidence';
import { validateWrsInvariants } from './wrs-invariants';

const source = (id: string, url: string): CollectedSource => ({
  sourceId: id,
  url,
  title: id,
  snippet: 'text',
  publishedAt: null,
  providerScore: 0.8,
  queries: ['q'],
});
const evidence = (id: string, sourceId: string, overrides: Record<string, unknown> = {}) => ({
  evidence_id: id,
  claim: 'claim',
  supports: ['c1'],
  contradicts: [],
  relationship_target: null,
  quote: 'a quote',
  source_id: sourceId,
  source_url: `https://${sourceId}.example`,
  source_title: sourceId,
  source_type: 'retailer',
  geographic_relevance: 'HIGH',
  temporal_relevance: 'CURRENT',
  quality: 'MEDIUM',
  confidence: 0.7,
  kind: 'OBSERVED',
  ...overrides,
});
const response = (evidenceItems: unknown[], status: string, extra: Record<string, unknown> = {}) => ({
  schema_version: '4.0',
  request_id: 'req',
  consumer: { component: 'CSRE', version: '5.4', purpose: 'p' },
  task_type: 'semantic_evidence',
  status,
  evidence: evidenceItems,
  findings: [],
  contradictions: [],
  sources: [],
  confidence: { overall: 0.7, evidence_quality: 0.7, evidence_consistency: 0.7 },
  payload: {},
  ...extra,
});

describe('validateWrsInvariants', () => {
  const collected = [source('src_1', 'https://src_1.example'), source('src_2', 'https://src_2.example')];
  const candidates = [{ candidateId: 'c1', label: 'steel wool', description: null }];

  it('accepts evidence grounded in collected sources and supplied candidates', () => {
    expect(
      validateWrsInvariants(response([evidence('ev_1', 'src_1')], 'SUCCESS'), collected, candidates, []),
    ).toEqual([]);
  });

  it('rejects fabricated provenance, foreign targets, unquoted observations and dangling references', () => {
    const payload = response(
      [
        evidence('ev_1', 'src_9'),
        evidence('ev_1', 'src_2', { supports: ['ghost'], quote: null, source_url: 'https://elsewhere' }),
      ],
      'SUCCESS',
      {
        findings: [
          { finding: 'f', kind: 'OBSERVED', evidence_ids: ['ev_missing'], supports: [], contradicts: [] },
        ],
        sources: [
          {
            source_id: 'src_7',
            url: null,
            title: null,
            source_type: 'other',
            quality: 'LOW',
            relevance: 0.1,
          },
        ],
      },
    );
    const keywords = validateWrsInvariants(payload, collected, candidates, []).map((v) => v.keyword);
    expect(keywords).toEqual(
      expect.arrayContaining([
        'provenance_from_collected_sources',
        'unique_evidence_id',
        'reference_supplied_targets',
        'observed_requires_quote',
        'dangling_evidence_reference',
      ]),
    );
  });

  it('ties status to the presence of evidence', () => {
    expect(
      validateWrsInvariants(response([], 'SUCCESS'), collected, candidates, []).map((v) => v.keyword),
    ).toEqual(['status_matches_evidence']);
    expect(
      validateWrsInvariants(
        response([evidence('ev_1', 'src_1')], 'NO_RELIABLE_EVIDENCE'),
        collected,
        candidates,
        [],
      ).map((v) => v.keyword),
    ).toEqual(['status_matches_evidence']);
    expect(validateWrsInvariants(response([], 'NO_RELIABLE_EVIDENCE'), collected, candidates, [])).toEqual(
      [],
    );
  });
});
