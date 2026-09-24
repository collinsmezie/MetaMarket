import { forwardRef, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { EVENT_HANDLER_REGISTRY, type EventHandlerRegistry } from '../platform/events/domain-event';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { EvidenceIngestionHandler } from './adapters/events/evidence-ingestion.handler';
import { RecordingGraphChangeSink } from './adapters/graph/recording-graph-change-sink';
import { EvidenceController } from './adapters/http/evidence.controller';
import { PrismaEvidenceStore } from './adapters/persistence/prisma-evidence-store';
import { EvidenceQueryService } from './application/evidence-query.service';
import { EvidenceService } from './application/evidence.service';
import { EVIDENCE_INTAKE } from './ports/evidence-intake.port';
import { EVIDENCE_QUERY } from './ports/evidence-query.port';
import { EVIDENCE_STORE } from './ports/evidence-store.port';
import { GRAPH_CHANGE_SINK } from './ports/graph-change-sink.port';

/**
 * Evidence System v4.4 (component module): observations → evidence → knowledge → belief →
 * GraphChangeDecision. Ingests platform facts through the durable outbox consumer and exposes
 * `EVIDENCE_QUERY` to consumers (CSRE grounding, GPC priors, later Capability Projection and
 * Matching). The graph hand-off is a port; Phase 9 binds the MKG writer.
 */
@Module({
  // Enrichment → Semantics → Evidence → Enrichment is a legitimate learning loop; forwardRef breaks the import cycle.
  imports: [RetrievalModule, forwardRef(() => EnrichmentModule)],
  controllers: [EvidenceController],
  providers: [
    { provide: EVIDENCE_STORE, useClass: PrismaEvidenceStore },
    { provide: GRAPH_CHANGE_SINK, useClass: RecordingGraphChangeSink },
    EvidenceService,
    { provide: EVIDENCE_INTAKE, useExisting: EvidenceService },
    EvidenceQueryService,
    { provide: EVIDENCE_QUERY, useExisting: EvidenceQueryService },
    EvidenceIngestionHandler,
  ],
  exports: [EVIDENCE_INTAKE, EVIDENCE_QUERY, EVIDENCE_STORE, EvidenceService],
})
export class EvidenceModule implements OnModuleInit {
  constructor(
    private readonly evidence: EvidenceService,
    private readonly handler: EvidenceIngestionHandler,
    @Inject(EVENT_HANDLER_REGISTRY) private readonly handlers: EventHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.evidence.register();
    this.handlers.register(this.handler);
  }
}
