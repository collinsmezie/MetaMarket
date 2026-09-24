import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AppConfigService } from '../../config/app-config.service';
import {
  DISTRIBUTED_LOCK,
  type DistributedLockPort,
} from '../../domain/ports/outbound/distributed-lock.port';
import { CLOCK, type ClockPort } from '../../domain/ports/outbound/system.port';
import { LeaderLock } from '../../platform/scheduling/leader-lock';
import {
  LOGICAL_TURN_REPOSITORY,
  type LogicalTurnRepositoryPort,
} from '../ports/logical-turn.repository.port';
import { TurnExecutor } from './turn-executor';

const POLL_INTERVAL_MS = 1_000;
const RECOVERY_INTERVAL_MS = 30_000;
const MAX_CONCURRENT_TURNS = 4;

/**
 * Queued-turn executor (MCOS TDR §5A.10–§5A.11, §19).
 *
 * Claims are atomic and per-conversation ordered in the database, so every replica may poll and
 * claim concurrently: two replicas can never run Turn N and Turn N+1 of one conversation at the
 * same time, and a later turn never overtakes an earlier eligible one. In-process `kick`s make the
 * common path immediate; the poll is the guarantee.
 */
@Injectable()
export class TurnQueueWorker implements OnModuleDestroy {
  private readonly logger = new Logger(TurnQueueWorker.name);
  private readonly workerId = `${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
  private readonly leader: LeaderLock;
  private readonly pendingKicks = new Set<string>();
  private inFlight = 0;
  private stopped = false;

  constructor(
    @Inject(LOGICAL_TURN_REPOSITORY) private readonly turns: LogicalTurnRepositoryPort,
    @Inject(DISTRIBUTED_LOCK) locks: DistributedLockPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly config: AppConfigService,
    private readonly executor: TurnExecutor,
  ) {
    this.leader = new LeaderLock(locks);
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  /** Runs the next eligible turn for a conversation as soon as the current call stack unwinds. */
  kick(conversationId: string): void {
    if (this.stopped || this.pendingKicks.has(conversationId)) return;
    this.pendingKicks.add(conversationId);
    setImmediate(() => {
      this.pendingKicks.delete(conversationId);
      void this.drain(conversationId);
    });
  }

  @Interval(POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    if (this.stopped) return;
    await this.drain();
  }

  @Interval(RECOVERY_INTERVAL_MS)
  async recover(): Promise<void> {
    if (this.stopped) return;
    await this.leader.runExclusively('turn-queue-recovery', RECOVERY_INTERVAL_MS, async () => {
      const staleBefore = new Date(this.clock.now().getTime() - this.config.turnAssembly.claimTtlMs);
      const recovered = await this.turns.recoverStaleClaims(
        staleBefore,
        this.config.turnAssembly.maxExecutionAttempts,
      );
      if (recovered > 0) this.logger.warn(`Recovered ${recovered} stale turn claim(s) back to the queue`);
    });
  }

  /**
   * Claims and executes turns until nothing is eligible or the concurrency budget is spent.
   * Each executed turn re-kicks its conversation so a queued follow-up runs immediately after.
   */
  async drain(conversationId?: string): Promise<number> {
    let started = 0;
    while (!this.stopped && this.inFlight < MAX_CONCURRENT_TURNS) {
      let entry;
      try {
        entry = await this.turns.claimNext(this.workerId, conversationId);
      } catch (error) {
        this.logger.error(`Turn claim failed: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      if (entry === null) break;

      started += 1;
      this.inFlight += 1;
      const claimed = entry;
      void this.executor
        .execute(claimed)
        .catch((error: unknown) =>
          this.logger.error(
            `Turn ${claimed.turnId} execution crashed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
        .finally(() => {
          this.inFlight -= 1;
          this.kick(claimed.conversationId);
        });

      if (conversationId !== undefined) break;
    }
    return started;
  }

  /** Test/live-test helper: drains synchronously, awaiting each executed turn. */
  async drainAndWait(conversationId?: string): Promise<number> {
    let count = 0;
    for (;;) {
      const entry = await this.turns.claimNext(this.workerId, conversationId);
      if (entry === null) return count;
      count += 1;
      await this.executor.execute(entry);
    }
  }
}
