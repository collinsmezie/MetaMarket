import { Inject, Injectable } from '@nestjs/common';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import { toWrsResponse, type WrsServiceRequest } from '../../../retrieval/domain/wrs-evidence';
import { WEB_RETRIEVAL, type WebRetrievalPort } from '../../../retrieval/ports/web-retrieval.port';
import { WrsService } from '../../../retrieval/application/wrs.service';
import { componentVersion } from '../../../platform/registry/component-registry';
import type {
  ExternalEvidenceItem,
  ExternalEvidenceQuery,
  ExternalEvidenceRetrievalPort,
} from '../../ports/semantic-grounding.port';

/**
 * CSRE → WRS evidence path (CSRE §9, §17; WRS §21.3 "market semantic validation"). One WRS
 * request per uncertain expression, each carrying the remaining candidate meanings as
 * candidates, so evidence comes back saying which interpretation it supports or contradicts.
 * Retrieval failures degrade to "no evidence" — the first-pass resolution is never discarded.
 */
@Injectable()
export class WrsExternalEvidenceRetrieval implements ExternalEvidenceRetrievalPort {
  constructor(
    @Inject(WEB_RETRIEVAL) private readonly wrs: WebRetrievalPort,
    private readonly wrsService: WrsService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  available(): boolean {
    return this.wrsService.available();
  }

  async retrieve(query: ExternalEvidenceQuery): Promise<readonly ExternalEvidenceItem[]> {
    const items: ExternalEvidenceItem[] = [];
    for (const [index, expression] of query.expressions.entries()) {
      const candidates = expression.candidates.map((meaning, position) => ({
        candidateId: `cand_${position + 1}`,
        label: meaning,
        description: null,
      }));
      const labels = new Map(candidates.map((candidate) => [candidate.candidateId, candidate.label]));
      const locality = locationsOf(query.regionalContext);
      const request: WrsServiceRequest = {
        schemaVersion: '4.0',
        requestId: `${query.requestId}:wrs:${index + 1}`,
        consumer: {
          component: 'CSRE',
          version: componentVersion('CSRE'),
          purpose: 'market_semantic_validation',
        },
        question:
          candidates.length > 0
            ? `In Nigerian commercial usage, does the phrase "${expression.surfaceForm}" refer to ${candidates.map((c) => c.label).join(' or ')}?`
            : `What does the phrase "${expression.surfaceForm}" refer to in Nigerian commercial usage?`,
        context: {
          phrase: expression.surfaceForm,
          geographic_context: locality ?? 'Nigeria',
          country_code: 'NG',
          regional_context: query.regionalContext,
        },
        candidates,
        relationshipTarget: null,
        evidenceRequirements: [
          'Prefer local commercial usage (marketplaces, retailers, local publications) over dictionary definitions',
          'Preserve the exact phrase',
        ],
        requestedFields: [],
        outputContract: {},
        conversationId: query.conversationId,
        turnId: query.turnId,
        runId: null,
        contextSnapshotId: null,
      };
      try {
        const result = await this.wrs.retrieve(request);
        if (result.status !== 'SUCCESS' || result.response === null) continue;
        const response = toWrsResponse(result.response);
        for (const evidence of response.evidence) {
          items.push({
            evidenceId: evidence.evidenceId,
            source: evidence.sourceUrl ?? evidence.sourceId,
            sourceType: evidence.sourceType,
            claim: evidence.quote === null ? evidence.claim : `${evidence.claim} — "${evidence.quote}"`,
            supportsInterpretation: evidence.supports.map((id) => labels.get(id) ?? id)[0] ?? null,
            contradictsInterpretation: evidence.contradicts.map((id) => labels.get(id) ?? id)[0] ?? null,
            geographicRelevance: evidence.geographicRelevance,
            reliability: evidence.confidence,
          });
        }
      } catch (error) {
        this.logger.stageFailed({
          component: 'CSRE',
          stage: 'evidence-path',
          input: { requestId: request.requestId, phrase: expression.surfaceForm },
          action: 'WRS retrieval failed; continuing with the first-pass resolution',
          error,
        });
      }
    }
    return items;
  }
}

function locationsOf(regionalContext: Readonly<Record<string, unknown>>): string | null {
  const locations = regionalContext.locations;
  if (!Array.isArray(locations) || locations.length === 0) return null;
  const first = locations[0] as Record<string, unknown> | string;
  const value = typeof first === 'string' ? first : String(first.value ?? '');
  return value.length > 0 ? value : null;
}
