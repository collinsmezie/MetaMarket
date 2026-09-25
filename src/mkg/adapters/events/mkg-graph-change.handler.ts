import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CorrelatedDomainEvent,
  type EventHandler,
  PlatformEvents,
} from '../../../platform/events/domain-event';
import type { GraphChangeCommand } from '../../domain/mkg-models';
import { MKG_WRITE_PORT, type MkgWritePort } from '../../ports/mkg-write.port';

interface GraphChangeDecidedPayload {
  readonly decisionId: string;
  readonly assertionId?: string;
  readonly operation: 'ADD' | 'REINFORCE' | 'DECAY' | 'DEACTIVATE' | 'PRUNE' | 'REJECT';
  readonly relevanceDecision?: string;
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string;
  readonly beliefScore?: number;
  readonly reasonCodes?: readonly string[];
  readonly evidenceIds?: readonly string[];
  readonly policyVersion?: string;
}

/**
 * Consumes `PlatformEvents.GraphChangeDecided` from the transactional outbox worker (MKG TDR §12, §23).
 * Bridges Evidence System decisions into the Market Knowledge Graph with guaranteed idempotency and auditability.
 */
@Injectable()
export class MkgGraphChangeHandler implements EventHandler {
  readonly name = 'mkg.graph-change';
  readonly eventTypes = [PlatformEvents.GraphChangeDecided] as const;
  private readonly logger = new Logger(MkgGraphChangeHandler.name);

  constructor(@Inject(MKG_WRITE_PORT) private readonly mkgWrite: MkgWritePort) {}

  async handle(event: CorrelatedDomainEvent): Promise<void> {
    if (event.eventType !== PlatformEvents.GraphChangeDecided) {
      return;
    }

    const payload = event.payload as unknown as GraphChangeDecidedPayload;
    if (!payload?.decisionId || !payload?.subjectId || !payload?.predicate || !payload?.objectId) {
      this.logger.warn(
        `[handle] Invalid GraphChangeDecided event payload: missing required fields in ${JSON.stringify(payload)}`,
      );
      return;
    }

    const command: GraphChangeCommand = {
      decisionId: payload.decisionId,
      operation: payload.operation ?? 'ADD',
      subjectId: payload.subjectId,
      predicate: payload.predicate,
      objectId: payload.objectId,
      beliefScore: payload.beliefScore,
      evidenceIds: payload.evidenceIds ?? [],
      policyVersion: payload.policyVersion ?? '1.0',
      correlationId: event.correlationId ?? undefined,
      occurredAt: (event.timestamp ?? new Date()).toISOString(),
    };

    try {
      const result = await this.mkgWrite.applyGraphChange(command);
      this.logger.log(
        `[handle] Processed GraphChangeDecided for ${command.decisionId}: ${result.operation} -> ${result.newState} (success=${result.success})`,
      );
    } catch (err) {
      this.logger.error(
        `[handle] Failed to process GraphChangeDecided for ${command.decisionId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err; // Outbox will retry safely
    }
  }
}
