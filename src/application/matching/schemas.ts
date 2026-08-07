import { z } from 'zod';
import { AMBIGUITY_TYPES, SEARCH_MODES } from '../../domain/models/demand';

/**
 * Paired Zod validators and JSON Schemas for the Capability Matching Engine.
 *
 * Hand-written for OpenAI strict structured outputs, as elsewhere: every property in `required`,
 * `additionalProperties: false` on every object.
 */

const confidence = z.number().min(0).max(1);

// ── Search mode classification + demand understanding ────────────────────────────────

/**
 * CME §20 (Search Mode Classification) and §6 (Demand Understanding) in one call.
 *
 * Combined because the mode is decided by the same reading of the sentence that extracts its
 * contents, and because this call sits directly in the buyer's turn — two round trips here is
 * two round trips a person is waiting through.
 */
export const demandSchema = z.object({
  mode: z.enum(SEARCH_MODES),
  products: z.array(z.string()),
  services: z.array(z.string()),
  businessTypes: z.array(z.string()),
  quantities: z.array(z.string()),
  modifiers: z.array(z.string()),
  constraints: z.array(z.string()),
  brands: z.array(z.string()),
  location: z.string(),
  ambiguityType: z.enum(AMBIGUITY_TYPES),
  ambiguityScore: confidence,
  ambiguityOptions: z.array(z.string()),
  /** For descriptive search: the item the description points at. */
  inferredItem: z.string(),
  inferredItemConfidence: confidence,
  reasoning: z.string(),
});

export type DemandOutput = z.infer<typeof demandSchema>;

const stringArray = { type: 'array', items: { type: 'string' } } as const;

export const demandJsonSchema = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      enum: [...SEARCH_MODES],
      description:
        'item = names the thing; descriptive = describes it without the name; business = names a trade; vibe = an occasion or outcome.',
    },
    products: { ...stringArray, description: 'Products named. Do not infer unnamed ones here.' },
    services: stringArray,
    businessTypes: { ...stringArray, description: 'Trades named, e.g. "hardware store", "mechanic".' },
    quantities: stringArray,
    modifiers: { ...stringArray, description: 'Only qualifiers the customer actually stated.' },
    constraints: { ...stringArray, description: 'Budget, delivery, urgency — only if stated.' },
    brands: stringArray,
    location: { type: 'string', description: 'Place mentioned, or empty string.' },
    ambiguityType: { type: 'string', enum: [...AMBIGUITY_TYPES] },
    ambiguityScore: { type: 'number' },
    ambiguityOptions: {
      ...stringArray,
      description: 'The distinct readings, only when they lead to genuinely different shops.',
    },
    inferredItem: {
      type: 'string',
      description: 'For descriptive search only: the concrete item meant. Empty otherwise.',
    },
    inferredItemConfidence: { type: 'number' },
    reasoning: { type: 'string' },
  },
  required: [
    'mode',
    'products',
    'services',
    'businessTypes',
    'quantities',
    'modifiers',
    'constraints',
    'brands',
    'location',
    'ambiguityType',
    'ambiguityScore',
    'ambiguityOptions',
    'inferredItem',
    'inferredItemConfidence',
    'reasoning',
  ],
  additionalProperties: false,
} as const;

// ── Semantic expansion: the three graphs ─────────────────────────────────────────────

/** CME §8 — Mission, Capability and Inventory Affinity graphs. */
export const expansionSchema = z.object({
  missions: z.array(z.string()),
  capabilities: z.array(z.object({ name: z.string().min(1), confidence })),
  inventoryAffinities: z.array(z.object({ name: z.string().min(1), confidence })),
  inferredProducts: z.array(z.string()),
  reasoning: z.string(),
});

export type ExpansionOutput = z.infer<typeof expansionSchema>;

const namedConfidenceArray = {
  type: 'array',
  items: {
    type: 'object',
    properties: { name: { type: 'string' }, confidence: { type: 'number' } },
    required: ['name', 'confidence'],
    additionalProperties: false,
  },
} as const;

export const expansionJsonSchema = {
  type: 'object',
  properties: {
    missions: { ...stringArray, description: 'What the customer is trying to accomplish.' },
    capabilities: {
      ...namedConfidenceArray,
      description: 'Business capabilities that normally satisfy this demand.',
    },
    inventoryAffinities: {
      ...namedConfidenceArray,
      description: 'Business types that plausibly stock it even though it is not their specialty.',
    },
    inferredProducts: {
      ...stringArray,
      description: 'Concrete products implied, for vibe or mission-style searches.',
    },
    reasoning: { type: 'string' },
  },
  required: ['missions', 'capabilities', 'inventoryAffinities', 'inferredProducts', 'reasoning'],
  additionalProperties: false,
} as const;
