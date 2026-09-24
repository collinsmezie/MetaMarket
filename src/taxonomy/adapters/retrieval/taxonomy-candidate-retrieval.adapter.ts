import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../adapters/outbound/persistence/prisma.service';
import { AppConfigService } from '../../../config/app-config.service';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../../../domain/ports/outbound/embedding-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import {
  GPC_LEVEL,
  TAXONOMY_REPOSITORY,
  type TaxonomyMatch,
  type TaxonomyNode,
  type TaxonomyRepositoryPort,
} from '../../../domain/ports/outbound/taxonomy-repository.port';
import {
  levelName,
  NON_GPC_ENTITY_TYPES,
  type GpcCandidate,
  type GpcLineageRef,
  type RetrievalSource,
} from '../../domain/gpc-mapping';
import type {
  CandidateQuery,
  CandidateRetrievalResult,
  GpcCandidateRetrievalPort,
} from '../../ports/gpc-candidate-retrieval.port';

const COMPONENT = 'GPC_RESOLVER';
const STAGE = 'CandidateRetrieval';
const HIERARCHY_LEVELS = [GPC_LEVEL.Segment, GPC_LEVEL.Family, GPC_LEVEL.Class, GPC_LEVEL.Brick];
const MIN_SIMILARITY = 0.2;
const MAX_ALIAS_QUERIES = 4;

/**
 * `GpcCandidateRetrievalPort` over the installed sovereign taxonomy index (GPC Resolver TDR §11–§12,
 * §76.2–§76.3; Overarching §12.1).
 *
 * Fuses the arms §12 lists: hybrid vector + lexical + head-noun retrieval on the concept, alias /
 * Enrichment-terminology lexical retrieval, and prior validated codes from the knowledge layer.
 * Every candidate carries its retrieval sources, fused score, full lineage and the dataset
 * version. Retrieval never decides: the resolver reasons over the shortlist.
 */
@Injectable()
export class TaxonomyCandidateRetrievalAdapter implements GpcCandidateRetrievalPort {
  constructor(
    @Inject(TAXONOMY_REPOSITORY) private readonly taxonomy: TaxonomyRepositoryPort,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProviderPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async retrieve(
    queries: readonly CandidateQuery[],
    limitPerObject: number,
  ): Promise<CandidateRetrievalResult> {
    const gpcVersion = await this.datasetVersion();
    const applicable = queries.filter((query) => !NON_GPC_ENTITY_TYPES.has(query.entityType));
    if (applicable.length === 0) return { candidates: [], gpcVersion };

    // One embedding per object, built like the index text (title, title, lineage-ish context, definition).
    const vectors = await this.embeddings.embedBatch(applicable.map(embeddingTextFor));
    const candidates: GpcCandidate[] = [];

    for (const [index, query] of applicable.entries()) {
      const embedding = vectors[index];
      if (embedding === undefined) continue;
      const fused = new Map<string, { node: TaxonomyNode; score: number; sources: Set<RetrievalSource> }>();
      const absorb = (matches: readonly TaxonomyMatch[], source: RetrievalSource, weight: number) => {
        matches.forEach((match, rank) => {
          const score = Math.max(0, Math.min(1, match.similarity)) * weight * (1 - rank * 0.02);
          const existing = fused.get(match.node.code);
          if (existing === undefined)
            fused.set(match.node.code, { node: match.node, score, sources: new Set([source]) });
          else {
            existing.score = Math.max(existing.score, score) + 0.05;
            existing.sources.add(source);
          }
        });
      };

      // Arm 1: hybrid (vector + lexical + head noun) on the canonical concept.
      absorb(
        await this.taxonomy.search({
          embedding,
          text: query.canonicalForm,
          limit: limitPerObject,
          minSimilarity: MIN_SIMILARITY,
          levels: HIERARCHY_LEVELS,
        }),
        'VECTOR',
        1,
      );
      // Arm 2: aliases and Enrichment taxonomy vocabulary, lexically anchored.
      const terms = [
        ...new Set(
          [...query.aliases, ...query.taxonomyVocabulary]
            .map((term) => term.trim())
            .filter((term) => term.length > 2 && term.toLowerCase() !== query.canonicalForm.toLowerCase()),
        ),
      ].slice(0, MAX_ALIAS_QUERIES);
      for (const term of terms) {
        absorb(
          await this.taxonomy.search({
            embedding,
            text: term,
            limit: Math.max(3, Math.floor(limitPerObject / 3)),
            minSimilarity: MIN_SIMILARITY,
            levels: HIERARCHY_LEVELS,
          }),
          'ALIAS',
          0.9,
        );
      }
      // Arm 3: prior validated mappings from the knowledge layer (§12 item 10).
      for (const code of query.knownGpcCodes) {
        const node = await this.taxonomy.findByCode(code);
        if (node === null) continue;
        const existing = fused.get(code);
        if (existing === undefined) fused.set(code, { node, score: 0.95, sources: new Set(['KNOWLEDGE']) });
        else {
          existing.score = Math.min(1, existing.score + 0.1);
          existing.sources.add('KNOWLEDGE');
        }
      }

      const ranked = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limitPerObject);
      for (const entry of ranked) {
        candidates.push(
          await this.toCandidate(
            entry.node,
            [...entry.sources],
            Math.min(1, entry.score),
            gpcVersion,
            query.objectId,
          ),
        );
      }

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: {
          objectId: query.objectId,
          canonicalForm: query.canonicalForm,
          aliasQueries: terms.length,
          knownCodes: query.knownGpcCodes.length,
        },
        action: `Retrieved ${ranked.length} GPC candidate(s)`,
        output: ranked.slice(0, 5).map((entry) => ({
          code: entry.node.code,
          level: entry.node.level,
          title: entry.node.title,
          score: Number(entry.score.toFixed(3)),
          sources: [...entry.sources],
        })),
      });
    }

    return { candidates, gpcVersion };
  }

  /** Installed dataset identity (§93.5): the last completed import, else the configured file plus node count. */
  async datasetVersion(): Promise<string> {
    const latest = await this.prisma.taxonomyImport
      .findFirst({ where: { completedAt: { not: null } }, orderBy: { completedAt: 'desc' } })
      .catch(() => null);
    if (latest !== null)
      return `gs1-gpc:${latest.languageCode}:${latest.publishedOn}:${latest.sourceSha256.slice(0, 12)}`;
    const counts = await this.taxonomy.countByLevel().catch(() => ({}) as Record<number, number>);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return `gs1-gpc:${this.config.taxonomy.gs1GpcFile}:unversioned:${total}-nodes`;
  }

  private async toCandidate(
    node: TaxonomyNode,
    sources: RetrievalSource[],
    score: number,
    gpcVersion: string,
    forObjectId: string,
  ): Promise<GpcCandidate> {
    const ancestors = await this.taxonomy.ancestorsOf(node.code);
    const lineage = (level: number): GpcLineageRef | null => {
      if (node.level === level) return { code: node.code, title: node.title };
      const ancestor = ancestors.find((candidate) => candidate.level === level);
      return ancestor === undefined ? null : { code: ancestor.code, title: ancestor.title };
    };
    return {
      gpcCode: node.code,
      level: levelName(node.level) ?? 'BRICK',
      title: node.title,
      definition: node.definition.trim().length > 0 ? node.definition : null,
      segment: lineage(GPC_LEVEL.Segment),
      family: lineage(GPC_LEVEL.Family),
      class: lineage(GPC_LEVEL.Class),
      brick: lineage(GPC_LEVEL.Brick),
      retrievalSources: sources,
      retrievalScore: score,
      gpcVersion,
      forObjectId,
    };
  }
}

/** Query text shaped like the index text the seeder embedded (title. title. context. definition). */
function embeddingTextFor(query: CandidateQuery): string {
  const parts = [`${query.canonicalForm}. ${query.canonicalForm}.`];
  if (query.taxonomyEmbeddingText !== null && query.taxonomyEmbeddingText.trim().length > 0)
    parts.push(query.taxonomyEmbeddingText.trim());
  else if (query.definition.trim().length > 0) parts.push(query.definition.trim());
  if (query.taxonomyVocabulary.length > 0)
    parts.push(`Category: ${query.taxonomyVocabulary.slice(0, 6).join(' > ')}.`);
  return parts.join(' ');
}
