import type { Channel } from '../../models/channel';
import type { Response } from '../../models/response';

/**
 * Inbound port for channels that pull replies rather than receive a provider callback
 * (ADR-001 driver port; MCOS §24 channel abstraction).
 *
 * WhatsApp is push: Meta owns the socket to the handset and the platform hands it a message.
 * The web client is pull: the browser holds a stream open and the platform publishes into it.
 * Both channels still enter the runtime through `HandleIncomingMessagePort`; this port is the
 * pull channels' *outbound-facing* half, expressed as a port so the web adapter, like every
 * other channel adapter, depends on nothing but ports.
 */

export const CONVERSATION_STREAM = Symbol('ConversationStream');

export interface ChannelIdentity {
  readonly userId: string;
  readonly channel: Channel;
}

export type ConversationStreamEvent =
  | {
      readonly kind: 'message';
      readonly conversationId: string;
      /** The canonical response. Rendering stays the client's concern (MCOS §13). */
      readonly response: Response;
      readonly workflowId?: string;
      readonly at: string;
    }
  | {
      readonly kind: 'typing';
      readonly conversationId: string;
      readonly at: string;
    };

export interface ConversationTranscriptEntry {
  readonly role: string;
  readonly content: string;
  readonly at: Date;
}

export interface ConversationStreamPort {
  /** The platform conversation for a channel identity, created on first contact. */
  resolveConversation(identity: ChannelIdentity): Promise<string>;
  /** Subscribes to replies for a conversation; returns the unsubscribe function. */
  subscribe(conversationId: string, listener: (event: ConversationStreamEvent) => void): () => void;
  /** Transcript for rehydrating a client after reload. */
  history(
    identity: ChannelIdentity,
  ): Promise<{ conversationId: string; history: readonly ConversationTranscriptEntry[] }>;
}
