import type { AssemblyReason, ConversationTurnSummary } from './logical-turn';
import type { PendingClarification } from './pending-clarification';

/**
 * Canonical turn envelope and bounded working context (MCOS TDR §63.1; Overarching §18.8, §41).
 *
 * These are the contracts MCOS hands to the orchestrator for one logical turn. Everything here is
 * reconstructible from durable records; nothing here is business truth.
 */

export interface TurnCurrentMessage {
  readonly messageId: string;
  readonly channel: string;
  readonly senderId: string;
  readonly text: string;
  readonly receivedAt: string;
  readonly providerEventId: string | null;
  readonly interactivePayload: string | null;
}

export interface TurnInputState {
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly messageIds: readonly string[];
  readonly currentMessages: readonly TurnCurrentMessage[];
  readonly assembledText: string;
  readonly assemblyReason: AssemblyReason;
  readonly previousTurnSummary: ConversationTurnSummary | null;
  readonly contextSnapshotId: string;
  readonly assembledAt: string;
  readonly channel: string;
  readonly userId: string;
}

export interface WorkflowContext {
  readonly workflowId: string;
  readonly workflowType: string;
  readonly status: string;
  readonly stateVersion: number;
  readonly resumable: boolean;
  readonly summary: string;
}

export interface ContextMessage {
  readonly messageId: string;
  readonly turnId: string | null;
  readonly text: string;
  readonly role: 'USER' | 'SYSTEM' | 'ASSISTANT';
  readonly createdAt: string;
}

/** Binding to CSRE's canonical semantic-origin record (MCOS §37, §63.1). */
export interface SemanticObjectReference {
  readonly objectId: string;
  readonly canonicalForm: string;
  readonly entityType: string;
  readonly semanticOrigin: {
    readonly phrase: string;
    readonly concept: string;
    readonly market_concept_id: string | null;
    readonly concept_status: 'KNOWN' | 'PROPOSED';
    readonly relationship: 'EXPRESSES';
    readonly origin: 'CSRE';
    readonly request_id: string;
    readonly semantic_confidence: number;
  };
}

export interface LocationContext {
  readonly value: string;
  readonly normalizedValue: string | null;
  readonly confidence: number;
}

export interface VenueContext {
  readonly value: string;
  readonly venueType: string | null;
  readonly confidence: number;
}

export interface ConversationWorkingContext {
  readonly previousTurnSummary: ConversationTurnSummary | null;
  readonly activeWorkflows: readonly WorkflowContext[];
  readonly suspendedWorkflows: readonly WorkflowContext[];
  readonly recentMessages: readonly ContextMessage[];
  readonly semanticObjects: readonly SemanticObjectReference[];
  readonly locations: readonly LocationContext[];
  readonly venues: readonly VenueContext[];
  readonly pendingClarification: PendingClarification | null;
  readonly userRole: 'BUYER' | 'VENDOR' | 'UNKNOWN';
  readonly vendorId: string | null;
}

/** Persisted bounded snapshot (Overarching §18.8) with its own identity and version. */
export interface TurnContextSnapshot {
  readonly snapshotId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly version: number;
  readonly context: ConversationWorkingContext;
  readonly createdAt: Date;
}

/** Bounds applied when building the snapshot, so LangGraph never receives unbounded history. */
export const CONTEXT_BOUNDS = {
  recentMessages: 20,
  workflows: 10,
  semanticObjects: 12,
  locations: 3,
  venues: 3,
} as const;

export const CONTEXT_SNAPSHOT_VERSION = 1;
