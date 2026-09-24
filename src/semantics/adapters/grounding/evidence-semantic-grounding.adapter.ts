import { Inject, Injectable } from '@nestjs/common';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import { normalizeLabel } from '../../../evidence/domain/evidence-model';
import {
  EVIDENCE_STORE,
  type EvidenceStorePort,
  type KnowledgeRecord,
} from '../../../evidence/ports/evidence-store.port';
import type {
  GroundingQuery,
  KnownMarketConcept,
  LexiconEvidence,
  SemanticGroundingPort,
} from '../../ports/semantic-grounding.port';

const KNOWLEDGE_SCAN_LIMIT = 500;

/**
 * CSRE grounding from learned market knowledge (CSRE §25.2, §31.4; Evidence TDR §17, §37).
 * Only SUPPORTED/ESTABLISHED `LOCAL_TERM_MAPPING` knowledge whose surface term occurs in the
 * message is offered — as knowledge with lineage, never as fresh evidence (§38, §54.3). Until the
 * MKG exists (Phase 9) "known concepts" are the concepts these promoted mappings point at.
 */
@Injectable()
export class EvidenceSemanticGrounding implements SemanticGroundingPort {
  constructor(
    @Inject(EVIDENCE_STORE) private readonly store: EvidenceStorePort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  async knownConcepts(query: GroundingQuery): Promise<readonly KnownMarketConcept[]> {
    const matches = await this.matching(query.message);
    const byConcept = new Map<string, KnownMarketConcept>();
    for (const item of matches) {
      const claim = item.claim as { canonical_concept?: string; concept_id?: string; surface_term?: string };
      const id = String(claim.concept_id ?? '');
      if (id.length === 0) continue;
      const existing = byConcept.get(id);
      const alias = String(claim.surface_term ?? '');
      if (existing === undefined)
        byConcept.set(id, {
          marketConceptId: id,
          label: String(claim.canonical_concept ?? ''),
          entityType: null,
          aliases: alias ? [alias] : [],
        });
      else if (alias && !existing.aliases.includes(alias))
        byConcept.set(id, { ...existing, aliases: [...existing.aliases, alias] });
    }
    return [...byConcept.values()];
  }

  async lexiconEvidence(query: GroundingQuery): Promise<readonly LexiconEvidence[]> {
    const matches = await this.matching(query.message);
    return matches.map((item) => {
      const claim = item.claim as { canonical_concept?: string; concept_id?: string; surface_term?: string };
      return {
        phrase: String(claim.surface_term ?? ''),
        concept: String(claim.canonical_concept ?? ''),
        marketConceptId: String(claim.concept_id ?? '') || null,
        geographicScope: typeof item.scope.country === 'string' ? item.scope.country : null,
        sourceType: `EVIDENCE_KNOWLEDGE:${item.state}`,
        confidence: item.confidence,
        evidenceIds: item.supportedBy,
        lastObservedAt: item.lastValidatedAt?.toISOString() ?? null,
      };
    });
  }

  private async matching(message: string): Promise<readonly KnowledgeRecord[]> {
    const text = ` ${normalizeLabel(message)} `;
    if (text.trim().length === 0) return [];
    // Knowledge is context, never a dependency: a knowledge-store outage must not fail resolution.
    const knowledge = await this.store
      .knowledgeByType('LOCAL_TERM_MAPPING', ['SUPPORTED', 'ESTABLISHED'], KNOWLEDGE_SCAN_LIMIT)
      .catch((error: unknown) => {
        this.logger.stageFailed({
          component: 'CSRE',
          stage: 'grounding',
          input: { messageLength: message.length },
          action: 'Knowledge lookup failed; resolving without learned market language',
          error,
        });
        return [] as readonly KnowledgeRecord[];
      });
    return knowledge.filter((item) => {
      const term = normalizeLabel(String((item.claim as { surface_term?: string }).surface_term ?? ''));
      return term.length > 1 && text.includes(` ${term} `);
    });
  }
}
