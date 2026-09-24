import { Inject, Injectable } from '@nestjs/common';
import { conceptId } from '../../../evidence/domain/evidence-model';
import { EVIDENCE_STORE, type EvidenceStorePort } from '../../../evidence/ports/evidence-store.port';
import type { GpcKnowledgePort, PriorGpcMapping } from '../../ports/gpc-candidate-retrieval.port';

/**
 * Prior validated `MarketConcept → MAPPED_TO_GPC → GPC` mappings from Evidence knowledge (GPC
 * Resolver §23, §76.6; Evidence TDR §17, §52.4). Only SUPPORTED/ESTABLISHED `TAXONOMY_ANCHOR`
 * knowledge is offered, with its evidence lineage and belief; derivation is STORED (never an
 * inference). The resolver still classifies only against retrieved candidates.
 */
@Injectable()
export class EvidenceGpcKnowledge implements GpcKnowledgePort {
  constructor(@Inject(EVIDENCE_STORE) private readonly store: EvidenceStorePort) {}

  async priorMappings(query: {
    readonly marketConceptIds: readonly string[];
    readonly concepts: readonly string[];
  }): Promise<readonly PriorGpcMapping[]> {
    const nodes = [
      ...query.marketConceptIds.map((id) => conceptId(id, '')),
      ...query.concepts.map((concept) => conceptId(null, concept)),
    ];
    // Priors are context, never a dependency: a knowledge-store outage must not fail classification.
    const knowledge = await this.store
      .knowledgeForNodes(nodes, ['SUPPORTED', 'ESTABLISHED'])
      .catch(() => [] as const);
    return knowledge
      .filter((item) => item.type === 'TAXONOMY_ANCHOR')
      .map((item) => {
        const claim = item.claim as {
          concept?: string;
          concept_id?: string;
          gpc_code?: string;
          gpc_label?: string;
        };
        const label = String(claim.gpc_label ?? '');
        const title = label.replace(/\s*\[[^\]]*\]\s*$/, '');
        const conceptRef = String(claim.concept_id ?? '');
        return {
          marketConceptId: conceptRef.startsWith('concept:proposed:')
            ? null
            : conceptRef.replace(/^concept:/, '') || null,
          concept: String(claim.concept ?? ''),
          gpcCode: String(claim.gpc_code ?? ''),
          gpcLevel: 'UNKNOWN',
          gpcTitle: title,
          belief: item.confidence,
          evidenceIds: item.supportedBy,
          derivation: 'STORED' as const,
        };
      })
      .filter((mapping) => mapping.gpcCode.length > 0);
  }
}
