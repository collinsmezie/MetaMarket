import type { StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import type { WrsService } from '../../../retrieval/application/wrs.service';
import type { WrsServiceRequest, WrsServiceResponse } from '../../../retrieval/domain/wrs-evidence';
import type { WebRetrievalPort } from '../../../retrieval/ports/web-retrieval.port';
import { WrsEnrichmentEvidenceRetrieval } from './wrs-enrichment-evidence.adapter';

const success = (request: WrsServiceRequest): WrsServiceResponse => ({
  requestId: request.requestId,
  component: 'WRS',
  componentVersion: '4.4',
  status: 'SUCCESS',
  error: null,
  response: {
    schema_version: '4.0',
    request_id: request.requestId,
    consumer: { component: 'ENRICHMENT', version: '4.4', purpose: 'enrichment_evidence' },
    task_type: 'enrichment_evidence',
    status: 'PARTIAL',
    evidence: [
      {
        evidence_id: `${request.requestId}#ev_1`,
        claim: 'Dangote cement is sold in 50kg bags',
        supports: ['pack_size'],
        contradicts: [],
        relationship_target: null,
        quote: null,
        source_id: 'src_2',
        source_url: 'https://jiji.ng/dangote',
        source_title: 'Dangote cement',
        source_type: 'marketplace',
        geographic_relevance: 'HIGH',
        temporal_relevance: 'CURRENT',
        quality: 'MEDIUM',
        confidence: 0.7,
        kind: 'INFERENCE',
      },
    ],
    findings: [],
    contradictions: [],
    sources: [],
    confidence: { overall: 0.7, evidence_quality: 0.7, evidence_consistency: 1 },
    payload: {},
  },
});

describe('WrsEnrichmentEvidenceRetrieval (Enrichment → WRS)', () => {
  it("turns the model's evidence_request into one consumer-aware WRS request per object", async () => {
    const requests: WrsServiceRequest[] = [];
    const port: WebRetrievalPort = {
      retrieve: async (request) => {
        requests.push(request);
        return success(request);
      },
    };
    const adapter = new WrsEnrichmentEvidenceRetrieval(
      port,
      { available: () => true } as unknown as WrsService,
      { stage: () => undefined, stageFailed: () => undefined } as unknown as StageLoggerPort,
    );
    const items = await adapter.retrieve({
      requestId: 'req_enr',
      conversationId: 'conv',
      turnId: 'turn',
      objectId: 'object_1',
      semanticOrigin: { concept: 'Dangote cement', market_concept_id: null },
      question: 'What pack sizes is Dangote cement sold in?',
      reason: 'pack size unknown',
      candidates: ['25kg', '50kg'],
      geographicContext: 'Lagos',
      preferredSourceTypes: ['manufacturer', 'retailer'],
      requestedFields: ['pack_size'],
    });
    expect(adapter.available()).toBe(true);
    expect(requests[0]).toMatchObject({
      requestId: 'req_enr:wrs:object_1',
      consumer: { component: 'ENRICHMENT', purpose: 'enrichment_evidence' },
      question: 'What pack sizes is Dangote cement sold in?',
      context: { concept: 'Dangote cement', geographic_context: 'Lagos', country_code: 'NG' },
      candidates: [
        { candidateId: 'cand_1', label: '25kg' },
        { candidateId: 'cand_2', label: '50kg' },
      ],
      requestedFields: ['pack_size'],
      evidenceRequirements: ['Preferred source types: manufacturer, retailer'],
    });
    expect(items).toEqual([
      {
        evidenceId: 'req_enr:wrs:object_1#ev_1',
        source: 'https://jiji.ng/dangote',
        sourceType: 'marketplace',
        claim: 'Dangote cement is sold in 50kg bags',
        reliability: 0.7,
        geographicRelevance: 'HIGH',
      },
    ]);
  });
});
