import { Controller, Get, Inject } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { LlmProviderService } from '../../outbound/llm/llm-provider.service';
import { PrismaService } from '../../outbound/persistence/prisma.service';
import { RedisService } from '../../outbound/persistence/redis.service';
import { ChannelNotifierRegistry } from '../../outbound/channel/channel-notifier.registry';
import { CHANNEL_NOTIFIER_REGISTRY } from '../../../domain/ports/outbound/channel-notifier.port';

/**
 * Operational health and readiness.
 *
 * Reports what is actually wired rather than a bare "ok", because the most common failure
 * mode in this system is a deployment that starts cleanly with a provider or channel
 * silently unconfigured.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly llm: LlmProviderService,
    private readonly config: AppConfigService,
    @Inject(CHANNEL_NOTIFIER_REGISTRY) private readonly notifiers: ChannelNotifierRegistry,
  ) {}

  @Get()
  async check(): Promise<Record<string, unknown>> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    const llmProviders = this.llm.configuredProviders;
    const whatsappConfigured =
      this.config.whatsapp.accessToken !== undefined && this.config.whatsapp.phoneNumberId !== undefined;

    const healthy = database.ok && redis.ok && llmProviders.length > 0;

    return {
      status: healthy ? 'ok' : 'degraded',
      checks: {
        database,
        redis,
        llm: {
          ok: llmProviders.length > 0,
          configuredProviders: llmProviders,
          circuits: this.llm.health(),
        },
        channels: {
          registered: this.notifiers.registeredChannels(),
          whatsappConfigured,
        },
      },
    };
  }

  private async checkDatabase(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async checkRedis(): Promise<{ ok: boolean; error?: string }> {
    try {
      const pong = await this.redis.client.ping();
      return { ok: pong === 'PONG' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
