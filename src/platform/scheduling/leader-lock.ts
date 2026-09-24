import type { DistributedLockPort } from '../../domain/ports/outbound/distributed-lock.port';

/**
 * Leader election for periodic sweepers (Directive §27; Gap Analysis §5.7).
 *
 * Every replica runs every `@Interval`, so without this each sweep executes N times per tick.
 * The lock is held only for the duration of one sweep; there is no long-lived leader, which
 * keeps failover trivial: whichever replica wins the next tick does the work.
 */
export class LeaderLock {
  constructor(
    private readonly locks: DistributedLockPort,
    private readonly namespace = 'metamarket:leader',
  ) {}

  /**
   * Runs `work` if this process wins the lock for `name`; returns null when another replica
   * holds it. `ttlMs` should exceed the longest plausible sweep so a slow sweep cannot be
   * duplicated by the next tick on another replica.
   */
  async runExclusively<T>(name: string, ttlMs: number, work: () => Promise<T>): Promise<T | null> {
    const handle = await this.locks.acquire(`${this.namespace}:${name}`, ttlMs, 0);
    if (handle === null) return null;

    try {
      return await work();
    } finally {
      await this.locks.release(handle);
    }
  }
}
