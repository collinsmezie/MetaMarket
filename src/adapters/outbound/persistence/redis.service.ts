import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../../../config/app-config.service';

/**
 * Shared Redis connection.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on connections it uses; setting it here
 * keeps a single connection policy across locking, caching and queues.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: AppConfigService) {
    this.client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      // Reconnect on failover instead of surfacing errors to every caller.
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    });

    this.client.on('error', (error) => this.logger.error(`Redis error: ${error.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
