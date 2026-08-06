import { Inject, Injectable } from '@nestjs/common';
import type { CapabilityRef } from '../../domain/models/capability';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../../domain/ports/outbound/embedding-provider.port';
import { LLM_PROVIDER_SERVICE, type LlmService } from '../../domain/ports/outbound/llm-provider.port';
import {
  SERVICE_CAPABILITY_REPOSITORY,
  serviceCapabilitySlug,
  type ServiceCapabilityRepositoryPort,
} from '../../domain/ports/outbound/service-capability-repository.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  GPC_LEVEL,
  TAXONOMY_REPOSITORY,
  type TaxonomyRepositoryPort,
} from '../../domain/ports/outbound/taxonomy-repository.port';
import {
  capabilityRankingJsonSchema,
  capabilityRankingSchema,
  serviceCapabilityJsonSchema,
  serviceCapabilitySchema,
} from './schemas';

const COMPONENT = 'CDE';
const STAGE = 'CapabilityResolver';

/** GPC candidates retrieved per term before the model ranks them. */
const CANDIDATE_DEPTH = 12;

/** Floor for a candidate to be worth showing the ranker at all. */
const MIN_CANDIDATE_SIMILARITY = 0.25;

/**
 * Minimum ranker confidence for a resolved capability to be kept.
 *
 * Retrieval is deliberately broad, so the tail of any candidate list is mostly wrong. Without
 * a floor, "I repair generators" resolved to sixteen capabilities including Vacuum Cleaner
 * Filters and Air Purifiers — every one of which becomes a hypothesis attached to that vendor.
 */
const MIN_SELECTION_CONFIDENCE = 0.6;

/**
 * Capabilities kept per term.
 *
 * A term genuinely maps to one or two bricks; a long list means the ranker is hedging. Keeping
 * the tail costs matching precision for every future buyer.
 */
const MAX_SELECTIONS_PER_TERM = 3;

/**
 * Similarity at which a service phrasing is considered the same capability as an existing
 * registry entry.
 *
 * Deliberately high. Merging two genuinely different services is far worse than registering a
 * near-duplicate: a wrong merge silently misdirects buyers, whereas a duplicate only dilutes
 * matching until someone reconciles it.
 */
const SERVICE_MERGE_SIMILARITY = 0.93;

export interface ResolvedCapability {
  readonly capability: CapabilityRef;
  /** How well the term matches this capability, independent of vendor belief. */
  readonly confidence: number;
  readonly reasoning: string;
}

/**
 * Converts interpreted meaning into canonical capability identifiers
 * (CDE "Capability Resolver").
 *
 * This is the boundary between probabilistic language understanding and deterministic
 * commercial knowledge. The model reasons and ranks; the resolver decides the name. That split
 * is what guarantees "electrical things", "electric stuff" and "the things electricians buy"
 * converge on identical identifiers across every vendor — without it, capability matching
 * degrades into string comparison.
 */
@Injectable()
export class CapabilityResolver {
  constructor(
    @Inject(TAXONOMY_REPOSITORY) private readonly taxonomy: TaxonomyRepositoryPort,
    @Inject(SERVICE_CAPABILITY_REPOSITORY) private readonly services: ServiceCapabilityRepositoryPort,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProviderPort,
    @Inject(LLM_PROVIDER_SERVICE) private readonly llm: LlmService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  /**
   * Resolves product terms against GS1 GPC.
   *
   * Retrieval-first: the taxonomy proposes, the model disposes. The model is shown a fixed
   * candidate list and may only pick from it, so it cannot invent a code even if it wants to —
   * and any code it returns that is not in the list is discarded below.
   */
  async resolveProducts(terms: readonly string[]): Promise<readonly ResolvedCapability[]> {
    const meaningful = [...new Set(terms.map((term) => term.trim()).filter((term) => term.length > 1))];
    if (meaningful.length === 0) return [];

    const startedAt = Date.now();
    const resolved = new Map<string, ResolvedCapability>();

    // Terms are resolved concurrently. Each one costs a retrieval plus a ranking call, and a
    // broad statement expands to a dozen terms — sequentially that is roughly two minutes of
    // silence before the vendor's next question, which is not a usable WhatsApp experience.
    const perTerm = await Promise.all(
      meaningful.map(async (term) => {
        const candidates = await this.retrieveCandidates(term);

        if (candidates.length === 0) {
          this.logger.stage({
            component: COMPONENT,
            stage: `${STAGE}:Products`,
            input: { term },
            action: 'No GPC candidate cleared the similarity floor; leaving the term unresolved',
            output: { resolved: 0 },
          });
          return [];
        }

        return this.rankCandidates(term, candidates);
      }),
    );

    for (const selection of perTerm.flat()) {
      const existing = resolved.get(selection.capability.id);
      // Several terms can point at one brick; keep the strongest justification.
      if (existing === undefined || selection.confidence > existing.confidence) {
        resolved.set(selection.capability.id, selection);
      }
    }

    const output = [...resolved.values()].sort((a, b) => b.confidence - a.confidence);

    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Products`,
      input: { terms: meaningful },
      action: 'Resolved product terms to canonical GS1 GPC bricks',
      output: {
        resolved: output.map((item) => ({
          code: item.capability.id,
          name: item.capability.name,
          confidence: Number(item.confidence.toFixed(2)),
        })),
      },
      durationMs: Date.now() - startedAt,
    });

    return output;
  }

  private async retrieveCandidates(
    term: string,
  ): Promise<readonly { code: string; title: string; definition: string }[]> {
    try {
      const embedding = await this.embeddings.embed(term);

      const matches = await this.taxonomy.search({
        embedding,
        text: term,
        limit: CANDIDATE_DEPTH,
        minSimilarity: MIN_CANDIDATE_SIMILARITY,
        // Bricks are the level a vendor capability lives at: specific enough to match a
        // buyer's request, general enough that a shop plausibly covers the whole node.
        levels: [GPC_LEVEL.Brick],
      });

      return matches.map((match) => ({
        code: match.node.code,
        title: match.node.title,
        definition: match.node.definition.slice(0, 200),
      }));
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Retrieval`,
        input: { term },
        action: 'Taxonomy retrieval failed; the term cannot be resolved this turn',
        error,
      });
      return [];
    }
  }

  private async rankCandidates(
    term: string,
    candidates: readonly { code: string; title: string; definition: string }[],
  ): Promise<readonly ResolvedCapability[]> {
    const byCode = new Map(candidates.map((candidate) => [candidate.code, candidate]));

    try {
      const result = await this.llm.complete(
        {
          operation: 'capability_ranking',
          schemaName: 'CapabilityRanking',
          schema: capabilityRankingJsonSchema,
          temperature: 0,
          messages: [
            { role: 'system', content: RANKING_PROMPT },
            {
              role: 'user',
              content: [
                `VENDOR TERM: ${term}`,
                '',
                'CANDIDATES:',
                ...candidates.map(
                  (candidate) => `${candidate.code} | ${candidate.title} | ${candidate.definition}`,
                ),
              ].join('\n'),
            },
          ],
        },
        (value) => capabilityRankingSchema.parse(value),
      );

      return result.data.selections
        .map((selection): ResolvedCapability | null => {
          const candidate = byCode.get(selection.code);

          // The determinism guarantee in practice: a code that was not offered is dropped,
          // not trusted. Without this the "never generate a capability name" rule would rely
          // on the model's goodwill.
          if (candidate === undefined) {
            this.logger.stageFailed({
              component: COMPONENT,
              stage: `${STAGE}:Ranking`,
              input: { term, returnedCode: selection.code },
              action: 'Discarded a code the model returned that was not among the candidates',
              error: new Error('Model produced a capability identifier outside the candidate set'),
            });
            return null;
          }

          return {
            capability: { domain: 'product' as const, id: candidate.code, name: candidate.title },
            confidence: selection.confidence,
            reasoning: selection.reasoning,
          };
        })
        .filter((selection): selection is ResolvedCapability => selection !== null)
        .filter((selection) => selection.confidence >= MIN_SELECTION_CONFIDENCE)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, MAX_SELECTIONS_PER_TERM);
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Ranking`,
        input: { term, candidates: candidates.length },
        action: 'Ranking failed; falling back to the single best retrieved candidate',
        error,
      });

      // Retrieval already ordered the candidates, so the top one is a defensible fallback —
      // at reduced confidence, because nothing verified it.
      const best = candidates[0];
      return [
        {
          capability: { domain: 'product', id: best.code, name: best.title },
          confidence: 0.4,
          reasoning: 'Selected by retrieval ranking; AI verification was unavailable.',
        },
      ];
    }
  }

  /**
   * Resolves a service description into canonical service capabilities.
   *
   * Services have no authoritative taxonomy, so the model reasons them out — the one place the
   * spec permits generated names (CDE "Service Capabilities"). Fragmentation is prevented
   * downstream instead: every proposed capability is matched against the registry by meaning
   * before a new entry is created, so "generator repair" and "fixing generators" converge.
   */
  async resolveServices(description: string): Promise<readonly ResolvedCapability[]> {
    if (description.trim().length === 0) return [];

    const startedAt = Date.now();

    let reasoned;
    try {
      const result = await this.llm.complete(
        {
          operation: 'service_capability_reasoning',
          schemaName: 'ServiceCapabilities',
          schema: serviceCapabilityJsonSchema,
          temperature: 0,
          messages: [
            { role: 'system', content: SERVICE_PROMPT },
            { role: 'user', content: `SERVICE DESCRIPTION: ${description}` },
          ],
        },
        (value) => serviceCapabilitySchema.parse(value),
      );
      reasoned = result.data;
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Services`,
        input: { description },
        action: 'Service reasoning failed; no service capabilities resolved this turn',
        error,
      });
      return [];
    }

    const proposals = [{ ...reasoned.primary, relation: 'primary' as const }, ...reasoned.related];

    const resolved: ResolvedCapability[] = [];

    for (const proposal of proposals) {
      const registered = await this.registerOrMerge(proposal.canonicalName, proposal.description);
      if (registered === null) continue;

      resolved.push({
        capability: { domain: 'service', id: registered.id, name: registered.canonicalName },
        confidence: proposal.confidence,
        reasoning: `${proposal.relation}: ${proposal.description}`,
      });
    }

    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Services`,
      input: { description },
      action: 'Reasoned service capabilities and reconciled them against the registry',
      output: {
        primary: reasoned.primary.canonicalName,
        resolved: resolved.map((item) => ({
          id: item.capability.id,
          confidence: Number(item.confidence.toFixed(2)),
        })),
      },
      durationMs: Date.now() - startedAt,
    });

    return resolved;
  }

  /**
   * Finds an equivalent registry entry, or creates one.
   *
   * The embedding comparison is what keeps the service vocabulary from fragmenting across
   * vendors who describe the same work differently.
   */
  private async registerOrMerge(
    canonicalName: string,
    description: string,
  ): Promise<{ id: string; canonicalName: string } | null> {
    const trimmed = canonicalName.trim();
    if (trimmed.length === 0) return null;

    let embedding: readonly number[];
    try {
      embedding = await this.embeddings.embed(`${trimmed}. ${description}`);
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:ServiceRegistry`,
        input: { canonicalName: trimmed },
        action: 'Could not embed the service capability, so it cannot be deduplicated or stored',
        error,
      });
      return null;
    }

    const [nearest] = await this.services.findSimilar({
      embedding,
      limit: 1,
      minSimilarity: SERVICE_MERGE_SIMILARITY,
    });

    if (nearest !== undefined) {
      // Same capability under a different name: reuse the identifier and remember the phrasing.
      await this.services.recordAlias(nearest.record.id, trimmed);

      this.logger.stage({
        component: COMPONENT,
        stage: `${STAGE}:ServiceRegistry`,
        input: { proposed: trimmed },
        action: `Merged into the existing capability "${nearest.record.canonicalName}"`,
        output: { id: nearest.record.id, similarity: Number(nearest.similarity.toFixed(3)) },
      });

      return { id: nearest.record.id, canonicalName: nearest.record.canonicalName };
    }

    const record = await this.services.register({
      id: serviceCapabilitySlug(trimmed),
      canonicalName: trimmed,
      description,
      embedding,
    });

    return { id: record.id, canonicalName: record.canonicalName };
  }
}

const RANKING_PROMPT = `You select which product classification codes match a term a market seller used.

You are given the seller's term and a numbered list of candidate codes retrieved from the GS1
Global Product Classification. Choose the candidates that genuinely describe what the seller
supplies.

Rules:
- Return ONLY codes from the supplied candidate list. Never invent or modify a code.
- Return an empty list when none of the candidates genuinely fit. A wrong classification is
  worse than none, because buyers will be sent to the wrong shops.
- Prefer the plain article over a qualified variant: for "hammer", a general hammers category
  beats "hammer drills".
- Sellers stock ranges, so several candidates may be correct. Order them best first.
- Confidence reflects how sure you are the seller supplies that category, not how similar the
  words look.`;

const SERVICE_PROMPT = `You infer the commercial capabilities implied by a service a person provides, for a marketplace in informal African markets.

Given "I repair generators", the primary capability is Generator Repair — but a buyer whose
generator will not start should also reach this person through diagnostics, maintenance, parts
replacement and electrical repair. Infer those, at honest confidence.

Rules:
- canonicalName is a short noun phrase in Title Case, e.g. "Generator Repair", "Solar Panel
  Installation". Never a sentence, never first person.
- Name capabilities in the general form a marketplace would reuse across many providers, not
  in this person's specific words.
- Confidence must fall as the connection to the stated service weakens. Something directly
  entailed sits near 0.9; a plausible adjacent service sits near 0.35.
- Return at most 8 related capabilities. Prefer the ones a buyer would realistically search for.`;
