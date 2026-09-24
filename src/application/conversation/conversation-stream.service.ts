import { Inject, Injectable } from '@nestjs/common';
import type {
  ChannelIdentity,
  ConversationStreamEvent,
  ConversationStreamPort,
  ConversationTranscriptEntry,
} from '../../domain/ports/inbound/conversation-stream.port';
import {
  CHANNEL_STREAM_BUS,
  type ChannelStreamBusPort,
} from '../../domain/ports/outbound/channel-stream-bus.port';
import { ConversationContextManager } from './conversation-context.manager';

/**
 * Application service behind `ConversationStreamPort` (MCOS §24).
 *
 * Resolves channel identities to conversations and exposes the reply bus and transcript, so a
 * pull-channel adapter never touches the context manager or the bus implementation directly.
 */
@Injectable()
export class ConversationStreamService implements ConversationStreamPort {
  constructor(
    private readonly context: ConversationContextManager,
    @Inject(CHANNEL_STREAM_BUS) private readonly bus: ChannelStreamBusPort,
  ) {}

  resolveConversation(identity: ChannelIdentity): Promise<string> {
    return this.context.resolveConversationId(identity);
  }

  subscribe(conversationId: string, listener: (event: ConversationStreamEvent) => void): () => void {
    return this.bus.subscribe(conversationId, listener);
  }

  async history(
    identity: ChannelIdentity,
  ): Promise<{ conversationId: string; history: readonly ConversationTranscriptEntry[] }> {
    const { conversation } = await this.context.load(identity);
    return {
      conversationId: conversation.id,
      history: conversation.history.map((entry) => ({
        role: entry.role,
        content: entry.content,
        at: entry.timestamp,
      })),
    };
  }
}
