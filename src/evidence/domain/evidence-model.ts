/**
 * Evidence System canonical model (Evidence TDR v4.4 §2, §9, §10, §13, §15, §20, §47.10,
 * §50.3, §52.2, §53.2, §54.1–§54.2; MKG TDR §6, §11, §12).
 *
 * Four layers, never collapsed: Observation → Evidence → Knowledge → Belief → GraphChangeDecision.
 * Observations and evidence are immutable; beliefs and knowledge are recomputed from history.
 */

export const EVIDENCE_COMPONENT = 'EVIDENCE';
export const EVIDENCE_WIRE_SCHEMA_VERSION = '4.0';
export const EVIDENCE_POLICY_VERSION = 'evidence-policy-1.0';
export const EVIDENCE_INTERPRET_PROMPT_ID = 'evidence.interpret';
export const EVIDENCE_INTERPRET_PROMPT_VERSION = '4.4.0';

export const EVIDENCE_OBSERVATION_SCHEMA_ID = 'https://metamarket.local/schemas/evidence-observation-v4.json';
export const EVIDENCE_REQUEST_SCHEMA_ID = 'https://metamarket.local/schemas/evidence-request-v4.json';
export const EVIDENCE_RESPONSE_SCHEMA_ID = 'https://metamarket.local/schemas/evidence-response-v4.json';
export const EVIDENCE_INTERPRETATION_SCHEMA_ID =
  'https://metamarket.local/schemas/evidence-interpretation-v4.json';
export const EVIDENCE_FUSION_SCHEMA_ID = 'https://metamarket.local/schemas/evidence-fusion-v4.json';
export const GRAPH_RELEVANCE_SCHEMA_ID = 'https://metamarket.local/schemas/graph-relevance-v4.json';
export const KNOWLEDGE_EXTRACTION_SCHEMA_ID = 'https://metamarket.local/schemas/knowledge-extraction-v4.json';

/** §9 + final lock Q4: the only polarity states. `MIXED`/`UNKNOWN` are stale aliases. */
export const POLARITIES = ['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'CONTRADICTORY'] as const;
export type Polarity = (typeof POLARITIES)[number];

export function normalizePolarity(value: unknown): Polarity {
  const text = String(value ?? '').toUpperCase();
  if (text === 'MIXED') return 'CONTRADICTORY';
  if (text === 'UNKNOWN') return 'NEUTRAL';
  return POLARITIES.includes(text as Polarity) ? (text as Polarity) : 'NEUTRAL';
}

export const OBSERVATION_TYPES = [
  'CSRE_SEMANTIC_RESOLUTION',
  'GPC_MAPPING',
  'WRS_EXTERNAL_EVIDENCE',
  'ENRICHMENT_INSIGHT',
  'BUYER_REQUEST',
  'BUYER_CLARIFICATION',
  'BUYER_CONFIRMATION',
  'VENDOR_STATEMENT',
  'VENDOR_INVENTORY_UPDATE',
  'VENDOR_RESPONSE',
  'VENDOR_CLARIFICATION',
  'VENDOR_CONFIRMATION',
  'VENDOR_REJECTION',
  'FULFILLMENT_COMPLETED',
  'OTHER',
] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export type ActorRole = 'BUYER' | 'VENDOR' | 'SYSTEM' | 'UNKNOWN';
export type EvidenceKind = 'DIRECT' | 'INFERRED' | 'CONTEXTUAL';

/** MKG TDR §6 core predicates (the `mkg:` vocabulary, version 1.0). */
export const MKG_PREDICATES = [
  'mkg:EXPRESSES',
  'mkg:MAPPED_TO_GPC',
  'mkg:REQUESTED',
  'mkg:SUPPLIES',
  'mkg:OFFERS',
  'mkg:IN_STOCK',
  'mkg:OUT_OF_STOCK',
  'mkg:USED_FOR',
  'mkg:ACCESSORY_OF',
  'mkg:COMPONENT_OF',
  'mkg:SUBSTITUTE_FOR',
  'mkg:COMMONLY_SOLD_WITH',
  'mkg:RELATED_TO',
  'mkg:SERVES',
  'mkg:LOCATED_IN',
  'mkg:HAS_ALIAS',
] as const;
export type MkgPredicate = (typeof MKG_PREDICATES)[number];
export const MKG_VOCABULARY_VERSION = '1.0';

/** Predicates whose subject must be an actor (vendor/buyer); buyer demand can never be SUPPLIES (§53.4). */
export const ACTOR_PREDICATES: ReadonlySet<string> = new Set([
  'mkg:SUPPLIES',
  'mkg:OFFERS',
  'mkg:IN_STOCK',
  'mkg:OUT_OF_STOCK',
  'mkg:REQUESTED',
  'mkg:SERVES',
]);
export const VENDOR_ONLY_PREDICATES: ReadonlySet<string> = new Set([
  'mkg:SUPPLIES',
  'mkg:OFFERS',
  'mkg:IN_STOCK',
  'mkg:OUT_OF_STOCK',
]);

export type NodeType =
  'ACTOR' | 'PHRASE' | 'MARKET_CONCEPT' | 'GPC_NODE' | 'CONTEXT' | 'VENUE' | 'LOCATION' | 'OTHER';

export interface Assertion {
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
}

export interface Provenance {
  readonly sourceType: string;
  readonly sourceId: string | null;
  readonly sourceUrl: string | null;
  readonly component: string;
  readonly componentVersion: string;
  readonly requestId: string | null;
  readonly turnId: string | null;
  readonly actorId: string | null;
  readonly actorRole: ActorRole | null;
  readonly channel: string | null;
  readonly workflowId: string | null;
  readonly interactionId: string | null;
  readonly directness: EvidenceKind;
  readonly quote: string | null;
  /** Upstream identifiers preserved exactly (§52.1, §52.3, §52.4). */
  readonly upstream: Readonly<Record<string, unknown>>;
}

/** §52.2 normalised evidence record (polarity per the Q4 lock) plus §13 provenance and §47.10 labels. */
export interface NormalizedEvidence {
  readonly evidenceId: string;
  readonly observationId: string;
  readonly assertion: Assertion;
  readonly assertionId: string;
  readonly subjectType: NodeType;
  readonly objectType: NodeType;
  readonly subjectLabel: string;
  readonly objectLabel: string;
  readonly polarity: Polarity;
  readonly strength: number;
  readonly kind: EvidenceKind;
  readonly claim: string;
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
  readonly provenance: Provenance;
  readonly independenceKey: string;
  readonly observedAt: Date;
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
  readonly context: AssertionContext;
  /** The upstream item this evidence normalises (WRS item, semantic_origin, mapping …), verbatim. */
  readonly sourcePayload: Readonly<Record<string, unknown>>;
}

export interface AssertionContext {
  readonly country: string | null;
  readonly region: string | null;
}

export interface ObservationInput {
  readonly observationId: string;
  readonly observationType: ObservationType;
  readonly source: { component: string; version: string; eventId: string | null; requestId: string | null };
  readonly actor: { id: string; role: ActorRole } | null;
  readonly channel: string | null;
  readonly interaction: {
    conversationId: string | null;
    turnId: string | null;
    runId: string | null;
    workflowId: string | null;
    actionId: string | null;
    interactionId: string | null;
  };
  readonly observedAt: Date;
  readonly context: AssertionContext & Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly rawText: string | null;
}

// ── Identity ──────────────────────────────────────────────────────────────────────────────────
//
// Until MKG mints durable graph identity (Phase 9) subjects/objects are typed, deterministic
// surrogate ids so the same phrase/concept/actor always addresses the same assertion.

export function normalizeLabel(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countryCode(context: { country?: string | null } | null | undefined): string {
  const raw = (context?.country ?? 'NG').trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toLowerCase();
  const named: Record<string, string> = { nigeria: 'ng', ghana: 'gh', kenya: 'ke', 'south africa': 'za' };
  return named[raw.toLowerCase()] ?? raw.toLowerCase().replace(/\s+/g, '-');
}

export const phraseId = (text: string, country: string): string =>
  `phrase:${country}:${normalizeLabel(text)}`;
export const conceptId = (marketConceptId: string | null | undefined, label: string): string =>
  marketConceptId !== null && marketConceptId !== undefined && marketConceptId.length > 0
    ? `concept:${marketConceptId}`
    : `concept:proposed:${normalizeLabel(label)}`;
export const gpcId = (code: string): string => `gpc:${code}`;
export const actorId = (role: ActorRole, id: string): string =>
  id.includes(':') ? id : `${role.toLowerCase()}:${id}`;
export const contextId = (label: string): string => `context:${normalizeLabel(label)}`;

export function nodeTypeOf(id: string): NodeType {
  const prefix = id.split(':')[0];
  switch (prefix) {
    case 'phrase':
      return 'PHRASE';
    case 'concept':
      return 'MARKET_CONCEPT';
    case 'gpc':
      return 'GPC_NODE';
    case 'vendor':
    case 'buyer':
    case 'actor':
    case 'system':
      return 'ACTOR';
    case 'context':
      return 'CONTEXT';
    case 'venue':
      return 'VENUE';
    case 'location':
      return 'LOCATION';
    default:
      return 'OTHER';
  }
}

/** FNV-1a 52-bit hash rendered as hex — dependency-free, stable across processes. */
export function stableHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x811c9dc5) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 16);
}

/** Relationship-first identity (§20, §47.10): `(subject, predicate, object)`; locality lives in phrase ids. */
export function assertionIdOf(assertion: Assertion): string {
  return `assertion:${stableHash(`${assertion.subject}|${assertion.predicate}|${assertion.object}`)}`;
}

export const evidenceIdOf = (observationId: string, index: number): string => `${observationId}#ev_${index}`;

export function knowledgeTypeFor(assertion: Assertion): string | null {
  switch (assertion.predicate) {
    case 'mkg:EXPRESSES':
    case 'mkg:HAS_ALIAS':
      return 'LOCAL_TERM_MAPPING';
    case 'mkg:MAPPED_TO_GPC':
      return 'TAXONOMY_ANCHOR';
    case 'mkg:SUPPLIES':
    case 'mkg:OFFERS':
    case 'mkg:IN_STOCK':
    case 'mkg:OUT_OF_STOCK':
      return 'VENDOR_CAPABILITY';
    case 'mkg:REQUESTED':
      return 'MARKET_DEMAND';
    case 'mkg:SERVES':
    case 'mkg:LOCATED_IN':
      return 'VENDOR_COVERAGE';
    default:
      return 'COMMERCIAL_RELATIONSHIP';
  }
}

// ── Belief / knowledge / graph decision states ────────────────────────────────────────────────

/** §54.2 knowledge promotion lifecycle (Evidence owns learning state; MKG owns graph state). */
export const KNOWLEDGE_STATES = ['CANDIDATE', 'SUPPORTED', 'ESTABLISHED', 'WEAKENING', 'INACTIVE'] as const;
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];

export const RELEVANCE_DECISIONS = [
  'EXPAND',
  'REINFORCE',
  'MAINTAIN',
  'DECAY',
  'PRUNE',
  'NO_CHANGE',
  'INVESTIGATE',
] as const;
export type RelevanceDecision = (typeof RELEVANCE_DECISIONS)[number];

export const GRAPH_OPERATIONS = ['ADD', 'REINFORCE', 'DECAY', 'DEACTIVATE', 'PRUNE', 'REJECT'] as const;
export type GraphOperation = (typeof GRAPH_OPERATIONS)[number];

export type BeliefDirection = 'INCREASING' | 'DECREASING' | 'STABLE' | 'UNCERTAIN';

/** §53.2 GraphChangeDecision — what Evidence hands to MKG (never a direct graph write). */
export interface GraphChangeDecision {
  readonly decisionId: string;
  readonly assertionId: string;
  readonly operation: GraphOperation;
  readonly relevanceDecision: RelevanceDecision;
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string;
  readonly beliefScore: number;
  readonly reasonCodes: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly policyVersion: string;
  readonly correlationId: string;
  readonly runId: string | null;
  readonly createdAt: Date;
}

export const round3 = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
