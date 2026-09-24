import type { StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import type { WrsService } from '../../../retrieval/application/wrs.service';
import type { WrsServiceRequest, WrsServiceResponse } from '../../../retrieval/domain/wrs-evidence';
import type { WebRetrievalPort } from '../../../retrieval/ports/web-retrieval.port';
import { WrsExternalEvidenceRetrieval } from './wrs-external-evidence.adapter';

const envelope = (requestId: string, supports: string[], contradicts: string[]): WrsServiceResponse => ({
  requestId,
  component: 'WRS',
  componentVersion: '4.4',
  status: 'SUCCESS',
  error: null,
  response: {
    schema_version: '4.0',
    request_id: requestId,
    consumer: { component: 'CSRE', version: '5.4', purpose: 'market_semantic_validation' },
    task_type: 'market_semantic_validation',
    status: 'SUCCESS',
    evidence: [
      {
        evidence_id: `${requestId}#ev_1`,
        claim: 'Nigerian retailers list iron sponge as steel wool',
        supports,
        contradicts,
        relationship_target: null,
        quote: 'iron sponge steel wool scourer',
        source_id: 'src_1',
        source_url: 'https://jumia.com.ng/iron-sponge',
        source_title: 'Iron sponge',
        source_type: 'retailer',
        geographic_relevance: 'HIGH',
        temporal_relevance: 'CURRENT',
        quality: 'MEDIUM',
        confidence: 0.82,
        kind: 'OBSERVED',
      },
    ],
    findings: [],
    contradictions: [],
    sources: [],
    confidence: { overall: 0.8, evidence_quality: 0.8, evidence_consistency: 1 },
    payload: {},
  },
});

function build(respond: (request: WrsServiceRequest) => Promise<WrsServiceResponse>, available = true) {
  const requests: WrsServiceRequest[] = [];
  const port: WebRetrievalPort = {
    retrieve: async (request) => {
      requests.push(request);
      return respond(request);
    },
  };
  const adapter = new WrsExternalEvidenceRetrieval(
    port,
    { available: () => available } as unknown as WrsService,
    { stage: () => undefined, stageFailed: () => undefined } as unknown as StageLoggerPort,
  );
  return { adapter, requests };
}

describe('WrsExternalEvidenceRetrieval (CSRE → WRS)', () => {
  it('sends one Nigerian-market-scoped request per uncertain expression and maps candidate ids back to meanings', async () => {
    const { adapter, requests } = build(async (request) =>
      envelope(request.requestId, ['cand_1'], ['cand_2']),
    );
    const items = await adapter.retrieve({
      requestId: 'req_csre',
      conversationId: 'conv',
      turnId: 'turn',
      expressions: [
        { surfaceForm: 'iron sponge', candidates: ['steel wool scouring pad', 'metal filter sponge'] },
      ],
      regionalContext: { country: 'Nigeria', locations: [{ value: 'Lagos' }] },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      requestId: 'req_csre:wrs:1',
      consumer: { component: 'CSRE', purpose: 'market_semantic_validation' },
      context: { phrase: 'iron sponge', geographic_context: 'Lagos', country_code: 'NG' },
      candidates: [
        { candidateId: 'cand_1', label: 'steel wool scouring pad' },
        { candidateId: 'cand_2', label: 'metal filter sponge' },
      ],
      conversationId: 'conv',
      turnId: 'turn',
    });
    expect(requests[0]!.question).toContain('Nigerian commercial usage');
    expect(items).toEqual([
      {
        evidenceId: 'req_csre:wrs:1#ev_1',
        source: 'https://jumia.com.ng/iron-sponge',
        sourceType: 'retailer',
        claim: 'Nigerian retailers list iron sponge as steel wool — "iron sponge steel wool scourer"',
        supportsInterpretation: 'steel wool scouring pad',
        contradictsInterpretation: 'metal filter sponge',
        geographicRelevance: 'HIGH',
        reliability: 0.82,
      },
    ]);
  });

  it('reports availability from WRS and degrades to no evidence on ERROR envelopes or thrown failures', async () => {
    const errored = build(async (request) => ({
      requestId: request.requestId,
      component: 'WRS',
      componentVersion: '4.4',
      status: 'ERROR',
      response: null,
      error: { code: 'WRS_PROVIDER_FAILURE', message: 'down', retryable: true },
    }));
    const query = {
      requestId: 'r',
      conversationId: 'c',
      turnId: 't',
      expressions: [{ surfaceForm: 'x', candidates: [] }],
      regionalContext: {},
    };
    expect(await errored.adapter.retrieve(query)).toEqual([]);
    const thrown = build(async () => {
      throw new Error('boom');
    }, false);
    expect(thrown.adapter.available()).toBe(false);
    expect(await thrown.adapter.retrieve(query)).toEqual([]);
  });
});
