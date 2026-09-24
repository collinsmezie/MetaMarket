import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { ConversationModule } from './config/conversation.module';
import { InfrastructureModule } from './config/infrastructure.module';
import { EnrichmentModule } from './enrichment/enrichment.module';
import { EvidenceModule } from './evidence/evidence.module';
import { IntentModule } from './intent/intent.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { DevModule } from './platform/live-test/dev.module';
import { PlatformModule } from './platform/platform.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { SemanticsModule } from './semantics/semantics.module';
import { GpcResolverModule } from './taxonomy/gpc-resolver.module';

/**
 * Composition root.
 *
 * Layers, matching ADR-001 and the v1.3 blueprint: configuration, infrastructure adapters, the
 * shared platform runtime (contracts, prompt runtime, durable events, traces), the conversation
 * system, and — outside production only — the dev inspection surface.
 */
const devApiEnabled = process.env.NODE_ENV !== 'production' && process.env.DEV_TRACE_API_ENABLED !== 'false';

@Module({
  imports: [
    AppConfigModule,
    InfrastructureModule,
    PlatformModule,
    IntentModule,
    RetrievalModule,
    SemanticsModule,
    EnrichmentModule,
    GpcResolverModule,
    EvidenceModule,
    OrchestrationModule,
    ConversationModule,
    DevModule.forRoot(devApiEnabled),
  ],
})
export class AppModule {}
