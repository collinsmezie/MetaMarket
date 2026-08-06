import type { Artifact } from '../../models/artifact';
import type { IncomingMessage } from '../../models/incoming-message';

/**
 * Persistence for inbound messages and their derived artifacts.
 *
 * Separate from the conversation repository because these rows have a different lifecycle:
 * a message is written on arrival and gains artifacts asynchronously, potentially on a
 * different worker, after the conversation turn has already been parked.
 */

export const MESSAGE_REPOSITORY = Symbol('MessageRepository');

export interface MessageRepositoryPort {
  /**
   * Records an arriving message.
   *
   * Returns false when `providerMessageId` was already stored — the provider retried a
   * webhook it had already delivered. Detecting this at the unique index rather than with a
   * prior read closes the race between two concurrent retries.
   */
  saveIncoming(message: IncomingMessage): Promise<boolean>;

  findById(messageId: string): Promise<IncomingMessage | null>;

  appendArtifacts(messageId: string, artifacts: readonly Artifact[]): Promise<void>;

  /** All artifacts for a message, in the order they were produced. */
  loadArtifacts(messageId: string): Promise<readonly Artifact[]>;

  markProcessed(messageId: string, at: Date): Promise<void>;

  /** True once the pipeline has finished handling this message. */
  isProcessed(messageId: string): Promise<boolean>;
}
