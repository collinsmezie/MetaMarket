import { Inject, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  ConversationEvents,
  EVENT_PUBLISHER,
  type EventPublisherPort,
} from '../../domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepositoryPort,
} from '../../domain/ports/outbound/workflow-repository.port';

const COMPONENT = 'MCOS';
const STAGE = 'WorkflowExpirySweeper';

const SWEEP_INTERVAL_MS = 60_000;

/** Bounded per sweep so a large backlog is drained gradually rather than in one spike. */
const BATCH_SIZE = 200;

/**
 * Archives workflows that have passed their expiry (Execution.md §2.5).
 *
 * Without this, an abandoned conversation keeps an active workflow forever: every later
 * message is read as continuing a search the user forgot about weeks ago, and the workflow
 * registry grows without bound.
 */
@Injectable()
export class WorkflowExpirySweeper {
  constructor(
    @Inject(WORKFLOW_REPOSITORY) private readonly workflows: WorkflowRepositoryPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    const now = this.clock.now();

    try {
      const expired = await this.workflows.findExpired(now, BATCH_SIZE);
      if (expired.length === 0) return;

      for (const instance of expired) {
        await this.workflows.update(
          instance.id,
          { status: 'archived' },
          {
            workflowId: instance.id,
            fromState: instance.currentState,
            toState: instance.currentState,
            trigger: 'expiry_sweep',
            at: now,
          },
        );

        await this.events.publish({
          eventId: this.ids.uuid(),
          eventType: ConversationEvents.WorkflowExpired,
          timestamp: now,
          producer: 'ConversationOS',
          conversationId: instance.conversationId,
          workflowId: instance.id,
          payload: {
            workflowType: instance.workflowType,
            state: instance.currentState,
            expiredAt: instance.expiresAt,
          },
        });
      }

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { now: now.toISOString(), batchSize: BATCH_SIZE },
        action: `Archived ${expired.length} expired workflow instance(s)`,
        output: { archived: expired.map((instance) => instance.id) },
      });
    } catch (error) {
      // A sweep failure is operational, not user-facing; log and try again next tick.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { now: now.toISOString() },
        action: 'Expiry sweep failed; will retry on the next interval',
        error,
      });
    }
  }
}
