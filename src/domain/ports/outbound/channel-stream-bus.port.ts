import type { ConversationStreamEvent } from '../inbound/conversation-stream.port';

/**
 * Outbound port for the fan-out bus behind pull channels (web SSE today).
 *
 * `publish` answers how many live listeners received the event across the cluster; zero tells
 * the notifier to queue the reply durably instead of reporting it delivered. `subscribe`
 * attaches a listener on this replica. The Redis pub/sub implementation is an adapter detail.
 */

export const CHANNEL_STREAM_BUS = Symbol('ChannelStreamBus');

export interface ChannelStreamBusPort {
  publish(event: ConversationStreamEvent): Promise<number>;
  subscribe(conversationId: string, listener: (event: ConversationStreamEvent) => void): () => void;
}
