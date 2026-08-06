import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '../../../config/app-config.service';
import type {
  BrickAttributeTypeLink,
  BrickAttributeValueLink,
  TaxonomyAttributeInput,
  TaxonomyMatch,
  TaxonomyNode,
  TaxonomyNodeInput,
  TaxonomyRepositoryPort,
  TaxonomySearchOptions,
} from '../../../domain/ports/outbound/taxonomy-repository.port';
import { PrismaService } from './prisma.service';

/** Rows written per statement. Large enough to be fast, small enough to bound memory. */
const UPSERT_CHUNK = 1_000;

interface TaxonomyRow {
  code: string;
  level: number;
  title: string;
  definition: string;
  definition_excludes: string | null;
  active: boolean;
  parent_code: string | null;
  segment_code: string | null;
  family_code: string | null;
  class_code: string | null;
  brick_code: string | null;
}

@Injectable()
export class PrismaTaxonomyRepository implements TaxonomyRepositoryPort {
  private readonly embeddingDimension: number;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfigService,
  ) {
    this.embeddingDimension = config.embeddingDimension;
  }

  /**
   * Bulk upsert.
   *
   * Uses a single multi-row INSERT ... ON CONFLICT per chunk rather than Prisma's per-row
   * upsert: at 200k nodes, a round trip per row turns a one-minute import into an hour.
   *
   * Embeddings are deliberately left untouched — {@link writeEmbeddings} owns that column,
   * so re-importing an unchanged taxonomy does not discard work already paid for.
   */
  async upsertNodes(nodes: readonly TaxonomyNodeInput[]): Promise<void> {
    for (let offset = 0; offset < nodes.length; offset += UPSERT_CHUNK) {
      const chunk = nodes.slice(offset, offset + UPSERT_CHUNK);

      const values = chunk.map(
        (node) =>
          // `search_vector` is computed in SQL so the lexical index is always consistent
          // with the stored title, without a separate maintenance pass.
          Prisma.sql`(${node.code}, ${node.level}, ${node.title}, ${node.definition},
            ${node.definitionExcludes}, ${node.active}, ${node.parentCode}, ${node.segmentCode},
            ${node.familyCode}, ${node.classCode}, ${node.brickCode}, ${node.embeddedText},
            to_tsvector('english', ${node.title}), NOW())`,
      );

      await this.prisma.$executeRaw`
        INSERT INTO taxonomy_nodes (
          code, level, title, definition, definition_excludes, active, parent_code,
          segment_code, family_code, class_code, brick_code, embedded_text, search_vector, updated_at
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT (code) DO UPDATE SET
          search_vector = EXCLUDED.search_vector,
          level = EXCLUDED.level,
          title = EXCLUDED.title,
          definition = EXCLUDED.definition,
          definition_excludes = EXCLUDED.definition_excludes,
          active = EXCLUDED.active,
          parent_code = EXCLUDED.parent_code,
          segment_code = EXCLUDED.segment_code,
          family_code = EXCLUDED.family_code,
          class_code = EXCLUDED.class_code,
          brick_code = EXCLUDED.brick_code,
          embedded_text = EXCLUDED.embedded_text,
          updated_at = NOW()
      `;
    }
  }

  async writeEmbeddings(entries: readonly { code: string; embedding: readonly number[] }[]): Promise<void> {
    for (const entry of entries) {
      if (entry.embedding.length !== this.embeddingDimension) {
        throw new Error(
          `Embedding for GPC ${entry.code} has ${entry.embedding.length} dimensions but the schema expects ${this.embeddingDimension}.`,
        );
      }
    }

    // One statement per batch: a VALUES list joined against the table, so a 200-node batch
    // is one round trip instead of 200.
    for (let offset = 0; offset < entries.length; offset += UPSERT_CHUNK) {
      const chunk = entries.slice(offset, offset + UPSERT_CHUNK);

      const values = chunk.map(
        (entry) => Prisma.sql`(${entry.code}, ${`[${entry.embedding.join(',')}]`}::vector)`,
      );

      await this.prisma.$executeRaw`
        UPDATE taxonomy_nodes AS t
        SET embedding = v.embedding, updated_at = NOW()
        FROM (VALUES ${Prisma.join(values)}) AS v(code, embedding)
        WHERE t.code = v.code
      `;
    }
  }

  async upsertAttributes(attributes: readonly TaxonomyAttributeInput[]): Promise<void> {
    for (let offset = 0; offset < attributes.length; offset += UPSERT_CHUNK) {
      const chunk = attributes.slice(offset, offset + UPSERT_CHUNK);

      const values = chunk.map(
        (attribute) =>
          Prisma.sql`(${attribute.code}, ${attribute.level}, ${attribute.title}, ${attribute.definition}, ${attribute.active})`,
      );

      await this.prisma.$executeRaw`
        INSERT INTO taxonomy_attributes (code, level, title, definition, active)
        VALUES ${Prisma.join(values)}
        ON CONFLICT (code) DO UPDATE SET
          level = EXCLUDED.level,
          title = EXCLUDED.title,
          definition = EXCLUDED.definition,
          active = EXCLUDED.active
      `;
    }
  }

  async upsertBrickAttributeTypes(links: readonly BrickAttributeTypeLink[]): Promise<void> {
    for (let offset = 0; offset < links.length; offset += UPSERT_CHUNK) {
      const chunk = links.slice(offset, offset + UPSERT_CHUNK);
      const values = chunk.map((link) => Prisma.sql`(${link.brickCode}, ${link.attributeTypeCode})`);

      await this.prisma.$executeRaw`
        INSERT INTO brick_attribute_types (brick_code, attribute_type_code)
        VALUES ${Prisma.join(values)}
        ON CONFLICT DO NOTHING
      `;
    }
  }

  async upsertBrickAttributeValues(links: readonly BrickAttributeValueLink[]): Promise<void> {
    for (let offset = 0; offset < links.length; offset += UPSERT_CHUNK) {
      const chunk = links.slice(offset, offset + UPSERT_CHUNK);
      const values = chunk.map(
        (link) => Prisma.sql`(${link.brickCode}, ${link.attributeTypeCode}, ${link.attributeValueCode})`,
      );

      await this.prisma.$executeRaw`
        INSERT INTO brick_attribute_values (brick_code, attribute_type_code, attribute_value_code)
        VALUES ${Prisma.join(values)}
        ON CONFLICT DO NOTHING
      `;
    }
  }

  async clearEmbeddings(maxLevel: number): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE taxonomy_nodes
      SET embedding = NULL, updated_at = NOW()
      WHERE level <= ${maxLevel} AND embedding IS NOT NULL
    `;
  }

  /**
   * Nodes still lacking an embedding, shallowest first.
   *
   * Ordering by level means an interrupted seed leaves the most useful part of the taxonomy
   * — segments, families, classes — already searchable.
   */
  async findNodesNeedingEmbedding(maxLevel: number, limit: number): Promise<readonly TaxonomyNodeInput[]> {
    const rows = await this.prisma.$queryRaw<(TaxonomyRow & { embedded_text: string })[]>`
      SELECT code, level, title, definition, definition_excludes, active, parent_code,
             segment_code, family_code, class_code, brick_code, embedded_text
      FROM taxonomy_nodes
      WHERE level <= ${maxLevel}
        AND embedding IS NULL
      ORDER BY level ASC, code ASC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({ ...this.toDomain(row), embeddedText: row.embedded_text ?? '' }));
  }

  /**
   * Hybrid retrieval: dense vector similarity fused with lexical full-text ranking.
   *
   * Neither alone is sufficient for this marketplace. Embeddings handle the descriptive
   * queries traders actually use ("the thing used to tighten bolts" → Wrenches/Spanners) but
   * are unreliable on bare product nouns — "hammer" ranks Hammer Drills above Hammers,
   * because in embedding space those really are near-identical. Full-text is the exact
   * opposite: precise on "hammer", useless on a description that shares no words.
   *
   * The two ranked lists are combined with Reciprocal Rank Fusion. RRF is used rather than a
   * weighted sum of scores because cosine similarity and ts_rank are on incomparable scales,
   * so any fixed weighting between them is arbitrary; RRF only needs the orderings.
   *
   * `similarity` in the result stays the true cosine similarity, so callers still have a
   * calibrated confidence — the fusion decides ordering, not meaning.
   */
  async search(options: TaxonomySearchOptions): Promise<readonly TaxonomyMatch[]> {
    if (options.embedding.length !== this.embeddingDimension) {
      throw new Error(
        `Query embedding has ${options.embedding.length} dimensions but the taxonomy is indexed at ${this.embeddingDimension}.`,
      );
    }

    const literal = `[${options.embedding.join(',')}]`;
    const maxDistance = 1 - options.minSimilarity;

    // Conditions are composed with Prisma.sql so values stay parameterised.
    const levelFilter =
      options.levels !== undefined && options.levels.length > 0
        ? Prisma.sql`AND level IN (${Prisma.join(options.levels)})`
        : Prisma.empty;

    const segmentFilter =
      options.segmentCode !== undefined
        ? Prisma.sql`AND segment_code = ${options.segmentCode}`
        : Prisma.empty;

    // Empty text disables the lexical arm, e.g. when searching by a vendor's DNA vector
    // rather than by something a human typed.
    const lexicalQuery = (options.text ?? '').trim();

    // Each arm retrieves deeper than the final limit so a result ranked modestly by one
    // signal can still be promoted by the other.
    const candidateDepth = Math.max(options.limit * 6, 40);

    const rows = await this.prisma.$queryRaw<(TaxonomyRow & { distance: number; fused: number })[]>`
      WITH dense AS (
        SELECT code, (embedding <=> ${literal}::vector) AS distance,
               ROW_NUMBER() OVER (ORDER BY embedding <=> ${literal}::vector) AS rank
        FROM taxonomy_nodes
        WHERE embedding IS NOT NULL
          AND active = true
          ${levelFilter}
          ${segmentFilter}
        ORDER BY embedding <=> ${literal}::vector
        LIMIT ${candidateDepth}
      ),
      lexical AS (
        SELECT code,
               ROW_NUMBER() OVER (
                 ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', ${lexicalQuery})) DESC
               ) AS rank
        FROM taxonomy_nodes
        WHERE ${lexicalQuery} <> ''
          AND active = true
          AND search_vector @@ websearch_to_tsquery('english', ${lexicalQuery})
          ${levelFilter}
          ${segmentFilter}
        LIMIT ${candidateDepth}
      ),
      -- Head-noun match: the query names the node's entire subject, not a qualified variant.
      --
      -- GPC titles carry qualifiers in parentheses and alternatives after slashes, so
      -- "Hammers (DIY) (Non Powered)" reduces to "Hammers" and "Wrenches/Spanners
      -- (Non Powered)" to {"Wrenches", "Spanners"}. Neither the vector nor the full-text arm
      -- can separate "hammer" from "Hammer Drills" — both genuinely contain the word — but a
      -- buyer typing a bare noun means the plain article.
      exact AS (
        SELECT code
        FROM (
          SELECT code,
                 lower(trim(unnest(regexp_split_to_array(stripped, '/')))) AS head
          FROM (
            SELECT code, trim(regexp_replace(title, '\\s*\\([^)]*\\)', '', 'g')) AS stripped
            FROM taxonomy_nodes
            WHERE ${lexicalQuery} <> ''
              AND active = true
              ${levelFilter}
              ${segmentFilter}
          ) s
          -- Slash parts count as alternative head nouns only when the whole stripped title
          -- is slash-separated single words. Otherwise a slash is just punctuation mid-title:
          -- "Welding/Blow Torches Rods/Wire/Solder - Consumables" contains the part "Wire"
          -- without being about wire, and would otherwise outrank "Electrical Wires".
          WHERE stripped ~ '^[^[:space:]]+(/[^[:space:]]+)*$'
        ) heads
        -- Naive plural handling, which is all GPC titles need: they are English nouns in
        -- title case, so a stemmer would be heavier machinery for no extra recall here.
        WHERE head IN (lower(${lexicalQuery}), lower(${lexicalQuery}) || 's', lower(${lexicalQuery}) || 'es')
      ),
      fused AS (
        SELECT COALESCE(d.code, l.code) AS code,
               d.distance,
               -- k = 60 is the standard RRF constant: large enough that the top few ranks sit
               -- close together, so agreement between the arms matters more than either arm's
               -- exact position.
               COALESCE(1.0 / (60 + d.rank), 0)
                 + COALESCE(1.0 / (60 + l.rank), 0)
                 -- A head-noun match is categorically stronger evidence than a rank position,
                 -- so it is a flat bonus rather than a third RRF arm. At ~0.016 per arm, 0.05
                 -- is decisive without letting one signal override two disagreeing ones.
                 + CASE WHEN e.code IS NOT NULL THEN 0.05 ELSE 0 END AS fused
        FROM dense d
        FULL OUTER JOIN lexical l ON d.code = l.code
        LEFT JOIN exact e ON e.code = COALESCE(d.code, l.code)
      )
      SELECT t.code, t.level, t.title, t.definition, t.definition_excludes, t.active,
             t.parent_code, t.segment_code, t.family_code, t.class_code, t.brick_code,
             COALESCE(f.distance, (t.embedding <=> ${literal}::vector)) AS distance,
             f.fused
      FROM fused f
      JOIN taxonomy_nodes t ON t.code = f.code
      -- A lexical-only hit still has to clear the caller's similarity floor, so an
      -- unrelated node cannot ride in on a single shared word.
      WHERE COALESCE(f.distance, (t.embedding <=> ${literal}::vector)) <= ${maxDistance}
      ORDER BY f.fused DESC
      LIMIT ${options.limit}
    `;

    return rows.map((row) => ({ node: this.toDomain(row), similarity: 1 - Number(row.distance) }));
  }

  async findByCode(code: string): Promise<TaxonomyNode | null> {
    const row = await this.prisma.taxonomyNode.findUnique({ where: { code } });
    return row === null ? null : this.toDomain(this.fromPrisma(row));
  }

  /** Walks up the denormalised ancestry columns; no recursive query needed. */
  async ancestorsOf(code: string): Promise<readonly TaxonomyNode[]> {
    const node = await this.prisma.taxonomyNode.findUnique({ where: { code } });
    if (node === null) return [];

    const ancestorCodes = [node.segmentCode, node.familyCode, node.classCode, node.brickCode].filter(
      (candidate): candidate is string => candidate !== null && candidate !== code,
    );

    if (ancestorCodes.length === 0) return [];

    const rows = await this.prisma.taxonomyNode.findMany({
      where: { code: { in: ancestorCodes } },
      orderBy: { level: 'asc' },
    });

    return rows.map((row) => this.toDomain(this.fromPrisma(row)));
  }

  async countByLevel(): Promise<Readonly<Record<number, number>>> {
    const rows = await this.prisma.taxonomyNode.groupBy({ by: ['level'], _count: { _all: true } });
    return Object.fromEntries(rows.map((row) => [row.level, row._count._all]));
  }

  async countEmbedded(): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM taxonomy_nodes WHERE embedding IS NOT NULL
    `;
    return Number(row.count);
  }

  private fromPrisma(row: {
    code: string;
    level: number;
    title: string;
    definition: string;
    definitionExcludes: string | null;
    active: boolean;
    parentCode: string | null;
    segmentCode: string | null;
    familyCode: string | null;
    classCode: string | null;
    brickCode: string | null;
  }): TaxonomyRow {
    return {
      code: row.code,
      level: row.level,
      title: row.title,
      definition: row.definition,
      definition_excludes: row.definitionExcludes,
      active: row.active,
      parent_code: row.parentCode,
      segment_code: row.segmentCode,
      family_code: row.familyCode,
      class_code: row.classCode,
      brick_code: row.brickCode,
    };
  }

  private toDomain(row: TaxonomyRow): TaxonomyNode {
    return {
      code: row.code,
      level: row.level,
      title: row.title,
      definition: row.definition,
      definitionExcludes: row.definition_excludes,
      active: row.active,
      parentCode: row.parent_code,
      segmentCode: row.segment_code,
      familyCode: row.family_code,
      classCode: row.class_code,
      brickCode: row.brick_code,
    };
  }
}
