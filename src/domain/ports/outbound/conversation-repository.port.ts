import type { Channel } from '../../models/channel';
import type { Conversation, ConversationMemory, HistoryEntry } from '../../models/conversation';

/**
 * Persistence contract for the conversation aggregate (MCOS §18).
 *
 * Deliberately narrow: the Conversation Context Manager is the only caller, so the
 * storage engine stays swappable and no service reaches into conversation tables directly.
 */

export const CONVERSATION_REPOSITORY = Symbol('ConversationRepository');

export interface ConversationRepositoryPort {
  findById(conversationId: string): Promise<Conversation | null>;

  /**
   * Looks up the conversation for a user, creating it if absent.
   *
   * One conversation per user regardless of channel (MCOS §24), so a user who starts on
   * WhatsApp and follows up by SMS is understood as continuing, not starting over.
   * Must be safe under concurrent first messages.
   */
  findOrCreateByUser(params: {
    userId: string;
    channel: Channel;
  }): Promise<{ conversation: Conversation; created: boolean }>;

  /** Most recent history entries, oldest first, bounded to `limit`. */
  loadRecentHistory(conversationId: string, limit: number): Promise<readonly HistoryEntry[]>;

  appendHistory(conversationId: string, entry: HistoryEntry): Promise<void>;

  updateMemory(conversationId: string, memory: ConversationMemory): Promise<void>;

  /** Records the channel the last turn arrived on, so replies default to the right place. */
  touch(conversationId: string, channel: Channel, at: Date): Promise<void>;
}
