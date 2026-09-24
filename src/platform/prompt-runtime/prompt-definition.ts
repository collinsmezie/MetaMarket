import type { ComponentName } from '../registry/component-registry';

/**
 * Prompts are code (Directive §14; Overarching §7; MCOS §34A).
 *
 * A prompt definition binds a versioned system prompt to the executable output schema it must
 * satisfy and to the component that owns it. Nothing calls a model with a bare string: every
 * invocation names a definition, and every execution records the definition's versions.
 */

export interface PromptModelPolicy {
  /**
   * Model to request from the primary provider, or null for the deployment default. Specialists
   * pin a conversational chat model (gpt-4o at temperature 0) because reasoning models reject
   * `temperature` and were measured to break determinism (see cde-model-choice-determinism).
   */
  readonly model: string | null;
  /** 0 for deterministic extraction. Reasoning models ignore this at the adapter. */
  readonly temperature: number;
  readonly maxOutputTokens: number | null;
  /** Timeout override; falls back to the global LLM timeout. */
  readonly timeoutMs: number | null;
}

export interface PromptDefinition {
  /** Stable identifier, e.g. `idce.runtime.discover`, `mcos.p3.plan-builder`. */
  readonly id: string;
  /** Prompt version, independent of code and of the schema version, e.g. `1.0.0`. */
  readonly version: string;
  readonly component: ComponentName;
  /** `$id` of the registered output schema this prompt is bound to. */
  readonly schemaId: string;
  /** The system prompt text (markdown), loaded from the component's `prompts/` directory. */
  readonly system: string;
  /** Names of the `<section>` blocks the runtime prompt expects, in order. */
  readonly sections: readonly string[];
  readonly modelPolicy: PromptModelPolicy;
  /** Human-readable purpose, shown in traces. */
  readonly description: string;
}

export const DEFAULT_MODEL_POLICY: PromptModelPolicy = {
  model: null,
  temperature: 0,
  maxOutputTokens: null,
  timeoutMs: null,
};

export function promptKey(id: string, version: string): string {
  return `${id}@${version}`;
}
