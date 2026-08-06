/**
 * Registry of canonical service capabilities.
 *
 * Products resolve against GS1 GPC, which is authoritative and fixed. Services have no such
 * taxonomy, so the resolver reasons them out — and this registry is what stops that becoming
 * a synonym free-for-all where "generator repair", "generator fixing" and "fixing gen" become
 * three unrelated capabilities that never match each other (CDE "Service Capabilities").
 */

export const SERVICE_CAPABILITY_REPOSITORY = Symbol('ServiceCapabilityRepository');

export interface ServiceCapabilityRecord {
  readonly id: string;
  readonly canonicalName: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly usageCount: number;
}

export interface ServiceCapabilityMatch {
  readonly record: ServiceCapabilityRecord;
  readonly similarity: number;
}

export interface ServiceCapabilityRepositoryPort {
  findById(id: string): Promise<ServiceCapabilityRecord | null>;

  /** Nearest existing capabilities by meaning, so a new phrasing can reuse an existing entry. */
  findSimilar(params: {
    embedding: readonly number[];
    limit: number;
    minSimilarity: number;
  }): Promise<readonly ServiceCapabilityMatch[]>;

  /**
   * Registers a capability, or returns the existing one if the slug is taken.
   *
   * Idempotent by slug so two vendors onboarding simultaneously with the same service cannot
   * create duplicate registry entries.
   */
  register(params: {
    id: string;
    canonicalName: string;
    description: string;
    embedding: readonly number[];
  }): Promise<ServiceCapabilityRecord>;

  /** Records that a phrasing resolved to this capability, improving future lexical matching. */
  recordAlias(id: string, alias: string): Promise<void>;

  countAll(): Promise<number>;
}

/**
 * Derives the registry slug for a canonical service name.
 *
 * Deterministic, so the same canonical name always produces the same identifier regardless of
 * which vendor or which model run first proposed it — the determinism requirement the
 * Capability Resolver spec sets out.
 */
export function serviceCapabilitySlug(canonicalName: string): string {
  const normalized = canonicalName
    .toLowerCase()
    .normalize('NFKD')
    // Strip diacritics so "réparation" and "reparation" cannot diverge.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

  return `svc_${normalized.length > 0 ? normalized : 'unspecified'}`;
}
