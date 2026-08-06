import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DistributedLockPort, LockHandle } from '../../../domain/ports/outbound/distributed-lock.port';
import { RedisService } from './redis.service';

/**
 * Redis-backed conversation locking (MCOS §18, §20).
 *
 * Uses SET NX PX with a random fencing token. The token matters: without it, a slow holder
 * whose lock expired could release a lock a *different* worker has since acquired, which
 * silently reintroduces the race the lock exists to prevent.
 */

/** Release only if the caller still owns the lock. */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

/** Extend only if the caller still owns the lock. */
const EXTEND_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

/** Polling interval while waiting for a competing holder to finish. */
const POLL_INTERVAL_MS = 50;

@Injectable()
export class RedisDistributedLockAdapter implements DistributedLockPort {
  constructor(private readonly redis: RedisService) {}

  async acquire(key: string, ttlMs: number, waitMs: number): Promise<LockHandle | null> {
    const token = randomUUID();
    const deadline = Date.now() + waitMs;

    for (;;) {
      const acquired = await this.redis.client.set(key, token, 'PX', ttlMs, 'NX');

      if (acquired === 'OK') {
        const acquiredAt = new Date();
        return {
          key,
          token,
          acquiredAt,
          expiresAt: new Date(acquiredAt.getTime() + ttlMs),
        };
      }

      if (Date.now() >= deadline) return null;

      // Sleep briefly rather than spinning; conversation turns are held for tens of ms.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()))),
      );
    }
  }

  async release(handle: LockHandle): Promise<void> {
    await this.redis.client.eval(RELEASE_SCRIPT, 1, handle.key, handle.token);
  }

  async extend(handle: LockHandle, ttlMs: number): Promise<LockHandle | null> {
    const extended = await this.redis.client.eval(
      EXTEND_SCRIPT,
      1,
      handle.key,
      handle.token,
      ttlMs.toString(),
    );

    if (extended !== 1) return null;

    return { ...handle, expiresAt: new Date(Date.now() + ttlMs) };
  }
}
