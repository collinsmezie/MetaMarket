import type { IntentType } from './intent-taxonomy';

/**
 * IDCE canonical model (IDCE TDR v1.6 §18) — camelCase internal types. The wire format is
 * snake_case JSON validated against `idce-resolution-1.0.json`; conversion happens once at the
 * service boundary (§18.3 rules 5–6).
 */

export type IntentResolutionStatus =
  'RESOLVED' | 'PARTIAL' | 'AMBIGUOUS' | 'CONFLICTING' | 'INCOMPLETE' | 'UNSUPPORTED';

export type IntentRole = 'PRIMARY' | 'SECONDARY' | 'SUPPORTING' | 'DEPENDENT';

export type IntentStatus = 'RESOLVED' | 'AMBIGUOUS' | 'INCOMPLETE' | 'CONFLICTING' | 'UNSUPPORTED';

export type IntentScopeType =
  | 'OBJECT'
  | 'OBJECT_SET'
  | 'CONVERSATION'
  | 'ACCOUNT'
  | 'VENDOR'
  | 'LOCATION'
  | 'VENUE'
  | 'WORKFLOW'
  | 'TRANSACTION'
  | 'MESSAGE'
  | 'SYSTEM';

export interface IntentScope {
  readonly type: IntentScopeType;
  readonly objectIds: readonly string[];
  readonly workflowIds: readonly string[];
  readonly conversationScope: boolean;
}

export interface IntentEvidence {
  readonly explicit: boolean;
  readonly implicit: boolean;
  readonly contextUsed: boolean;
  readonly signals: readonly string[];
}

export interface IntentConstraint {
  readonly type: string;
  readonly value: unknown;
  readonly polarity: 'POSITIVE' | 'NEGATIVE';
  readonly sourceSpan: string;
}

export interface DiscoveredIntent {
  readonly intentId: string;
  /** A taxonomy member; unsupported labels are rejected by the invariants (§22.5). */
  readonly type: IntentType;
  readonly role: IntentRole;
  readonly status: IntentStatus;
  readonly confidence: number;
  readonly explicitness: 'EXPLICIT' | 'IMPLICIT' | 'CONTEXTUAL';
  readonly priority: number;
  readonly scope: IntentScope;
  readonly evidence: IntentEvidence;
  readonly dependencies: readonly string[];
  readonly relatedIntents: readonly string[];
  readonly constraints: readonly IntentConstraint[];
  readonly sourceSpans: readonly string[];
  /** Advisory only; LangGraph owns routing (§22.4 rule 5). */
  readonly routingHints: readonly string[];
}

export type IntentRelationType =
  | 'DEPENDS_ON'
  | 'REQUIRES'
  | 'PRECEDES'
  | 'SUPPORTS'
  | 'REFINES'
  | 'CONTRADICTS'
  | 'ALTERNATIVE_TO'
  | 'CORRECTS'
  | 'CANCELS'
  | 'SUPERSEDES';

export interface IntentRelation {
  readonly from: string;
  readonly type: IntentRelationType;
  readonly to: string;
}

export interface ClarificationRecommendation {
  readonly required: boolean;
  readonly reason:
    | 'INTENT_SCOPE_AMBIGUITY'
    | 'MISSING_REQUIRED_INFORMATION'
    | 'CONFLICTING_OBJECTIVE'
    | 'UNRESOLVED_REFERENCE'
    | 'UNRESOLVED_CONTEXT'
    | 'OTHER';
  readonly targetIntentIds: readonly string[];
  readonly question: string | null;
  readonly blocking: boolean;
  readonly expectedResolution: string | null;
}

export interface UnresolvedIntentIssue {
  readonly issueId: string;
  readonly type: string;
  readonly status: 'AMBIGUOUS' | 'INCOMPLETE' | 'CONFLICTING' | 'UNRESOLVED';
  readonly description: string;
  readonly relatedIntentIds: readonly string[];
  readonly sourceSpans: readonly string[];
}

export interface ContextUseRecord {
  readonly conversationHistory: boolean;
  readonly activeWorkflows: boolean;
  readonly semanticObjects: boolean;
  readonly location: boolean;
  readonly venue: boolean;
}

export interface ResolutionModelMetadata {
  readonly promptVersion: string;
  readonly schemaVersion: string;
}

export interface IDCEResolution {
  readonly resolutionStatus: IntentResolutionStatus;
  readonly intents: readonly DiscoveredIntent[];
  readonly relations: readonly IntentRelation[];
  readonly clarification: ClarificationRecommendation | null;
  readonly unresolved: readonly UnresolvedIntentIssue[];
  readonly contextUsed: ContextUseRecord;
  readonly modelMetadata: ResolutionModelMetadata;
}

// ── Input contracts (IDCE §2.3, §9) ─────────────────────────────────────────────────────────

export interface TurnMessageInput {
  readonly messageId: string;
  readonly text: string;
  readonly receivedAt: string;
  readonly interactivePayload: string | null;
}

export interface ConversationMessageContext {
  readonly role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  readonly text: string;
  readonly createdAt: string;
}

export interface ActiveWorkflowContext {
  readonly workflowId: string;
  readonly workflowType: string;
  readonly status: string;
  readonly summary: string;
  readonly resumable: boolean;
}

export interface SemanticObjectContext {
  readonly objectId: string;
  readonly canonicalForm: string;
  readonly entityType: string;
  readonly marketConceptId: string | null;
}

export interface IntentContextRecord {
  readonly turnId: string;
  readonly intentId: string;
  readonly type: string;
  readonly status: string;
  readonly objectIds: readonly string[];
}

export interface LocationContextInput {
  readonly value: string;
  readonly normalizedValue: string | null;
  readonly confidence: number;
}

export interface VenueContextInput {
  readonly value: string;
  readonly venueType: string | null;
  readonly confidence: number;
}

export interface InteractionMetadata {
  readonly channel: string;
  readonly assemblyReason: string;
  readonly messageCount: number;
}

/** Bounded context package IDCE consumes (§9). LangGraph owns the selection; IDCE consumes it. */
export interface IntentContext {
  readonly conversationId: string;
  readonly turnId: string;
  readonly userId: string;
  readonly channel: 'WHATSAPP' | 'WEB' | 'SMS' | 'USSD' | 'OTHER';
  readonly recentMessages: readonly ConversationMessageContext[];
  readonly activeWorkflows: readonly ActiveWorkflowContext[];
  readonly suspendedWorkflows: readonly ActiveWorkflowContext[];
  readonly semanticObjects: readonly SemanticObjectContext[];
  readonly priorIntentState: readonly IntentContextRecord[];
  readonly locationContext: LocationContextInput | null;
  readonly venueContext: VenueContextInput | null;
  readonly userRole: 'BUYER' | 'VENDOR' | 'UNKNOWN';
  readonly interactionMetadata: InteractionMetadata;
}

export interface PreviousTurnSummaryInput {
  readonly turnId: string;
  readonly outcome: string;
  readonly intentTypes: readonly string[];
  readonly objectIds: readonly string[];
  readonly workflowIds: readonly string[];
  readonly summary: string;
}

/** The logical-turn input unit (§2.3). */
export interface LogicalTurnInput {
  readonly conversationId: string;
  readonly turnId: string;
  readonly messageIds: readonly string[];
  readonly currentMessages: readonly TurnMessageInput[];
  readonly assembledText: string;
  readonly assemblyReason:
    'SINGLE_MESSAGE' | 'COALESCED_MESSAGES' | 'CONTINUATION_WINDOW' | 'EXPLICIT_USER_BATCH';
  readonly previousTurnSummary: PreviousTurnSummaryInput | null;
  readonly contextSnapshot: IntentContext;
}

// ── Service envelope (IDCE §22, §29A) ────────────────────────────────────────────────────────

export interface IDCEServiceRequest {
  readonly schemaVersion: '1.1';
  readonly requestId: string;
  readonly component: 'IDCE';
  readonly componentVersion: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly logicalTurn: LogicalTurnInput;
  readonly policyVersion: string;
  /** Orchestration-side revision of the understanding attempt; part of the idempotency key (§21). */
  readonly understandingRevision?: number;
}

export interface IDCEServiceError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface IDCEServiceResponse {
  readonly schemaVersion: '1.1';
  readonly requestId: string;
  readonly component: 'IDCE';
  readonly componentVersion: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly status: 'SUCCESS' | 'PARTIAL' | 'ERROR';
  readonly resolution: IDCEResolution | null;
  readonly error: IDCEServiceError | null;
}

export type IDCEInvocationStatus = 'SUCCESS' | 'TEMPORARY_FAILURE' | 'SCHEMA_FAILURE' | 'POLICY_FAILURE';

export const IDCE_POLICY_VERSION = 'idce-policy-1.0';
export const IDCE_OUTPUT_SCHEMA_ID = 'https://metamarket.local/schemas/idce-resolution-1.0.json';
export const IDCE_REQUEST_SCHEMA_ID = 'https://metamarket.local/schemas/idce-service-request-v1.1.json';
export const IDCE_RESPONSE_SCHEMA_ID = 'https://metamarket.local/schemas/idce-service-response-v1.1.json';
export const IDCE_PROMPT_ID = 'idce.master.discover';
export const IDCE_PROMPT_VERSION = '1.6.1';

export function idceIdempotencyKey(
  conversationId: string,
  turnId: string,
  understandingRevision: number,
): string {
  return `idce:${conversationId}:${turnId}:${understandingRevision}`;
}
