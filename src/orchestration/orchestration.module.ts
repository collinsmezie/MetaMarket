import { forwardRef, Module, type OnModuleInit } from '@nestjs/common';
import { ConversationModule } from '../config/conversation.module';
import { ConversationRuntimeModule } from '../conversation/conversation-runtime.module';
import { TURN_ORCHESTRATOR } from '../conversation/ports/turn-orchestrator.port';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { IntentModule } from '../intent/intent.module';
import { SemanticsModule } from '../semantics/semantics.module';
import { GpcResolverModule } from '../taxonomy/gpc-resolver.module';
import { LegacyWorkflowExecutionAdapter } from './adapters/legacy-workflow-execution.adapter';
import { VendorFastPathAdapter } from './adapters/vendor-fast-path.adapter';
import { ConversationCheckpointer } from './application/conversation-checkpointer.provider';
import { ConversationGraphNodes } from './application/conversation-graph.nodes';
import { ConversationOrchestrator } from './application/conversation-orchestrator.service';
import { OrchestrationPrompts } from './application/orchestration-prompts';
import { FAST_PATH } from './ports/fast-path.port';
import { WORKFLOW_EXECUTION } from './ports/workflow-execution.port';

/**
 * LangGraph conversation orchestrator v4.4 (component module; MCOS TDR §55 ownership).
 *
 * Owns understanding join, planning, scheduling, clarification gating, response planning and
 * composition. Business execution goes through `WORKFLOW_EXECUTION` (the deterministic workflow
 * engine), delivery through the existing durable path. It is the binding behind MCOS's
 * `TURN_ORCHESTRATOR` seam.
 */
@Module({
  imports: [
    forwardRef(() => ConversationModule),
    forwardRef(() => ConversationRuntimeModule),
    IntentModule,
    SemanticsModule,
    EnrichmentModule,
    GpcResolverModule,
  ],
  providers: [
    ConversationCheckpointer,
    OrchestrationPrompts,
    { provide: WORKFLOW_EXECUTION, useClass: LegacyWorkflowExecutionAdapter },
    { provide: FAST_PATH, useClass: VendorFastPathAdapter },
    ConversationGraphNodes,
    ConversationOrchestrator,
    { provide: TURN_ORCHESTRATOR, useExisting: ConversationOrchestrator },
  ],
  exports: [TURN_ORCHESTRATOR, ConversationOrchestrator],
})
export class OrchestrationModule implements OnModuleInit {
  constructor(private readonly prompts: OrchestrationPrompts) {}

  /** Registers P2–P6 so `/dev/registry` reflects them from boot. */
  onModuleInit(): void {
    this.prompts.register();
  }
}
