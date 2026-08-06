import { Module } from '@nestjs/common';
import { HealthController } from '../adapters/inbound/health/health.controller';
import { WhatsAppWebhookController } from '../adapters/inbound/whatsapp/whatsapp-webhook.controller';
import { MediaProcessingProcessor } from '../adapters/outbound/queue/media-processing.processor';
import { ConversationContextManager } from '../application/conversation/conversation-context.manager';
import { MediaProcessingService } from '../application/media/media-processing.service';
import { TaxonomySeeder } from '../application/taxonomy/taxonomy-seeder.service';
import { MessageIngestionService } from '../application/pipeline/message-ingestion.service';
import { TurnProcessor } from '../application/pipeline/turn-processor.service';
import { WORKFLOW_SERVICES } from '../application/pipeline/workflow-services';
import { ResponseComposer } from '../application/response/response-composer.service';
import { ConversationContinuityAnalyzer } from '../application/understanding/continuity-analyzer.service';
import { IntentResolutionService } from '../application/understanding/intent-resolution.service';
import { SemanticResolutionService } from '../application/understanding/semantic-resolution.service';
import { WorkflowExpirySweeper } from '../application/workflow/workflow-expiry.sweeper';
import { HANDLE_INCOMING_MESSAGE } from '../domain/ports/inbound/handle-incoming-message.port';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../domain/ports/outbound/embedding-provider.port';
import { LLM_PROVIDER_SERVICE, type LlmService } from '../domain/ports/outbound/llm-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../domain/ports/outbound/system.port';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepositoryPort,
} from '../domain/ports/outbound/workflow-repository.port';
import { ConversationPolicyEngine } from '../domain/workflows/conversation-policy';
import { triageWorkflow } from '../domain/workflows/definitions/triage.workflow';
import { WorkflowEngine } from '../domain/workflows/workflow-engine';
import { WorkflowManager } from '../domain/workflows/workflow-manager';
import { WorkflowDefinitionRegistry } from '../domain/workflows/workflow-registry';
import { AppConfigService } from './app-config.service';

/**
 * The Conversation OS itself: understanding stages, workflow lifecycle, and the pipeline.
 *
 * Domain classes are plain constructors with no Nest decorators (ADR-001 keeps the core
 * framework-free), so they are assembled here with explicit factories.
 */
@Module({
  controllers: [WhatsAppWebhookController, HealthController],
  providers: [
    ConversationContextManager,
    MediaProcessingService,
    TaxonomySeeder,
    ResponseComposer,
    ConversationContinuityAnalyzer,
    SemanticResolutionService,
    TurnProcessor,
    MessageIngestionService,
    MediaProcessingProcessor,
    WorkflowExpirySweeper,

    {
      provide: WorkflowDefinitionRegistry,
      useFactory: () => {
        const registry = new WorkflowDefinitionRegistry();
        // Phase 1 registers Triage only. Later phases add Vendor Onboarding and Buyer
        // Search here; higher policy priority makes them claim their intents automatically.
        registry.register(triageWorkflow);
        return registry;
      },
    },

    {
      // The prompt lists exactly the intents this deployment can route, so the model is
      // never asked to produce a label nothing can handle.
      provide: IntentResolutionService,
      inject: [LLM_PROVIDER_SERVICE, STAGE_LOGGER, WorkflowDefinitionRegistry],
      useFactory: (llm: LlmService, logger: StageLoggerPort, definitions: WorkflowDefinitionRegistry) => {
        const intents = [
          ...new Set(definitions.all().flatMap((definition) => definition.startingIntents)),
        ].filter((intent) => intent !== 'unknown');

        return new IntentResolutionService(llm, logger, intents);
      },
    },

    {
      provide: ConversationPolicyEngine,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new ConversationPolicyEngine({
          defaultIdleExpiryMs: config.conversationPolicy.workflowIdleExpiryMs,
          maxSuspendedWorkflows: config.conversationPolicy.maxSuspendedWorkflows,
        }),
    },

    {
      provide: WorkflowManager,
      inject: [WorkflowDefinitionRegistry, WORKFLOW_REPOSITORY, STAGE_LOGGER, EMBEDDING_PROVIDER],
      useFactory: (
        definitions: WorkflowDefinitionRegistry,
        workflows: WorkflowRepositoryPort,
        logger: StageLoggerPort,
        embeddings: EmbeddingProviderPort,
      ) => new WorkflowManager(definitions, workflows, logger, embeddings),
    },

    {
      provide: WorkflowEngine,
      inject: [WorkflowDefinitionRegistry, WORKFLOW_REPOSITORY, CLOCK, ID_GENERATOR, STAGE_LOGGER],
      useFactory: (
        definitions: WorkflowDefinitionRegistry,
        workflows: WorkflowRepositoryPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
        logger: StageLoggerPort,
      ) => new WorkflowEngine(definitions, workflows, clock, ids, logger),
    },

    {
      // No business services exist in Phase 1; the Triage workflow needs none. Phases 2-5
      // register the CDE, CME and Evidence services here.
      provide: WORKFLOW_SERVICES,
      useValue: {},
    },

    { provide: HANDLE_INCOMING_MESSAGE, useExisting: MessageIngestionService },
  ],
  exports: [MessageIngestionService, HANDLE_INCOMING_MESSAGE],
})
export class ConversationModule {}
