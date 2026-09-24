import { Inject, Injectable } from '@nestjs/common';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import { WrsService } from '../../../retrieval/application/wrs.service';
import { toWrsResponse, type WrsServiceRequest } from '../../../retrieval/domain/wrs-evidence';
import { WEB_RETRIEVAL, type WebRetrievalPort } from '../../../retrieval/ports/web-retrieval.port';
import { componentVersion } from '../../../platform/registry/component-registry';
import type {
  EnrichmentEvidenceItem,
  EnrichmentEvidenceRequest,
  EnrichmentEvidenceRetrievalPort,
} from '../../ports/mkg-read.port';

/**
 * Enrichment → WRS evidence path (Enrichment §8, §9, §26.5; WRS §21.3 "enrichment evidence").
 * The model's own `evidence_request` (question, candidates, geographic context, preferred source
 * types, requested fields) becomes one consumer-aware WRS request per object. Failures degrade to
 * no evidence; the first-pass enrichment stands.
 */
@Injectable()
export class WrsEnrichmentEvidenceRetrieval implements EnrichmentEvidenceRetrievalPort {
  constructor(
    @Inject(WEB_RETRIEVAL) private readonly wrs: WebRetrievalPort,
    private readonly wrsService: WrsService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  available(): boolean {
    return this.wrsService.available();
  }

  async retrieve(request: EnrichmentEvidenceRequest): Promise<readonly EnrichmentEvidenceItem[]> {
    const origin = request.semanticOrigin;
    const concept = typeof origin.concept === 'string' ? origin.concept : null;
    const wrsRequest: WrsServiceRequest = {
      schemaVersion: '4.0',
      requestId: `${request.requestId}:wrs:${request.objectId}`,
      consumer: {
        component: 'ENRICHMENT',
        version: componentVersion('ENRICHMENT'),
        purpose: 'enrichment_evidence',
      },
      question: request.question,
      context: {
        ...(concept !== null ? { concept } : {}),
        reason: request.reason,
        geographic_context: request.geographicContext ?? 'Nigeria',
        country_code: 'NG',
        semantic_origin: origin,
      },
      candidates: request.candidates.map((label, index) => ({
        candidateId: `cand_${index + 1}`,
        label,
        description: null,
      })),
      relationshipTarget: null,
      evidenceRequirements:
        request.preferredSourceTypes.length > 0
          ? [`Preferred source types: ${request.preferredSourceTypes.join(', ')}`]
          : [],
      requestedFields: request.requestedFields,
      outputContract: {},
      conversationId: request.conversationId,
      turnId: request.turnId,
      runId: null,
      contextSnapshotId: null,
    };
    try {
      const result = await this.wrs.retrieve(wrsRequest);
      if (result.status !== 'SUCCESS' || result.response === null) return [];
      return toWrsResponse(result.response).evidence.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        source: evidence.sourceUrl ?? evidence.sourceId,
        sourceType: evidence.sourceType,
        claim: evidence.quote === null ? evidence.claim : `${evidence.claim} — "${evidence.quote}"`,
        reliability: evidence.confidence,
        geographicRelevance: evidence.geographicRelevance,
      }));
    } catch (error) {
      this.logger.stageFailed({
        component: 'ENRICHMENT',
        stage: 'evidence-path',
        input: { requestId: wrsRequest.requestId, objectId: request.objectId },
        action: 'WRS retrieval failed; continuing with the first-pass enrichment',
        error,
      });
      return [];
    }
  }
}
