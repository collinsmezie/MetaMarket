import { z } from 'zod';
import { INFORMATION_DENSITIES } from '../../domain/models/capability';

/**
 * Paired Zod validators and JSON Schemas for the Capability Discovery Engine's LLM calls.
 *
 * Hand-written for the same reason as the understanding-stage schemas: OpenAI strict mode
 * requires every property in `required` and `additionalProperties: false` everywhere, which a
 * generic converter does not produce.
 */

const confidence = z.number().min(0).max(1);

// ── Business understanding + prototype generation ────────────────────────────────────

/**
 * One LLM call covering CDE Stages 2–4: Conversation Understanding, Market Language and
 * Semantic Compression.
 *
 * Combined deliberately. The three stages are conceptually distinct but need the same context
 * and would otherwise cost three round trips on the vendor's very first message — the moment
 * where latency is most visible and their patience is shortest (CDE Principle 3).
 */
export const businessUnderstandingSchema = z.object({
  expressionType: z.enum([
    'broad_capability_statement',
    'product_list',
    'service_description',
    'business_archetype',
    'brand_mention',
    'mixed',
    'uninformative',
  ]),
  informationDensity: z.enum(INFORMATION_DENSITIES),
  /** The market archetype this vendor most resembles, e.g. "general household goods shop". */
  businessArchetype: z.string(),
  archetypeConfidence: confidence,
  /** Products the vendor named or that the archetype strongly implies. */
  products: z.array(
    z.object({
      term: z.string().min(1),
      /** True when the vendor actually said it; false when the archetype implies it. */
      stated: z.boolean(),
      confidence,
    }),
  ),
  services: z.array(
    z.object({
      term: z.string().min(1),
      stated: z.boolean(),
      confidence,
    }),
  ),
  brands: z.array(z.string()),
  /** How ambiguous the statement is, and therefore whether clarification pays for itself. */
  ambiguityScore: confidence,
  /** The single highest-information-gain question, if one is worth asking. */
  clarificationQuestion: z.string(),
  reasoning: z.string(),
});

export type BusinessUnderstandingOutput = z.infer<typeof businessUnderstandingSchema>;

const termArraySchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      term: { type: 'string' },
      stated: {
        type: 'boolean',
        description: 'true if the vendor actually said it; false if the archetype implies it.',
      },
      confidence: { type: 'number' },
    },
    required: ['term', 'stated', 'confidence'],
    additionalProperties: false,
  },
} as const;

export const businessUnderstandingJsonSchema = {
  type: 'object',
  properties: {
    expressionType: {
      type: 'string',
      enum: [
        'broad_capability_statement',
        'product_list',
        'service_description',
        'business_archetype',
        'brand_mention',
        'mixed',
        'uninformative',
      ],
    },
    informationDensity: { type: 'string', enum: [...INFORMATION_DENSITIES] },
    businessArchetype: {
      type: 'string',
      description: 'The market archetype, e.g. "general household goods shop", "building materials dealer".',
    },
    archetypeConfidence: { type: 'number' },
    products: termArraySchema,
    services: termArraySchema,
    brands: { type: 'array', items: { type: 'string' } },
    ambiguityScore: { type: 'number' },
    clarificationQuestion: {
      type: 'string',
      description:
        'One question that would most reduce uncertainty, or an empty string if none is worth asking.',
    },
    reasoning: { type: 'string' },
  },
  required: [
    'expressionType',
    'informationDensity',
    'businessArchetype',
    'archetypeConfidence',
    'products',
    'services',
    'brands',
    'ambiguityScore',
    'clarificationQuestion',
    'reasoning',
  ],
  additionalProperties: false,
} as const;

// ── Candidate ranking (Capability Resolver) ──────────────────────────────────────────

/**
 * Ranking of retrieved GPC candidates.
 *
 * The model chooses *from* the supplied candidates and never names a capability, which is the
 * resolver's core guarantee: "The Commercial Intelligence Engine SHALL NOT allow Large
 * Language Models to generate canonical capability names."
 */
export const capabilityRankingSchema = z.object({
  selections: z.array(
    z.object({
      /** Must be one of the candidate codes supplied in the prompt. */
      code: z.string().min(1),
      confidence,
      reasoning: z.string(),
    }),
  ),
});

export type CapabilityRankingOutput = z.infer<typeof capabilityRankingSchema>;

export const capabilityRankingJsonSchema = {
  type: 'object',
  properties: {
    selections: {
      type: 'array',
      description: 'Candidates that genuinely fit, best first. Return an empty array if none do.',
      items: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The exact code of one supplied candidate. Never invent a code.',
          },
          confidence: { type: 'number' },
          reasoning: { type: 'string' },
        },
        required: ['code', 'confidence', 'reasoning'],
        additionalProperties: false,
      },
    },
  },
  required: ['selections'],
  additionalProperties: false,
} as const;

// ── Service capability reasoning ─────────────────────────────────────────────────────

/**
 * Service capabilities inferred from a service description (CDE Test Case 3).
 *
 * "I repair generators" implies diagnostics, maintenance, parts replacement and electrical
 * repair at decreasing confidence — capabilities the vendor never stated but that a matcher
 * should still surface them for.
 */
export const serviceCapabilitySchema = z.object({
  primary: z.object({
    canonicalName: z.string().min(1),
    description: z.string(),
    confidence,
  }),
  related: z.array(
    z.object({
      canonicalName: z.string().min(1),
      description: z.string(),
      confidence,
      relation: z.enum(['supporting', 'prerequisite', 'adjacent', 'downstream', 'upstream', 'complementary']),
    }),
  ),
});

export type ServiceCapabilityOutput = z.infer<typeof serviceCapabilitySchema>;

export const serviceCapabilityJsonSchema = {
  type: 'object',
  properties: {
    primary: {
      type: 'object',
      properties: {
        canonicalName: {
          type: 'string',
          description: 'Short noun phrase in Title Case, e.g. "Generator Repair".',
        },
        description: { type: 'string' },
        confidence: { type: 'number' },
      },
      required: ['canonicalName', 'description', 'confidence'],
      additionalProperties: false,
    },
    related: {
      type: 'array',
      description: 'Capabilities reasonably implied by the primary one, at honest confidence.',
      items: {
        type: 'object',
        properties: {
          canonicalName: { type: 'string' },
          description: { type: 'string' },
          confidence: { type: 'number' },
          relation: {
            type: 'string',
            enum: ['supporting', 'prerequisite', 'adjacent', 'downstream', 'upstream', 'complementary'],
          },
        },
        required: ['canonicalName', 'description', 'confidence', 'relation'],
        additionalProperties: false,
      },
    },
  },
  required: ['primary', 'related'],
  additionalProperties: false,
} as const;

// ── Onboarding field extraction ──────────────────────────────────────────────────────

/**
 * Extracts every onboarding field present in a message, not just the one that was asked about
 * (MCOS Refinement #11, "Single-Turn Information Extraction").
 *
 * The location fields carry separate confidences because the state is typically *inferred*
 * from the city, and the workflow must be able to tell an inference apart from a statement in
 * order to confirm it rather than assume it.
 */
export const onboardingExtractionSchema = z.object({
  capabilityStatement: z.string(),
  businessName: z.string(),
  businessNameConfidence: confidence,
  city: z.string(),
  cityConfidence: confidence,
  state: z.string(),
  stateConfidence: confidence,
  /** True when the state was deduced from the city rather than stated outright. */
  stateInferredFromCity: z.boolean(),
  /** True when the message reads as confirming or denying something already proposed. */
  isConfirmation: z.boolean(),
  confirmationValue: z.enum(['yes', 'no', 'none']),
  reasoning: z.string(),
});

export type OnboardingExtractionOutput = z.infer<typeof onboardingExtractionSchema>;

export const onboardingExtractionJsonSchema = {
  type: 'object',
  properties: {
    capabilityStatement: {
      type: 'string',
      description: 'What the vendor sells or does, in their own words. Empty if not mentioned.',
    },
    businessName: { type: 'string', description: 'Shop or business name. Empty if not mentioned.' },
    businessNameConfidence: { type: 'number' },
    city: { type: 'string', description: 'City or town. Empty if not mentioned.' },
    cityConfidence: { type: 'number' },
    state: {
      type: 'string',
      description: 'State. May be deduced from a well-known city; set stateInferredFromCity if so.',
    },
    stateConfidence: { type: 'number' },
    stateInferredFromCity: { type: 'boolean' },
    isConfirmation: { type: 'boolean' },
    confirmationValue: { type: 'string', enum: ['yes', 'no', 'none'] },
    reasoning: { type: 'string' },
  },
  required: [
    'capabilityStatement',
    'businessName',
    'businessNameConfidence',
    'city',
    'cityConfidence',
    'state',
    'stateConfidence',
    'stateInferredFromCity',
    'isConfirmation',
    'confirmationValue',
    'reasoning',
  ],
  additionalProperties: false,
} as const;
