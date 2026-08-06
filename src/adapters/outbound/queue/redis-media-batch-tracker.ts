import { Injectable } from '@nestjs/common';
import type { MediaBatchTrackerPort } from '../../../domain/ports/outbound/media.port';
import { RedisService } from '../persistence/redis.service';

/**
 * Redis-backed tracking of which media parts of a message have settled.
 *
 * A Redis set keyed by message id gives idempotent membership (a BullMQ retry re-adding the
 * same index does not double-count) and an atomic cardinality check, so exactly one worker
 * learns it settled the final part.
 */

/**
 * Safety net in case a message is abandoned mid-processing; well past any realistic media
 * pipeline duration, so it never expires a batch that is still in flight.
 */
const TRACKER_TTL_SECONDS = 3_600;

@Injectable()
export class RedisMediaBatchTracker implements MediaBatchTrackerPort {
  constructor(private readonly redis: RedisService) {}

  async markSettled(messageId: string, partIndex: number, totalParts: number): Promise<boolean> {
    const key = this.key(messageId);

    // Pipelined so the add and the count happen without another worker interleaving.
    const [, cardinality] = await this.redis.client
      .multi()
      .sadd(key, partIndex.toString())
      .scard(key)
      .expire(key, TRACKER_TTL_SECONDS)
      .exec()
      .then((results) => results ?? []);

    const settledCount = Number(cardinality?.[1] ?? 0);

    return settledCount >= totalParts;
  }

  async clear(messageId: string): Promise<void> {
    await this.redis.client.del(this.key(messageId));
  }

  private key(messageId: string): string {
    return `metamarket:media:settled:${messageId}`;
  }
}
