import { z } from 'zod';
import { CONVERSATION_RELATIONSHIPS } from '../../domain/models/understanding';

/**
 * Paired Zod validators and JSON Schemas for every LLM call.
 *
 * Both are hand-written rather than generated because OpenAI strict structured outputs
 * impose rules a generic converter does not satisfy: every property must appear in
 * `required`, and every object must set `additionalProperties: false`. The Zod schema is
 * the runtime contract applied uniformly across providers; the JSON Schema is what the
 * provider enforces natively.
 */

/** Confidence values are probabilities; anything outside [0,1] is a model error. */
const confidence = z.number().min(0).max(1);

// ── Continuity analysis ──────────────────────────────────────────────────────────────

export const continuitySchema = z.object({
  relationship: z.enum(CONVERSATION_RELATIONSHIPS),
  confidence,
  candidateWorkflowIds: z.array(z.string()),
  reasoning: z.string(),
});

export type ContinuityOutput = z.infer<typeof continuitySchema>;

export const continuityJsonSchema = {
  type: 'object',
  properties: {
    relationship: { type: 'string', enum: [...CONVERSATION_RELATIONSHIPS] },
    confidence: { type: 'number' },
    candidateWorkflowIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ids of open workflows this message could belong to, best first.',
    },
    reasoning: { type: 'string', description: 'One short sentence explaining the choice.' },
  },
  required: ['relationship', 'confidence', 'candidateWorkflowIds', 'reasoning'],
  additionalProperties: false,
} as const;

// ── Intent resolution ────────────────────────────────────────────────────────────────

export const intentSchema = z.object({
  intent: z.string().min(1),
  confidence,
  /**
   * Entities arrive as name/value pairs rather than a free-form object: OpenAI strict mode
   * cannot express an open-ended map, and a fixed key list would not survive new workflows.
   */
  entities: z.array(z.object({ name: z.string().min(1), value: z.string() })),
  language: z.string().min(1),
  command: z.string(),
});

export type IntentOutput = z.infer<typeof intentSchema>;

export const intentJsonSchema = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      description:
        "The user's objective, e.g. buyer_product_search, vendor_onboarding, complaint, wallet_funding, smalltalk, unknown.",
    },
    confidence: { type: 'number' },
    entities: {
      type: 'array',
      description: 'Entities explicitly present in the message. Do not invent values.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['name', 'value'],
        additionalProperties: false,
      },
    },
    language: { type: 'string', description: 'BCP-47 tag, e.g. en, pcm, ha, ig, yo.' },
    command: {
      type: 'string',
      description: 'Explicit command such as cancel, restart, help. Empty string when none.',
    },
  },
  required: ['intent', 'confidence', 'entities', 'language', 'command'],
  additionalProperties: false,
} as const;

// ── Semantic resolution ──────────────────────────────────────────────────────────────

const resolvedItemJsonSchema = {
  type: 'object',
  properties: {
    raw: { type: 'string', description: 'Exactly as the user said it.' },
    normalized: { type: 'string', description: 'Standard marketplace name for the same thing.' },
    aliases: { type: 'array', items: { type: 'string' } },
  },
  required: ['raw', 'normalized', 'aliases'],
  additionalProperties: false,
} as const;

const resolvedItemSchema = z.object({
  raw: z.string(),
  normalized: z.string(),
  aliases: z.array(z.string()),
});

export const semanticSchema = z.object({
  products: z.array(resolvedItemSchema),
  services: z.array(resolvedItemSchema),
  categoryName: z.string(),
  ambiguity: z.boolean(),
  ambiguityScore: confidence,
  modifiers: z.array(z.string()),
  constraints: z.array(z.string()),
  brands: z.array(z.string()),
});

export type SemanticOutput = z.infer<typeof semanticSchema>;

export const semanticJsonSchema = {
  type: 'object',
  properties: {
    products: { type: 'array', items: resolvedItemJsonSchema },
    services: { type: 'array', items: resolvedItemJsonSchema },
    categoryName: {
      type: 'string',
      description: 'Best-fit commercial category name, or empty string if unclear.',
    },
    ambiguity: {
      type: 'boolean',
      description: 'True only when the ambiguity would lead to a materially different set of vendors.',
    },
    ambiguityScore: { type: 'number' },
    modifiers: {
      type: 'array',
      items: { type: 'string' },
      description: 'Qualifiers the user stated (size, colour, material). Never inferred.',
    },
    constraints: {
      type: 'array',
      items: { type: 'string' },
      description: 'Stated constraints such as budget, delivery or urgency.',
    },
    brands: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'products',
    'services',
    'categoryName',
    'ambiguity',
    'ambiguityScore',
    'modifiers',
    'constraints',
    'brands',
  ],
  additionalProperties: false,
} as const;

// ── Utterance segmentation ───────────────────────────────────────────────────────────

/**
 * Splits one message into the objectives it carries.
 *
 * Separate from intent resolution on purpose: this stage decides *how many* things the user
 * asked for, and only then does each part get classified. Merging the two would recreate the
 * limitation it exists to remove — a single label for a message that carried two requests.
 */
export const segmentationSchema = z.object({
  segments: z
    .array(
      z.object({
        text: z.string().min(1),
        /** Short label for logs and for the reply's ordering, not for routing. */
        summary: z.string(),
      }),
    )
    .min(1),
  reasoning: z.string(),
});

export type SegmentationOutput = z.infer<typeof segmentationSchema>;

export const segmentationJsonSchema = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      description:
        'The message split into self-contained requests, in the order the user said them. One entry when the message carries a single request.',
      items: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description:
              "The user's own words for this part, rewritten only as far as needed to stand alone.",
          },
          summary: { type: 'string', description: 'Three or four words naming this request.' },
        },
        required: ['text', 'summary'],
        additionalProperties: false,
      },
    },
    reasoning: { type: 'string', description: 'One short sentence explaining the split.' },
  },
  required: ['segments', 'reasoning'],
  additionalProperties: false,
} as const;

// ── Suggested next actions ───────────────────────────────────────────────────────────

/**
 * Options the assistant offers the user for their next step.
 *
 * These are suggestions, not commands: each is replayed as if the user typed it, so the model
 * cannot propose a step the platform is unable to route. That is why there is no payload or
 * workflow reference here — only words.
 */
export const suggestedActionsSchema = z.object({
  options: z
    .array(
      z.object({
        /** What the user sees and, if they tap it, effectively says. Keep it short. */
        label: z.string().min(1),
      }),
    )
    .max(4),
  reasoning: z.string(),
});

export type SuggestedActionsOutput = z.infer<typeof suggestedActionsSchema>;

export const suggestedActionsJsonSchema = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      description:
        'Between 0 and 4 next steps the user is most likely to want. Empty when the reply needs no options.',
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description:
              "The option as the user would say it, at most 20 characters so it fits a WhatsApp button. E.g. 'Yes', 'No', 'Cancel', 'Aba', 'Show more sellers'.",
          },
        },
        required: ['label'],
        additionalProperties: false,
      },
    },
    reasoning: { type: 'string', description: 'One short sentence.' },
  },
  required: ['options', 'reasoning'],
  additionalProperties: false,
} as const;
