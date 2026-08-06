/**
 * Outputs of the three understanding stages: continuity, intent, semantics.
 *
 * These stages are strictly separated (MCOS §5.4, §5.6, §5.7). Continuity answers
 * "how does this message relate to what came before?", intent answers "what does the user
 * want?", and semantic resolution answers "what does that mean in marketplace terms?".
 * Collapsing them is what produces chatbots that lose the thread.
 */

export const CONVERSATION_RELATIONSHIPS = [
  'continuation',
  'clarification',
  'answer',
  'correction',
  'topic_shift',
  'resume',
  'cancel',
  'restart',
  'new',
] as const;

export type ConversationRelationshipKind = (typeof CONVERSATION_RELATIONSHIPS)[number];

/**
 * Continuity analysis result (MCOS §5.4).
 *
 * Explicitly *not* intent classification: a message can be a `correction` regardless of
 * whether the user is buying or onboarding.
 */
export interface ConversationRelationship {
  readonly relationship: ConversationRelationshipKind;
  readonly confidence: number;
  /** Workflows this message might belong to, best first. */
  readonly candidateWorkflowIds: readonly string[];
  /** Human-readable justification, surfaced in stage logs for debuggability. */
  readonly reasoning?: string;
}

/** Intent resolution result (MCOS §5.6). Carries no taxonomy or GS1 concepts. */
export interface IntentResult {
  readonly intent: string;
  readonly confidence: number;
  readonly entities: Readonly<Record<string, string | readonly string[]>>;
  readonly language: string;
  /** Set when the user issued an explicit command such as "cancel" or "start over". */
  readonly command?: string;
}

/** A product resolved to marketplace vocabulary. */
export interface ResolvedProduct {
  readonly raw: string;
  readonly normalized: string;
  readonly aliases: readonly string[];
}

/** A GS1 GPC taxonomy node reference. */
export interface TaxonomyCategory {
  readonly name: string;
  /** GPC brick/class code, e.g. `10000045`. Absent until the taxonomy is seeded. */
  readonly gpc?: string;
}

/**
 * Semantic resolution result (MCOS §5.7).
 *
 * `ambiguity` here is a signal, not a verdict — the Ambiguity Manager in the CME decides
 * whether it is worth spending a clarification question on (CME §7).
 */
export interface SemanticRequest {
  readonly intent: string;
  readonly products: readonly ResolvedProduct[];
  readonly services: readonly ResolvedProduct[];
  readonly category?: TaxonomyCategory;
  readonly ambiguity: boolean;
  readonly ambiguityScore: number;
  readonly modifiers: readonly string[];
  readonly constraints: readonly string[];
  readonly brands: readonly string[];
}

export const UNKNOWN_INTENT = 'unknown';

export const NEW_CONVERSATION_RELATIONSHIP: ConversationRelationship = {
  relationship: 'new',
  confidence: 1,
  candidateWorkflowIds: [],
  reasoning: 'No active, suspended or pending workflow exists for this conversation.',
};

/**
 * Relationships that mean "keep working on an existing workflow" rather than
 * "start something new". Used by the Workflow Manager to pick a lifecycle action.
 */
const CONTINUING_RELATIONSHIPS: readonly ConversationRelationshipKind[] = [
  'continuation',
  'clarification',
  'answer',
  'correction',
  'resume',
];

export function isContinuing(relationship: ConversationRelationshipKind): boolean {
  return CONTINUING_RELATIONSHIPS.includes(relationship);
}
