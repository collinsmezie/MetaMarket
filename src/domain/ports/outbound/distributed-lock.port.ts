/**
 * Distributed locking so exactly one worker processes a conversation at a time
 * (MCOS §18, §20).
 *
 * Without this, two near-simultaneous WhatsApp messages on two pods would both read the
 * same workflow registry and race each other's writes — producing duplicate workflows
 * and lost state.
 */

export const DISTRIBUTED_LOCK = Symbol('DistributedLock');

export interface LockHandle {
  readonly key: string;
  /** Fencing token; releasing only succeeds if the lock is still held with this token. */
  readonly token: string;
  readonly acquiredAt: Date;
  readonly expiresAt: Date;
}

export interface DistributedLockPort {
  /**
   * Acquires `key`, waiting up to `waitMs` for a competing holder to finish.
   * Returns null rather than throwing when the lock could not be taken in time,
   * so callers must decide explicitly how to degrade.
   */
  acquire(key: string, ttlMs: number, waitMs: number): Promise<LockHandle | null>;

  /** Releases a held lock. A no-op when the lock already expired. */
  release(handle: LockHandle): Promise<void>;

  /**
   * Extends a lock that is still held.
   * Needed when a turn triggers slow work (transcription, LLM chain) and would otherwise
   * lose its lock mid-flight.
   */
  extend(handle: LockHandle, ttlMs: number): Promise<LockHandle | null>;
}

export class LockAcquisitionError extends Error {
  constructor(
    readonly key: string,
    readonly waitedMs: number,
  ) {
    super(`Could not acquire lock "${key}" within ${waitedMs}ms`);
    this.name = 'LockAcquisitionError';
  }
}

/** Namespaced lock key for a conversation's processing turn. */
export function conversationLockKey(conversationId: string): string {
  return `metamarket:lock:conversation:${conversationId}`;
}
