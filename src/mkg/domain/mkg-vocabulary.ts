import { createHash } from 'node:crypto';

/**
 * MKG Predicate Vocabulary (MKG TDR v1.1 §6, §8, §9).
 * Versioned, typed commercial predicates. Never generic skos:related.
 */
export const MKG_PREDICATES = {
  // Lexical grounding (Nigerian market language)
  EXPRESSES: 'mkg:EXPRESSES',
  HAS_ALIAS: 'mkg:HAS_ALIAS',

  // Sovereign taxonomy anchoring
  MAPPED_TO_GPC: 'mkg:MAPPED_TO_GPC',

  // Actor / Capability
  SUPPLIES: 'mkg:SUPPLIES',
  OFFERS: 'mkg:OFFERS',
  IN_STOCK: 'mkg:IN_STOCK',
  OUT_OF_STOCK: 'mkg:OUT_OF_STOCK',
  REQUESTED: 'mkg:REQUESTED',
  SERVES: 'mkg:SERVES',
  LOCATED_IN: 'mkg:LOCATED_IN',

  // Commercial relationships between concepts
  ACCESSORY_OF: 'mkg:ACCESSORY_OF',
  COMPONENT_OF: 'mkg:COMPONENT_OF',
  SUBSTITUTE_FOR: 'mkg:SUBSTITUTE_FOR',
  COMMONLY_SOLD_WITH: 'mkg:COMMONLY_SOLD_WITH',
  USED_FOR: 'mkg:USED_FOR',
  RELATED_TO: 'mkg:RELATED_TO',

  // SKOS concept scheme primitives
  BROADER: 'skos:broader',
  NARROWER: 'skos:narrower',
  RELATED: 'skos:related',
} as const;

export type MkgPredicate = (typeof MKG_PREDICATES)[keyof typeof MKG_PREDICATES] | string;

/**
 * Predicate inverse mapping (MKG TDR §9).
 */
export const PREDICATE_INVERSES: Readonly<Record<string, string>> = {
  'mkg:ACCESSORY_OF': 'mkg:HAS_ACCESSORY',
  'mkg:HAS_ACCESSORY': 'mkg:ACCESSORY_OF',
  'mkg:COMPONENT_OF': 'mkg:HAS_COMPONENT',
  'mkg:HAS_COMPONENT': 'mkg:COMPONENT_OF',
  'mkg:SUPPLIES': 'mkg:SUPPLIED_BY',
  'mkg:SUPPLIED_BY': 'mkg:SUPPLIES',
  'skos:broader': 'skos:narrower',
  'skos:narrower': 'skos:broader',
  // Symmetric predicates
  'mkg:SUBSTITUTE_FOR': 'mkg:SUBSTITUTE_FOR',
  'mkg:COMMONLY_SOLD_WITH': 'mkg:COMMONLY_SOLD_WITH',
  'skos:related': 'skos:related',
  'mkg:RELATED_TO': 'mkg:RELATED_TO',
};

/**
 * Prior relevance weight by relationship type (MKG TDR §10, §33.6).
 * Distance alone is not meaning; explicit commercial edges carry higher priors.
 */
export const PREDICATE_PRIOR_WEIGHTS: Readonly<Record<string, number>> = {
  'mkg:EXPRESSES': 0.95,
  'mkg:HAS_ALIAS': 0.95,
  'mkg:SUPPLIES': 0.95,
  'mkg:MAPPED_TO_GPC': 0.90,
  'mkg:ACCESSORY_OF': 0.85,
  'mkg:SUBSTITUTE_FOR': 0.80,
  'mkg:COMPONENT_OF': 0.80,
  'mkg:COMMONLY_SOLD_WITH': 0.70,
  'mkg:USED_FOR': 0.65,
  'skos:narrower': 0.60,
  'skos:broader': 0.55,
  'skos:related': 0.40,
  'mkg:RELATED_TO': 0.35,
};

/**
 * Canonical idempotency key formula (MKG TDR §23):
 * hash(decisionId + operation + subject + predicate + object)
 */
export function computeMkgIdempotencyKey(
  decisionId: string,
  operation: string,
  subjectId: string,
  predicate: string,
  objectId: string,
): string {
  return createHash('sha256')
    .update(`${decisionId}:${operation}:${subjectId}:${predicate}:${objectId}`)
    .digest('hex');
}
