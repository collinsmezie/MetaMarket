import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { OpenAiEmbeddingAdapter } from '../adapters/outbound/ai/openai-embedding.adapter';
import { ChannelNotifierRegistry } from '../adapters/outbound/channel/channel-notifier.registry';
import { TwilioSmsNotifier } from '../adapters/outbound/channel/twilio-sms-notifier.adapter';
import { WhatsAppNotifier } from '../adapters/outbound/channel/whatsapp-notifier.adapter';
import { OutboxEventPublisher } from '../adapters/outbound/events/outbox-event-publisher';
import { OutboxRelay } from '../adapters/outbound/events/outbox-relay.service';
import { AnthropicLlmAdapter } from '../adapters/outbound/llm/anthropic-llm.adapter';
import { GeminiLlmAdapter } from '../adapters/outbound/llm/gemini-llm.adapter';
import { LlmProviderService } from '../adapters/outbound/llm/llm-provider.service';
import { OpenAiLlmAdapter } from '../adapters/outbound/llm/openai-llm.adapter';
import { S3MediaStore } from '../adapters/outbound/media/s3-media-store.adapter';
import { VisionOcrAdapter } from '../adapters/outbound/media/vision-ocr.adapter';
import { WhatsAppMediaDownloader } from '../adapters/outbound/media/whatsapp-media-downloader.adapter';
import { WhisperSpeechToTextAdapter } from '../adapters/outbound/media/whisper-speech-to-text.adapter';
import { PrismaConversationRepository } from '../adapters/outbound/persistence/prisma-conversation.repository';
import { PrismaMessageRepository } from '../adapters/outbound/persistence/prisma-message.repository';
import { PrismaWorkflowRepository } from '../adapters/outbound/persistence/prisma-workflow.repository';
import { PrismaService } from '../adapters/outbound/persistence/prisma.service';
import { PrismaTaxonomyRepository } from '../adapters/outbound/persistence/prisma-taxonomy.repository';
import { PrismaVendorRepository } from '../adapters/outbound/persistence/prisma-vendor.repository';
import { PrismaServiceCapabilityRepository } from '../adapters/outbound/persistence/prisma-service-capability.repository';
import { RedisDistributedLockAdapter } from '../adapters/outbound/persistence/redis-distributed-lock.adapter';
import { RedisService } from '../adapters/outbound/persistence/redis.service';
import { BullMediaQueue } from '../adapters/outbound/queue/media-queue.adapter';
import { MEDIA_QUEUE_NAME } from '../adapters/outbound/queue/media-queue.constants';
import { RedisMediaBatchTracker } from '../adapters/outbound/queue/redis-media-batch-tracker';
import { UuidIdGenerator } from '../adapters/outbound/system/uuid-id-generator';
import {
  MediaDownloaderRegistry,
  MEDIA_DOWNLOADER_REGISTRY,
} from '../application/media/media-downloader.registry';
import { CHANNEL_NOTIFIER_REGISTRY } from '../domain/ports/outbound/channel-notifier.port';
import { CONVERSATION_REPOSITORY } from '../domain/ports/outbound/conversation-repository.port';
import { DISTRIBUTED_LOCK } from '../domain/ports/outbound/distributed-lock.port';
import { EMBEDDING_PROVIDER } from '../domain/ports/outbound/embedding-provider.port';
import { EVENT_PUBLISHER } from '../domain/ports/outbound/event-publisher.port';
import { LLM_PROVIDER_SERVICE } from '../domain/ports/outbound/llm-provider.port';
import {
  MEDIA_BATCH_TRACKER,
  MEDIA_PROCESSING_QUEUE,
  MEDIA_STORE,
  OCR,
  SPEECH_TO_TEXT,
} from '../domain/ports/outbound/media.port';
import { MESSAGE_REPOSITORY } from '../domain/ports/outbound/message-repository.port';
import { STAGE_LOGGER } from '../domain/ports/outbound/stage-logger.port';
import { SERVICE_CAPABILITY_REPOSITORY } from '../domain/ports/outbound/service-capability-repository.port';
import { TAXONOMY_REPOSITORY } from '../domain/ports/outbound/taxonomy-repository.port';
import { VENDOR_REPOSITORY } from '../domain/ports/outbound/vendor-repository.port';
import { WORKFLOW_REPOSITORY } from '../domain/ports/outbound/workflow-repository.port';
import { CLOCK, ID_GENERATOR, SystemClock } from '../domain/ports/outbound/system.port';
import { StageLogger } from '../shared/logging/stage-logger';
import { AppConfigService } from './app-config.service';

/**
 * Binds every outbound port to its adapter (ADR-001 composition root).
 *
 * This is the only place where a port symbol meets a concrete implementation. Swapping
 * Postgres for something else, or adding a channel, is a change to this file plus one new
 * adapter — nothing in `domain/` or `application/` moves.
 */
@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 }),
    // Drives the outbox relay and the workflow expiry sweeper.
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        // BullMQ wants host/port rather than a URL, and needs `maxRetriesPerRequest: null`
        // on its connection or workers abort on the first Redis blip.
        const url = new URL(config.redisUrl);
        return {
          connection: {
            host: url.hostname,
            port: url.port.length > 0 ? Number(url.port) : 6379,
            ...(url.password.length > 0 ? { password: url.password } : {}),
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: MEDIA_QUEUE_NAME }),
  ],
  providers: [
    PrismaService,
    RedisService,

    { provide: STAGE_LOGGER, useClass: StageLogger },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidIdGenerator },

    { provide: CONVERSATION_REPOSITORY, useClass: PrismaConversationRepository },
    { provide: MESSAGE_REPOSITORY, useClass: PrismaMessageRepository },
    { provide: WORKFLOW_REPOSITORY, useClass: PrismaWorkflowRepository },
    { provide: TAXONOMY_REPOSITORY, useClass: PrismaTaxonomyRepository },
    { provide: VENDOR_REPOSITORY, useClass: PrismaVendorRepository },
    { provide: SERVICE_CAPABILITY_REPOSITORY, useClass: PrismaServiceCapabilityRepository },
    { provide: DISTRIBUTED_LOCK, useClass: RedisDistributedLockAdapter },

    OpenAiLlmAdapter,
    GeminiLlmAdapter,
    AnthropicLlmAdapter,
    LlmProviderService,
    { provide: LLM_PROVIDER_SERVICE, useExisting: LlmProviderService },
    { provide: EMBEDDING_PROVIDER, useClass: OpenAiEmbeddingAdapter },

    { provide: MEDIA_STORE, useClass: S3MediaStore },
    { provide: SPEECH_TO_TEXT, useClass: WhisperSpeechToTextAdapter },
    { provide: OCR, useClass: VisionOcrAdapter },
    { provide: MEDIA_PROCESSING_QUEUE, useClass: BullMediaQueue },
    { provide: MEDIA_BATCH_TRACKER, useClass: RedisMediaBatchTracker },

    WhatsAppMediaDownloader,
    {
      provide: MEDIA_DOWNLOADER_REGISTRY,
      inject: [WhatsAppMediaDownloader],
      useFactory: (whatsapp: WhatsAppMediaDownloader) => new MediaDownloaderRegistry([whatsapp]),
    },

    WhatsAppNotifier,
    TwilioSmsNotifier,
    {
      provide: CHANNEL_NOTIFIER_REGISTRY,
      inject: [WhatsAppNotifier, TwilioSmsNotifier],
      // Voice and USSD notifiers are not implemented in Phase 1. The registry reports an
      // unsupported channel explicitly rather than silently dropping a reply.
      useFactory: (whatsapp: WhatsAppNotifier, sms: TwilioSmsNotifier) =>
        new ChannelNotifierRegistry([whatsapp, sms]),
    },

    { provide: EVENT_PUBLISHER, useClass: OutboxEventPublisher },
    OutboxRelay,
  ],
  exports: [
    PrismaService,
    RedisService,
    LlmProviderService,
    STAGE_LOGGER,
    CLOCK,
    ID_GENERATOR,
    CONVERSATION_REPOSITORY,
    MESSAGE_REPOSITORY,
    WORKFLOW_REPOSITORY,
    TAXONOMY_REPOSITORY,
    VENDOR_REPOSITORY,
    SERVICE_CAPABILITY_REPOSITORY,
    DISTRIBUTED_LOCK,
    LLM_PROVIDER_SERVICE,
    EMBEDDING_PROVIDER,
    MEDIA_STORE,
    SPEECH_TO_TEXT,
    OCR,
    MEDIA_PROCESSING_QUEUE,
    MEDIA_BATCH_TRACKER,
    MEDIA_DOWNLOADER_REGISTRY,
    CHANNEL_NOTIFIER_REGISTRY,
    EVENT_PUBLISHER,
    BullModule,
  ],
})
export class InfrastructureModule {}
