import { forwardRef, Module, type OnModuleInit } from '@nestjs/common';
import { ConversationModule } from '../config/conversation.module';
import { IntentModule } from '../intent/intent.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { SemanticsModule } from '../semantics/semantics.module';
import { PrismaClarificationRepository } from './adapters/persistence/prisma-clarification.repository';
import { PrismaLogicalTurnRepository } from './adapters/persistence/prisma-logical-turn.repository';
import { PrismaTurnContextRepository } from './adapters/persistence/prisma-turn-context.repository';
import { ClarificationService } from './application/clarification.service';
import { TurnAssemblyClassifier } from './application/turn-assembly-classifier';
import { TurnAssemblyService } from './application/turn-assembly.service';
import { TurnContextBuilder } from './application/turn-context.builder';
import { TurnExecutor } from './application/turn-executor';
import { TurnQueueWorker } from './application/turn-queue.worker';
import { CLARIFICATION_REPOSITORY } from './ports/clarification.repository.port';
import { LOGICAL_TURN_REPOSITORY } from './ports/logical-turn.repository.port';
import { TURN_CONTEXT_REPOSITORY } from './ports/turn-context.repository.port';

/**
 * MCOS conversation runtime (MCOS TDR v4.4 §5A, §7–§10, §25A, §63): logical turn assembly, the
 * durable turn queue, pending clarifications, per-turn context snapshots and the orchestrator seam.
 *
 * The seam `TURN_ORCHESTRATOR` is bound by `OrchestrationModule` to the v4.4 LangGraph
 * conversation orchestrator (MCOS §56 phases 3–7).
 */
@Module({
  imports: [
    forwardRef(() => ConversationModule),
    forwardRef(() => OrchestrationModule),
    IntentModule,
    SemanticsModule,
  ],
  providers: [
    { provide: LOGICAL_TURN_REPOSITORY, useClass: PrismaLogicalTurnRepository },
    { provide: CLARIFICATION_REPOSITORY, useClass: PrismaClarificationRepository },
    { provide: TURN_CONTEXT_REPOSITORY, useClass: PrismaTurnContextRepository },
    TurnAssemblyClassifier,
    ClarificationService,
    TurnContextBuilder,
    TurnExecutor,
    TurnQueueWorker,
    TurnAssemblyService,
  ],
  exports: [
    TurnAssemblyService,
    TurnQueueWorker,
    ClarificationService,
    LOGICAL_TURN_REPOSITORY,
    CLARIFICATION_REPOSITORY,
    TURN_CONTEXT_REPOSITORY,
  ],
})
export class ConversationRuntimeModule implements OnModuleInit {
  constructor(private readonly classifier: TurnAssemblyClassifier) {}

  /** Registers MCOS prompt/schema contracts so `/dev/registry` reflects them from boot. */
  onModuleInit(): void {
    this.classifier.register();
  }
}
