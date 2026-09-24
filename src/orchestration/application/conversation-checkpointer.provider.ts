import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Checkpointer for the conversation orchestrator graph (MCOS TDR §7–§8).
 *
 * Postgres, never in-memory: turns are load-balanced, so a checkpoint one replica cannot see is
 * a checkpoint that does not exist. It stores orchestration state for the conversation-scoped
 * thread — never business truth (§7.1). Fails closed: a deployment that cannot checkpoint must
 * not boot (gap analysis §5.4).
 */
@Injectable()
export class ConversationCheckpointer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConversationCheckpointer.name);
  private saver: PostgresSaver | null = null;

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    const postgres = PostgresSaver.fromConnString(this.config.databaseUrl);
    await postgres.setup();
    this.saver = postgres;
    this.logger.log('Conversation graph checkpoints are persisted to Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.saver !== null) await this.saver.end();
  }

  get instance(): BaseCheckpointSaver {
    if (this.saver === null)
      throw new Error('Checkpointer requested before the Postgres saver was initialised');
    return this.saver;
  }
}
