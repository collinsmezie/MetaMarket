import { Inject, Injectable } from '@nestjs/common';
import type {
  CapabilitySignal,
  EvidenceObject,
  EvidenceSource,
  InformationDensity,
  VendorDna,
} from '../../domain/models/capability';
import { deriveBeliefs } from '../../domain/models/capability';
import type { CapabilityAncestry } from '../../domain/models/capability-graph';
import { propagate } from '../../domain/models/capability-graph';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../../domain/ports/outbound/embedding-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import {
  TAXONOMY_REPOSITORY,
  type TaxonomyRepositoryPort,
} from '../../domain/ports/outbound/taxonomy-repository.port';
import {
  VENDOR_REPOSITORY,
  type VendorRepositoryPort,
} from '../../domain/ports/outbound/vendor-repository.port';
import { BusinessUnderstandingService } from './business-understanding.service';
import { CapabilityResolver } from './capability-resolver.service';

const COMPONENT = 'CDE';
const STAGE = 'CapabilityDiscovery';

/**
 * Confidence assigned to a term the vendor stated outright.
 *
 * At or above the 0.8 "direct observation" line in the belief model, so a stated product is
 * never marked as merely inferred.
 */
const STATED_SIGNAL_STRENGTH = 0.9;

/** Ceiling for a term the archetype implied rather than the vendor stating it. */
const IMPLIED_SIGNAL_CEILING = 0.55;

export interface DiscoveryResult {
  readonly dna: VendorDna;
  readonly evidence: readonly EvidenceObject[];
  /** Suggested next question, when the engine judges one worth asking. */
  readonly clarificationQuestion: string | null;
  readonly ambiguityScore: number;
  /**
   * How much the statement actually told the engine.
   *
   * Surfaced because it, not ambiguity, decides whether a clarification is worth asking: a
   * broad-but-meaningful statement can be expanded, so asking about it wastes the vendor's
   * limited patience.
   */
  readonly informationDensity: InformationDensity;
}

/**
 * The Progressive Capability Discovery cycle (CDE §12).
 *
 * Observe → Extract → Resolve → Infer → Estimate confidence → Update DNA.
 *
 * Every call appends immutable evidence and then re-derives beliefs from the whole history,
 * rather than nudging the previous numbers. That costs a little more work per turn and buys
 * two things worth far more: any capability score can be explained from its evidence, and
 * improving the weighting rules improves every existing vendor retroactively.
 */
@Injectable()
export class CapabilityDiscoveryService {
  constructor(
    @Inject(VENDOR_REPOSITORY) private readonly vendors: VendorRepositoryPort,
    @Inject(TAXONOMY_REPOSITORY) private readonly taxonomy: TaxonomyRepositoryPort,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProviderPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly understanding: BusinessUnderstandingService,
    private readonly resolver: CapabilityResolver,
  ) {}

  /**
   * Processes one vendor statement into evidence and an updated DNA.
   *
   * `source` matters: the same words carry different weight depending on whether the vendor
   * volunteered them, answered a question, or corrected the platform.
   */
  async observeStatement(params: {
    vendorId: string;
    statement: string;
    source: EvidenceSource;
    priorStatements?: readonly string[];
    conversationId?: string;
    workflowId?: string;
  }): Promise<DiscoveryResult> {
    const startedAt = Date.now();

    const understood = await this.understanding.understand({
      statement: params.statement,
      priorStatements: params.priorStatements ?? [],
    });

    const productTerms = understood.products.map((product) => product.term);
    const serviceDescription = understood.services.map((service) => service.term).join('; ');

    const [resolvedProducts, resolvedServices] = await Promise.all([
      this.resolver.resolveProducts(productTerms, {
        archetype: understood.businessArchetype,
        statement: params.statement,
      }),
      this.resolver.resolveServices(serviceDescription),
    ]);

    // Whether the vendor stated a term or the archetype implied it decides how far belief may
    // move — the distinction the understanding stage was careful to preserve.
    const statedTerms = new Set(
      [...understood.products, ...understood.services]
        .filter((item) => item.stated)
        .map((item) => item.term.toLowerCase()),
    );

    const directSignals: CapabilitySignal[] = [...resolvedProducts, ...resolvedServices].map((resolved) => {
      const stated =
        statedTerms.has(resolved.capability.name.toLowerCase()) ||
        this.matchesStatedTerm(resolved.capability.name, statedTerms);

      return {
        capability: resolved.capability,
        strength: stated
          ? Math.max(STATED_SIGNAL_STRENGTH, resolved.confidence)
          : Math.min(resolved.confidence, IMPLIED_SIGNAL_CEILING),
        positive: true,
      };
    });

    const signals = await this.withHierarchyPropagation(directSignals);

    const evidence: EvidenceObject = {
      id: this.ids.uuid(),
      vendorId: params.vendorId,
      source: params.source,
      observedAt: this.clock.now(),
      originalText: params.statement,
      normalizedMeaning: understood.businessArchetype || understood.reasoning,
      informationDensity: understood.informationDensity as InformationDensity,
      supports: signals,
      reasoning: understood.reasoning,
      ...(params.conversationId !== undefined ? { conversationId: params.conversationId } : {}),
      ...(params.workflowId !== undefined ? { workflowId: params.workflowId } : {}),
    };

    const dna = await this.recordEvidence(params.vendorId, [evidence], {
      declaredProducts: understood.products.filter((p) => p.stated).map((p) => p.term),
      declaredServices: understood.services.filter((s) => s.stated).map((s) => s.term),
      brands: understood.brands,
      archetype: understood.businessArchetype,
    });

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { vendorId: params.vendorId, statement: params.statement, source: params.source },
      action: `Observed a ${understood.informationDensity}-density statement and updated the Capability DNA`,
      output: {
        archetype: understood.businessArchetype,
        directCapabilities: directSignals.length,
        withPropagation: signals.length,
        topBeliefs: dna.beliefs.slice(0, 5).map((belief) => ({
          name: belief.capability.name,
          confidence: Number(belief.confidence.toFixed(2)),
        })),
      },
      durationMs: Date.now() - startedAt,
    });

    return {
      dna,
      evidence: [evidence],
      clarificationQuestion:
        understood.clarificationQuestion.trim().length > 0 ? understood.clarificationQuestion : null,
      ambiguityScore: understood.ambiguityScore,
      informationDensity: understood.informationDensity as InformationDensity,
    };
  }

  /**
   * Records marketplace behaviour as evidence — a vendor accepting or rejecting a request.
   *
   * This is the channel that eventually matters most: behaviour is harder to misreport than
   * self-description, and "the marketplace itself becomes the teacher" (CDE "Capability
   * Discovery by Buyer Demand").
   */
  async observeBehaviour(params: {
    vendorId: string;
    capability: CapabilitySignal['capability'];
    positive: boolean;
    source: Extract<
      EvidenceSource,
      | 'request_accepted'
      | 'request_rejected'
      | 'match_completed'
      | 'customer_confirmation'
      | 'vendor_correction'
      | 'inventory_update'
    >;
    originalText: string;
    conversationId?: string;
  }): Promise<VendorDna> {
    const direct: CapabilitySignal = {
      capability: params.capability,
      strength: 0.95,
      positive: params.positive,
    };

    const evidence: EvidenceObject = {
      id: this.ids.uuid(),
      vendorId: params.vendorId,
      source: params.source,
      observedAt: this.clock.now(),
      originalText: params.originalText,
      normalizedMeaning: `${params.positive ? 'Confirmed' : 'Denied'} capability ${params.capability.name}`,
      informationDensity: 'high',
      supports: await this.withHierarchyPropagation([direct]),
      reasoning: `Marketplace behaviour: ${params.source}`,
      ...(params.conversationId !== undefined ? { conversationId: params.conversationId } : {}),
    };

    const dna = await this.recordEvidence(params.vendorId, [evidence]);

    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Behaviour`,
      input: { vendorId: params.vendorId, capability: params.capability.name, positive: params.positive },
      action: `Recorded marketplace behaviour (${params.source}) as capability evidence`,
      output: {
        confidence: Number(
          (dna.beliefs.find((b) => b.capability.id === params.capability.id)?.confidence ?? 0).toFixed(2),
        ),
      },
    });

    return dna;
  }

  /**
   * Appends evidence and re-derives the DNA from the complete history.
   *
   * The re-derivation is the point: beliefs are a view over evidence, never a running total
   * that could drift away from what actually happened.
   */
  private async recordEvidence(
    vendorId: string,
    evidence: readonly EvidenceObject[],
    declared?: {
      declaredProducts: readonly string[];
      declaredServices: readonly string[];
      brands: readonly string[];
      archetype: string;
    },
  ): Promise<VendorDna> {
    await this.vendors.appendEvidence(evidence);

    const history = await this.vendors.loadEvidence(vendorId);
    const beliefs = deriveBeliefs(history, this.clock.now());

    await this.vendors.replaceBeliefs(vendorId, beliefs);

    const existing = await this.vendors.loadProfile(vendorId);

    const declaredProducts = this.mergeUnique(existing?.dna.declaredProducts, declared?.declaredProducts);
    const declaredServices = this.mergeUnique(existing?.dna.declaredServices, declared?.declaredServices);
    const brands = this.mergeUnique(existing?.dna.brands, declared?.brands);

    const summary = this.buildSummary({
      archetype: declared?.archetype ?? '',
      beliefs,
      declaredProducts,
      declaredServices,
      brands,
    });

    await this.vendors.update(vendorId, {
      declaredProducts,
      declaredServices,
      brands,
      conversationSummary: summary,
      dnaEmbedding: await this.embedSummary(summary),
    });

    return {
      vendorId,
      beliefs,
      declaredProducts,
      declaredServices,
      brands,
      summary,
      evidenceCount: history.length,
      updatedAt: this.clock.now(),
    };
  }

  /**
   * Expands direct signals into the ancestors they imply.
   *
   * Looks ancestry up in the GPC hierarchy so a vendor who names MCCBs also becomes findable
   * for "electrical", which is how buyers actually phrase requests. Service capabilities have
   * no hierarchy, so they pass through unchanged.
   */
  private async withHierarchyPropagation(
    signals: readonly CapabilitySignal[],
  ): Promise<readonly CapabilitySignal[]> {
    const ancestryByCapability = new Map<string, CapabilityAncestry>();

    for (const signal of signals) {
      if (signal.capability.domain !== 'product') continue;

      try {
        const ancestors = await this.taxonomy.ancestorsOf(signal.capability.id);
        if (ancestors.length === 0) continue;

        ancestryByCapability.set(signal.capability.id, {
          capability: signal.capability,
          // Nearest parent first, so attenuation compounds in the right order.
          ancestors: [...ancestors]
            .sort((a, b) => b.level - a.level)
            .map((node) => ({ domain: 'product' as const, id: node.code, name: node.title })),
        });
      } catch (error) {
        // Propagation is an enhancement; losing it costs recall, not correctness.
        this.logger.stageFailed({
          component: COMPONENT,
          stage: `${STAGE}:Propagation`,
          input: { capabilityId: signal.capability.id },
          action: 'Could not load taxonomy ancestry; recording the direct signal only',
          error,
        });
      }
    }

    return propagate(signals, (capability) => ancestryByCapability.get(capability.id));
  }

  /**
   * Loose containment check between a resolved capability name and what the vendor said.
   *
   * "Cement" resolves to a brick titled "Cement", but "wires" may resolve to "Electrical
   * Wires" — the vendor did state it, and treating that as merely implied would understate a
   * capability they named outright.
   */
  private matchesStatedTerm(capabilityName: string, statedTerms: ReadonlySet<string>): boolean {
    const name = capabilityName.toLowerCase();

    for (const term of statedTerms) {
      if (term.length < 3) continue;
      if (name.includes(term) || term.includes(name)) return true;
    }

    return false;
  }

  private mergeUnique(
    existing: readonly string[] | undefined,
    incoming: readonly string[] | undefined,
  ): readonly string[] {
    const merged = new Map<string, string>();

    for (const value of [...(existing ?? []), ...(incoming ?? [])]) {
      const key = value.trim().toLowerCase();
      if (key.length === 0 || merged.has(key)) continue;
      merged.set(key, value.trim());
    }

    return [...merged.values()];
  }

  /**
   * Builds the natural-language DNA summary.
   *
   * Doubles as the text embedded for vendor-level retrieval, so it deliberately leads with the
   * strongest capabilities rather than reading as prose.
   */
  private buildSummary(params: {
    archetype: string;
    beliefs: ReturnType<typeof deriveBeliefs>;
    declaredProducts: readonly string[];
    declaredServices: readonly string[];
    brands: readonly string[];
  }): string {
    // Only take top 3 high-confidence direct beliefs (confidence >= 0.7) to keep DNA summaries clean
    const highConfidenceBeliefs = params.beliefs
      .filter((belief) => !belief.inferred && belief.confidence >= 0.7)
      .slice(0, 3)
      .map((belief) => belief.capability.name);

    const parts = [
      params.archetype.length > 0 ? params.archetype : null,
      params.declaredProducts.length > 0 ? `Sells: ${params.declaredProducts.slice(0, 3).join(', ')}.` : null,
      highConfidenceBeliefs.length > 0 && params.declaredProducts.length === 0
        ? `Capabilities: ${highConfidenceBeliefs.join(', ')}.`
        : null,
      params.declaredServices.length > 0
        ? `Services: ${params.declaredServices.slice(0, 3).join(', ')}.`
        : null,
      params.brands.length > 0 ? `Brands: ${params.brands.slice(0, 3).join(', ')}.` : null,
    ].filter((part): part is string => part !== null);

    return parts.join(' ');
  }

  private async embedSummary(summary: string): Promise<readonly number[] | null> {
    if (summary.trim().length === 0) return null;

    try {
      return await this.embeddings.embed(summary);
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:DnaEmbedding`,
        input: { summaryLength: summary.length },
        action: 'Could not embed the DNA summary; vendor-level semantic retrieval will lag',
        error,
      });
      return null;
    }
  }
}
