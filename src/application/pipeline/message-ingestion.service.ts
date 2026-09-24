import { Inject, Injectable } from '@nestjs/common';
import type { Artifact } from '../../domain/models/artifact';
import { collectText } from '../../domain/models/artifact';
import type { IncomingMessage } from '../../domain/models/incoming-message';
import { PROVIDER_MESSAGE_ID_KEY, requiresMediaProcessing } from '../../domain/models/incoming-message';
import type {
  HandleIncomingMessagePort,
  HandleIncomingMessageResult,
} from '../../domain/ports/inbound/handle-incoming-message.port';
import { EVENT_PUBLISHER, type EventPublisherPort } from '../../domain/ports/outbound/event-publisher.port';
import {
  MEDIA_PROCESSING_QUEUE,
  type MediaProcessingQueuePort,
} from '../../domain/ports/outbound/media.port';
import {
  MESSAGE_REPOSITORY,
  type MessageRepositoryPort,
} from '../../domain/ports/outbound/message-repository.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import { TurnAssemblyService } from '../../conversation/application/turn-assembly.service';
import { RequestContextStore } from '../../platform/correlation/request-context';
import { correlatedEvent, PlatformEvents } from '../../platform/events/domain-event';
import { ConversationContextManager } from '../conversation/conversation-context.manager';
import { MediaProcessingService } from '../media/media-processing.service';

const COMPONENT = 'MCOS';
const STAGE = 'MessageIngestion';

/**
 * Entry point for every inbound message, on every channel (MCOS TDR v4.4 §4, §5A.2, §18.2).
 *
 *   provider event → canonical message → durable insert → idempotency → inline artifacts →
 *   (media queue) → Turn Assembly
 *
 * Ingestion never runs the conversation: a transport message is not a turn. It persists,
 * deduplicates and hands the message to Turn Assembly, which decides the logical-turn boundary
 * and enqueues sealed turns for the queue worker. The reply reaches the user through durable
 * delivery, never through this call's return value.
 */
@Injectable()
export class MessageIngestionService implements HandleIncomingMessagePort {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
    @Inject(MEDIA_PROCESSING_QUEUE) private readonly mediaQueue: MediaProcessingQueuePort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly context: ConversationContextManager,
    private readonly media: MediaProcessingService,
    private readonly assembly: TurnAssemblyService,
  ) {}

  async handle(incoming: IncomingMessage): Promise<HandleIncomingMessageResult> {
    const startedAt = Date.now();

    // Adapters know a phone number or session, not a conversation id, so the platform resolves
    // it here before anything is persisted against it.
    const conversationId = await this.context.resolveConversationId({
      userId: incoming.userId,
      channel: incoming.channel,
    });

    const message: IncomingMessage = { ...incoming, conversationId };

    return RequestContextStore.extend(
      { conversationId, messageId: message.id, component: 'MCOS' },
      async () => {
        const stored = await this.messages.saveIncoming(message);

        if (!stored) {
          // Meta retries webhooks it believes were not acknowledged. Re-assembling the message
          // could duplicate a turn, so a duplicate delivery is a recorded no-op (§18.2, §47).
          this.logger.stage({
            component: COMPONENT,
            stage: STAGE,
            input: { providerMessageId: message.metadata[PROVIDER_MESSAGE_ID_KEY] },
            action: 'Ignored a duplicate provider delivery for a message already recorded',
            output: { deduplicated: true },
            durationMs: Date.now() - startedAt,
          });
          return this.result(conversationId, { deduplicated: true, deferred: false, turnId: null });
        }

        await this.events.publish(
          correlatedEvent({
            eventId: this.ids.uuid(),
            eventType: PlatformEvents.MessageReceived,
            producer: 'MCOS',
            occurredAt: this.clock.now(),
            payload: {
              messageId: message.id,
              channel: message.channel,
              partTypes: message.parts.map((part) => part.type),
            },
            conversationId,
            aggregate: { type: 'Conversation', id: conversationId },
          }),
        );

        const inlineArtifacts = this.media.extractInlineArtifacts(message);
        await this.messages.appendArtifacts(message.id, inlineArtifacts);

        this.logger.stage({
          component: COMPONENT,
          stage: STAGE,
          input: {
            messageId: message.id,
            channel: message.channel,
            parts: message.parts.map((part) => part.type),
          },
          action: 'Persisted the canonical message and extracted inline artifacts',
          output: {
            inlineArtifacts: inlineArtifacts.length,
            requiresMedia: requiresMediaProcessing(message),
          },
          durationMs: Date.now() - startedAt,
        });

        // Heavy media work must not block the webhook (§31). The message joins a logical turn in
        // `resumeAfterMedia`, once its transcript/visual artifacts exist.
        if (requiresMediaProcessing(message)) {
          for (const job of this.media.mediaJobsFor(message)) await this.mediaQueue.enqueue(job);
          return this.result(conversationId, { deduplicated: false, deferred: true, turnId: null });
        }

        return this.assemble(message, inlineArtifacts);
      },
    );
  }

  /** Continues a message that was parked awaiting media processing. */
  async resumeAfterMedia(messageId: string): Promise<HandleIncomingMessageResult | null> {
    const message = await this.messages.findById(messageId);

    if (message === null) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:ResumeAfterMedia`,
        input: { messageId },
        action: 'Cannot resume a message that is no longer stored',
        error: new Error(`Message ${messageId} not found`),
      });
      return null;
    }

    // Guards against two media jobs finishing simultaneously and both assembling the message.
    if (await this.messages.isProcessed(messageId)) return null;
    const existing = await this.assembly.turnOf(messageId);
    if (existing !== null)
      return this.result(message.conversationId, { deduplicated: true, deferred: false, turnId: existing });

    const artifacts = await this.messages.loadArtifacts(messageId);

    return RequestContextStore.extend(
      { conversationId: message.conversationId, messageId, component: 'MCOS' },
      () => this.assemble(message, artifacts),
    );
  }

  private async assemble(
    message: IncomingMessage,
    artifacts: readonly Artifact[],
  ): Promise<HandleIncomingMessageResult> {
    const outcome = await this.assembly.accept({ message, text: collectText(artifacts) });
    return this.result(message.conversationId, {
      deduplicated: false,
      deferred: false,
      turnId: outcome.turn.turnId,
    });
  }

  private result(
    conversationId: string,
    flags: { deduplicated: boolean; deferred: boolean; turnId: string | null },
  ): HandleIncomingMessageResult {
    return { conversationId, response: null, workflowId: null, ...flags };
  }
}
