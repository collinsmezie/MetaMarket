import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MemorySaver } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Checkpointer for the turn graph.
 *
 * Postgres rather than the in-process saver, for the same reason web delivery goes through
 * Redis: inbound turns are load-balanced, so a checkpoint only one replica can see is a
 * checkpoint that does not exist.
 *
 * What it stores is deliberately narrow. It owns *graph position within a turn* — how far the
 * segment loop got — and nothing else. The conversation's registry, active pointer, workflow
 * fingerprints and important entities stay in `workflow_instances`, because those drive
 * discovery and there must be exactly one answer to "what is this user in the middle of"
 * (Conversation-Core-Comparison TDR §6). Two owners of that is the hardest class of bug to
 * diagnose on a channel where sessions cannot be reproduced.
 */
@Injectable()
export class TurnCheckpointer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TurnCheckpointer.name);
  private saver: BaseCheckpointSaver = new MemorySaver();

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    try {
      const postgres = PostgresSaver.fromConnString(this.config.databaseUrl);
      await postgres.setup();
      this.saver = postgres;

      this.logger.log('Turn graph checkpoints are persisted to Postgres');
    } catch (error) {
      // A turn can run without durable checkpoints — it only loses the ability to resume a
      // half-finished turn after a crash. Refusing to boot over it would take the whole
      // platform down for a degradation.
      this.logger.error(
        `Could not set up the Postgres checkpointer; falling back to in-memory: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Closes the checkpointer's connection pool.
   *
   * Without this the pool outlives the Nest context: the process will not exit on shutdown,
   * and a test run hangs after the last assertion.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.saver instanceof PostgresSaver) await this.saver.end();
  }

  get instance(): BaseCheckpointSaver {
    return this.saver;
  }
}
