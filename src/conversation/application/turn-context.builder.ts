import { Inject, Injectable } from '@nestjs/common';
import { ConversationContextManager } from '../../application/conversation/conversation-context.manager';
import type { ConversationContext, HistoryEntry } from '../../domain/models/conversation';
import type { WorkflowInstance } from '../../domain/models/workflow-instance';
import { canResume } from '../../domain/models/workflow-instance';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import {
  VENDOR_REPOSITORY,
  type VendorRepositoryPort,
} from '../../domain/ports/outbound/vendor-repository.port';
import type { LogicalTurn } from '../domain/logical-turn';
import type { PendingClarification } from '../domain/pending-clarification';
import {
  CONTEXT_BOUNDS,
  CONTEXT_SNAPSHOT_VERSION,
  type ConversationWorkingContext,
  type ContextMessage,
  type LocationContext,
  type SemanticObjectReference,
  type TurnContextSnapshot,
  type WorkflowContext,
} from '../domain/turn-context';
import {
  LOGICAL_TURN_REPOSITORY,
  type LogicalTurnRepositoryPort,
} from '../ports/logical-turn.repository.port';
import {
  TURN_CONTEXT_REPOSITORY,
  type TurnContextRepositoryPort,
} from '../ports/turn-context.repository.port';
import {
  SEMANTIC_RESOLUTION_REPOSITORY,
  type PersistedSemanticObject,
  type SemanticResolutionRepositoryPort,
} from '../../semantics/ports/semantic-resolution.repository.port';

/**
 * Builds the bounded working context for one logical turn and persists it as a snapshot
 * (MCOS TDR §63.1 `ConversationWorkingContext`; Overarching §18.8 context snapshots, §41).
 *
 * Context is a projection of durable records — history, workflow registry, memory facts, the
 * previous turn's summary, the pending clarification, the semantic objects CSRE resolved on
 * earlier turns — never LangGraph state and never reconstructed from raw text.
 */
@Injectable()
export class TurnContextBuilder {
  constructor(
    @Inject(LOGICAL_TURN_REPOSITORY) private readonly turns: LogicalTurnRepositoryPort,
    @Inject(TURN_CONTEXT_REPOSITORY) private readonly snapshots: TurnContextRepositoryPort,
    @Inject(SEMANTIC_RESOLUTION_REPOSITORY) private readonly semantics: SemanticResolutionRepositoryPort,
    @Inject(VENDOR_REPOSITORY) private readonly vendors: VendorRepositoryPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly conversations: ConversationContextManager,
  ) {}

  async build(
    turn: LogicalTurn,
    pendingClarification: PendingClarification | null,
  ): Promise<{ snapshot: TurnContextSnapshot; conversation: ConversationContext }> {
    const conversation = await this.conversations.loadById(turn.conversationId);
    if (conversation === null) {
      throw new Error(`Conversation ${turn.conversationId} not found while building turn context`);
    }

    const now = this.clock.now();
    const instances = conversation.conversation.workflowRegistry.workflowInstances;
    const active = instances
      .filter((instance) => instance.status === 'active')
      .slice(0, CONTEXT_BOUNDS.workflows);
    const suspended = instances
      .filter((instance) => instance.status === 'suspended')
      .slice(0, CONTEXT_BOUNDS.workflows);

    const [previousTurnSummary, vendor, semanticObjects] = await Promise.all([
      this.turns.latestSummaryBefore(turn.conversationId, turn.firstMessageAt),
      this.vendors.findByUserId(conversation.conversation.userId),
      this.semantics.recentObjects(turn.conversationId, turn.turnId, CONTEXT_BOUNDS.semanticObjects),
    ]);

    const context: ConversationWorkingContext = {
      previousTurnSummary,
      activeWorkflows: active.map((instance) => toWorkflowContext(instance, now)),
      suspendedWorkflows: suspended.map((instance) => toWorkflowContext(instance, now)),
      recentMessages: conversation.recentHistory.slice(-CONTEXT_BOUNDS.recentMessages).map(toContextMessage),
      semanticObjects: semanticObjects.map(toSemanticObjectReference),
      locations: locationsFrom(conversation.conversation.memory.facts).slice(0, CONTEXT_BOUNDS.locations),
      venues: [],
      pendingClarification,
      userRole:
        vendor !== null
          ? 'VENDOR'
          : instances.some((i) => i.workflowType === 'buyer_search')
            ? 'BUYER'
            : 'UNKNOWN',
      vendorId: vendor?.id ?? null,
    };

    const snapshot: TurnContextSnapshot = {
      snapshotId: this.ids.uuid(),
      conversationId: turn.conversationId,
      turnId: turn.turnId,
      version: CONTEXT_SNAPSHOT_VERSION,
      context,
      createdAt: now,
    };

    await this.snapshots.save(snapshot);
    return { snapshot, conversation };
  }
}

function toWorkflowContext(instance: WorkflowInstance, now: Date): WorkflowContext {
  return {
    workflowId: instance.id,
    workflowType: instance.workflowType,
    status: instance.status,
    // The engine has no explicit state version yet; the update instant is monotonic per instance.
    stateVersion: Math.floor(instance.updatedAt.getTime() / 1000),
    resumable: canResume(instance, now),
    summary: instance.summary.slice(0, 240),
  };
}

function toContextMessage(entry: HistoryEntry): ContextMessage {
  return {
    messageId: entry.id,
    turnId: null,
    text: entry.content,
    role: entry.role === 'user' ? 'USER' : entry.role === 'assistant' ? 'ASSISTANT' : 'SYSTEM',
    createdAt: entry.timestamp.toISOString(),
  };
}

function locationsFrom(
  facts: Readonly<Record<string, { value: unknown; confidence: number }>>,
): LocationContext[] {
  const locations: LocationContext[] = [];
  for (const key of ['location.city', 'location.state']) {
    const fact = facts[key];
    if (fact !== undefined && typeof fact.value === 'string' && fact.value.trim().length > 0) {
      locations.push({ value: fact.value, normalizedValue: fact.value.trim(), confidence: fact.confidence });
    }
  }
  return locations;
}

/**
 * MCOS §63.1 binding. CSRE's `object_id` (`object_1`, …) is stable only within one resolution
 * request (CSRE §29.3 rule 5), so across turns the reference carries the durable semantic-object
 * id; the request-local id stays inside the verbatim semantic-origin record's request lineage.
 */
function toSemanticObjectReference(object: PersistedSemanticObject): SemanticObjectReference {
  return {
    objectId: object.id,
    canonicalForm: object.canonicalForm,
    entityType: object.entityType,
    semanticOrigin: object.semanticOrigin,
  };
}
