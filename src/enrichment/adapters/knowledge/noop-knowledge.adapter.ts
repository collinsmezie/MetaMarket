import { Injectable } from '@nestjs/common';
import type { MarketConceptKnowledge, MKGReadPort } from '../../ports/mkg-read.port';

/**
 * Placeholder MKG read binding until the Market Knowledge Graph exists (Phase 9).
 * They supply *no* knowledge rather than guessed knowledge: model memory must never be
 * presented as marketplace observation (Enrichment §29.4).
 */
@Injectable()
export class NoopMkgRead implements MKGReadPort {
  async knowledgeFor(): Promise<readonly MarketConceptKnowledge[]> {
    return [];
  }
}
