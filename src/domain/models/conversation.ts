import type { Channel } from './channel';
import type { WorkflowRegistry } from './workflow-instance';
import { EMPTY_REGISTRY } from './workflow-instance';

/**
 * Conversation is the root aggregate (MCOS §3.2, §6).
 *
 * It owns context, history, memory, the workflow registry and the active workflow
 * pointer. Channels never own conversations — the same user reaching us over SMS after
 * WhatsApp continues the same conversation.
 */

export const HISTORY_ROLES = ['user', 'assistant', 'system'] as const;

export type HistoryRole = (typeof HISTORY_ROLES)[number];

export interface HistoryEntry {
  readonly id: string;
  readonly role: HistoryRole;
  /** Plain text: transcribed audio and OCR'd images are already flattened by this point. */
  readonly content: string;
  readonly channel: Channel;
  readonly timestamp: Date;
  /** Set when this turn was produced by, or fed into, a specific workflow. */
  readonly workflowId?: string;
}

/**
 * Durable facts learned about the user that outlive any single workflow.
 *
 * Deliberately distinct from workflow `data`: a vendor's resolved city belongs to the
 * conversation memory, while "which of 3 vendor options they picked" belongs to a workflow.
 * This is what lets the Information Before Questions principle avoid re-asking across
 * sessions (MCOS Refinement #11).
 */
export interface ConversationMemory {
  /** Known facts keyed by a stable name, e.g. `location.city`, `business.name`. */
  readonly facts: Readonly<Record<string, MemoryFact>>;
  /** Rolling natural-language digest of the relationship, cheaper than replaying history. */
  readonly summary: string;
}

export interface MemoryFact {
  readonly value: unknown;
  /** Belief in [0,1]. Facts below the workflow's threshold get confirmed, not trusted. */
  readonly confidence: number;
  /** Where it came from — `user_stated`, `ai_inferred`, `channel_metadata`. */
  readonly source: string;
  readonly updatedAt: Date;
}

export interface Conversation {
  readonly id: string;
  readonly userId: string;
  readonly history: readonly HistoryEntry[];
  readonly memory: ConversationMemory;
  readonly workflowRegistry: WorkflowRegistry;
  readonly lastChannel: Channel;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The working set handed to the pipeline for one incoming message.
 *
 * Carries the conversation plus the artifacts extracted from the current message, so
 * every stage reads the same view and no stage re-fetches state.
 */
export interface ConversationContext {
  readonly conversation: Conversation;
  /** History window loaded for reasoning, most recent last. */
  readonly recentHistory: readonly HistoryEntry[];
}

export const EMPTY_MEMORY: ConversationMemory = {
  facts: {},
  summary: '',
};

/** Builds the initial conversation for a user's first message on a channel. */
export function newConversation(params: {
  id: string;
  userId: string;
  channel: Channel;
  now: Date;
}): Conversation {
  return {
    id: params.id,
    userId: params.userId,
    history: [],
    memory: EMPTY_MEMORY,
    workflowRegistry: EMPTY_REGISTRY,
    lastChannel: params.channel,
    createdAt: params.now,
    updatedAt: params.now,
  };
}

export function getFact(memory: ConversationMemory, key: string): MemoryFact | undefined {
  return memory.facts[key];
}

/**
 * Reads a fact only if the platform believes it strongly enough to act on.
 *
 * Used by the Information Before Questions check: a weakly-inferred city should be
 * confirmed conversationally, not silently assumed.
 */
export function getConfidentFact(
  memory: ConversationMemory,
  key: string,
  minConfidence: number,
): MemoryFact | undefined {
  const fact = memory.facts[key];
  if (fact === undefined) return undefined;
  return fact.confidence >= minConfidence ? fact : undefined;
}

export function withFact(memory: ConversationMemory, key: string, fact: MemoryFact): ConversationMemory {
  return { ...memory, facts: { ...memory.facts, [key]: fact } };
}
