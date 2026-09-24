import { readFileSync } from 'node:fs';
import { promptKey, type PromptDefinition } from './prompt-definition';

/**
 * In-memory registry of prompt definitions, populated by each component module at boot.
 *
 * Definitions are immutable once registered. A component that needs different behaviour ships
 * a new version rather than editing the existing one, so a persisted `prompt_version` always
 * identifies exactly the text the model saw.
 */
export class PromptRegistry {
  private readonly definitions = new Map<string, PromptDefinition>();
  private readonly latest = new Map<string, PromptDefinition>();

  register(definition: PromptDefinition): PromptDefinition {
    const key = promptKey(definition.id, definition.version);
    const existing = this.definitions.get(key);
    if (existing !== undefined) {
      if (existing.system !== definition.system || existing.schemaId !== definition.schemaId) {
        throw new Error(`Prompt "${key}" is already registered with different content`);
      }
      return existing;
    }

    this.definitions.set(key, definition);

    const current = this.latest.get(definition.id);
    if (current === undefined || compareVersions(definition.version, current.version) > 0) {
      this.latest.set(definition.id, definition);
    }
    return definition;
  }

  /** The exact version, or the latest registered version when `version` is omitted. */
  get(id: string, version?: string): PromptDefinition {
    const definition =
      version === undefined ? this.latest.get(id) : this.definitions.get(promptKey(id, version));
    if (definition === undefined) {
      throw new Error(`No prompt registered for "${id}"${version === undefined ? '' : `@${version}`}`);
    }
    return definition;
  }

  has(id: string, version?: string): boolean {
    return version === undefined ? this.latest.has(id) : this.definitions.has(promptKey(id, version));
  }

  all(): readonly PromptDefinition[] {
    return [...this.definitions.values()];
  }
}

/** Loads a prompt body from disk once, at registration. Paths are resolved by the caller. */
export function loadPromptFile(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8').trim();
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
