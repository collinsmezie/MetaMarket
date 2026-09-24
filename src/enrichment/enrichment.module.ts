import { Module, type OnModuleInit } from '@nestjs/common';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { SemanticsModule } from '../semantics/semantics.module';
import { WrsEnrichmentEvidenceRetrieval } from './adapters/evidence/wrs-enrichment-evidence.adapter';
import { EnrichmentController } from './adapters/http/enrichment.controller';
import { NoopMkgRead } from './adapters/knowledge/noop-knowledge.adapter';
import { PrismaEnrichmentRepository } from './adapters/persistence/prisma-enrichment.repository';
import { EnrichmentAdapter } from './application/enrichment.adapter';
import { EnrichmentService } from './application/enrichment.service';
import { ENRICHMENT_REPOSITORY } from './ports/enrichment.repository.port';
import { ENRICHMENT_EVIDENCE_RETRIEVAL, MKG_READ } from './ports/mkg-read.port';
import { SEMANTIC_ENRICHMENT } from './ports/semantic-enrichment.port';

/**
 * GPC-Oriented Semantic Enrichment Engine v4.4 (component module).
 *
 * Consumes CSRE objects (read through the semantics repository for byte-exact wire objects),
 * reads knowledge through `MKG_READ` (placeholder-bound until Phase 9) and evidence through
 * `ENRICHMENT_EVIDENCE_RETRIEVAL` (WRS, Phase 7), and never writes the graph.
 */
@Module({
  imports: [SemanticsModule, RetrievalModule],
  controllers: [EnrichmentController],
  providers: [
    { provide: ENRICHMENT_REPOSITORY, useClass: PrismaEnrichmentRepository },
    { provide: MKG_READ, useClass: NoopMkgRead },
    { provide: ENRICHMENT_EVIDENCE_RETRIEVAL, useClass: WrsEnrichmentEvidenceRetrieval },
    EnrichmentService,
    { provide: SEMANTIC_ENRICHMENT, useExisting: EnrichmentService },
    EnrichmentAdapter,
  ],
  exports: [SEMANTIC_ENRICHMENT, ENRICHMENT_REPOSITORY, MKG_READ, EnrichmentAdapter],
})
export class EnrichmentModule implements OnModuleInit {
  constructor(private readonly enrichment: EnrichmentService) {}

  onModuleInit(): void {
    this.enrichment.register();
  }
}
