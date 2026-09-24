import { forwardRef, Module, type OnModuleInit } from '@nestjs/common';
import { EvidenceModule } from '../evidence/evidence.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { WrsExternalEvidenceRetrieval } from './adapters/evidence/wrs-external-evidence.adapter';
import { EvidenceSemanticGrounding } from './adapters/grounding/evidence-semantic-grounding.adapter';
import { CsreController } from './adapters/http/csre.controller';
import { PrismaSemanticResolutionRepository } from './adapters/persistence/prisma-semantic-resolution.repository';
import { CsreSpecialistAdapter } from './application/csre-specialist.adapter';
import { CsreService } from './application/csre.service';
import { EXTERNAL_EVIDENCE_RETRIEVAL, SEMANTIC_GROUNDING } from './ports/semantic-grounding.port';
import { SEMANTIC_RESOLUTION } from './ports/semantic-resolution.port';
import { SEMANTIC_RESOLUTION_REPOSITORY } from './ports/semantic-resolution.repository.port';

/**
 * CSRE — Commercial Semantic Resolution Engine v5.4 (component module).
 *
 * Owns referent resolution and its persistence. Depends only on the platform runtime and two
 * outbound knowledge ports: grounding (bound to the Evidence/MKG layer in Phases 8–9) and
 * external evidence (bound to WRS through `WrsExternalEvidenceRetrieval`, Phase 7). It never
 * imports IDCE, taxonomy, matching or workflow code.
 */
@Module({
  imports: [RetrievalModule, forwardRef(() => EvidenceModule)],
  controllers: [CsreController],
  providers: [
    { provide: SEMANTIC_RESOLUTION_REPOSITORY, useClass: PrismaSemanticResolutionRepository },
    { provide: SEMANTIC_GROUNDING, useClass: EvidenceSemanticGrounding },
    { provide: EXTERNAL_EVIDENCE_RETRIEVAL, useClass: WrsExternalEvidenceRetrieval },
    CsreService,
    { provide: SEMANTIC_RESOLUTION, useExisting: CsreService },
    CsreSpecialistAdapter,
  ],
  exports: [SEMANTIC_RESOLUTION, SEMANTIC_RESOLUTION_REPOSITORY, SEMANTIC_GROUNDING, CsreSpecialistAdapter],
})
export class SemanticsModule implements OnModuleInit {
  constructor(private readonly csre: CsreService) {}

  onModuleInit(): void {
    this.csre.register();
  }
}
