import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../../domain/ports/outbound/embedding-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  GPC_LEVEL,
  TAXONOMY_REPOSITORY,
  type BrickAttributeTypeLink,
  type BrickAttributeValueLink,
  type TaxonomyAttributeInput,
  type TaxonomyNodeInput,
  type TaxonomyRepositoryPort,
} from '../../domain/ports/outbound/taxonomy-repository.port';

const COMPONENT = 'CDE';
const STAGE = 'TaxonomySeeder';

/**
 * Nodes per embedding request.
 *
 * Well under OpenAI's 2048-input cap: the binding constraint is total tokens per request,
 * and GPC definitions are long. 256 keeps requests comfortably sized while still making the
 * import a few dozen calls rather than thousands.
 */
const EMBEDDING_BATCH = 256;

/**
 * Cap on the definition portion of the embedded text.
 *
 * GPC definitions run to several hundred words of legal-style qualification and frequently
 * name neighbouring products ("...used with hammers..."), which is precisely what makes a
 * long definition actively harmful: it pulls a node toward its neighbours' queries. Keeping
 * only the opening sentences preserves the meaning and drops most of the cross-talk.
 */
const MAX_DEFINITION_CHARS = 400;

/** Overall ceiling, after the title and path are prepended. */
const MAX_EMBED_CHARS = 700;

/** Shape of the official GS1 GPC JSON export. */
interface GpcFile {
  readonly LanguageCode?: string;
  readonly DateUtc?: string;
  readonly Schema?: readonly GpcNode[];
}

interface GpcNode {
  readonly Level?: number;
  readonly Code?: number | string;
  readonly Title?: string;
  readonly Definition?: string | null;
  readonly DefinitionExcludes?: string | null;
  readonly Active?: boolean;
  readonly Childs?: readonly GpcNode[];
}

export interface SeedOptions {
  readonly filePath: string;
  /**
   * Deepest level to embed. Defaults to Brick.
   *
   * Levels 5 and 6 are attribute types and values (≈194k of the 201k nodes). They describe
   * *variants* of a product, not what a business supplies, so embedding them would multiply
   * cost roughly thirtyfold while adding noise to capability retrieval. They are still
   * imported and queryable by code.
   */
  readonly embedToLevel?: number;
  /** Parse and report without writing or embedding anything. */
  readonly dryRun?: boolean;
  /** Re-embed everything, including nodes that already have a vector. */
  readonly force?: boolean;
}

export interface SeedResult {
  readonly languageCode: string;
  readonly publishedOn: string;
  readonly sourceSha256: string;
  readonly nodesParsed: number;
  readonly nodesByLevel: Readonly<Record<number, number>>;
  readonly nodesImported: number;
  /** Distinct attribute types and values, deduplicated from ~194k occurrences. */
  readonly attributesImported: number;
  readonly attributeLinksImported: number;
  readonly nodesEmbedded: number;
  readonly embeddedToLevel: number;
  readonly embeddingModel: string;
  readonly dryRun: boolean;
}

/** The export split into its hierarchy and its shared attribute vocabulary. */
interface ParsedTaxonomy {
  readonly nodes: readonly TaxonomyNodeInput[];
  readonly attributes: readonly TaxonomyAttributeInput[];
  readonly typeLinks: readonly BrickAttributeTypeLink[];
  readonly valueLinks: readonly BrickAttributeValueLink[];
}

/**
 * Imports the GS1 GPC taxonomy and builds its semantic index (Execution.md §1).
 *
 * The taxonomy is the authoritative vocabulary both sides of the marketplace resolve
 * against: vendor capabilities on the supply side, buyer demand on the demand side. Getting
 * the embedding text right therefore matters more than the import speed.
 */
@Injectable()
export class TaxonomySeeder {
  constructor(
    @Inject(TAXONOMY_REPOSITORY) private readonly taxonomy: TaxonomyRepositoryPort,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProviderPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  async seed(options: SeedOptions): Promise<SeedResult> {
    const embedToLevel = options.embedToLevel ?? GPC_LEVEL.Brick;
    const startedAt = Date.now();

    const { document, sha256 } = await this.readSource(options.filePath);
    const parsed = this.flatten(document.Schema ?? []);

    const nodesByLevel: Record<number, number> = {};
    for (const node of parsed.nodes) nodesByLevel[node.level] = (nodesByLevel[node.level] ?? 0) + 1;
    for (const attribute of parsed.attributes) {
      nodesByLevel[attribute.level] = (nodesByLevel[attribute.level] ?? 0) + 1;
    }

    const attributeLinks = parsed.typeLinks.length + parsed.valueLinks.length;

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { file: options.filePath, sha256: sha256.slice(0, 12) },
      action: 'Parsed the GS1 GPC export into a hierarchy plus shared attribute vocabulary',
      output: {
        languageCode: document.LanguageCode ?? 'unknown',
        publishedOn: document.DateUtc ?? 'unknown',
        hierarchyNodes: parsed.nodes.length,
        distinctAttributes: parsed.attributes.length,
        brickAttributeLinks: attributeLinks,
        byLevel: nodesByLevel,
      },
      durationMs: Date.now() - startedAt,
    });

    const base: Omit<
      SeedResult,
      'nodesImported' | 'nodesEmbedded' | 'attributesImported' | 'attributeLinksImported'
    > = {
      languageCode: document.LanguageCode ?? 'unknown',
      publishedOn: document.DateUtc ?? 'unknown',
      sourceSha256: sha256,
      nodesParsed: parsed.nodes.length + parsed.attributes.length,
      nodesByLevel,
      embeddedToLevel: embedToLevel,
      embeddingModel: this.embeddings.model,
      dryRun: options.dryRun === true,
    };

    if (options.dryRun === true) {
      const toEmbed = parsed.nodes.filter((node) => node.level <= embedToLevel).length;

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { dryRun: true, embedToLevel },
        action: 'Dry run: nothing was written and no embeddings were requested',
        output: {
          wouldImportNodes: parsed.nodes.length,
          wouldImportAttributes: parsed.attributes.length,
          wouldImportLinks: attributeLinks,
          wouldEmbed: toEmbed,
        },
      });

      return {
        ...base,
        nodesImported: 0,
        attributesImported: 0,
        attributeLinksImported: 0,
        nodesEmbedded: 0,
      };
    }

    await this.importNodes(parsed);

    const embedded = await this.embedPending(embedToLevel, options.force === true);

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { file: options.filePath, embedToLevel },
      action: 'Taxonomy import complete',
      output: {
        hierarchyNodes: parsed.nodes.length,
        attributes: parsed.attributes.length,
        links: attributeLinks,
        embedded,
        totalEmbeddedInStore: await this.taxonomy.countEmbedded(),
      },
      durationMs: Date.now() - startedAt,
    });

    return {
      ...base,
      nodesImported: parsed.nodes.length,
      attributesImported: parsed.attributes.length,
      attributeLinksImported: attributeLinks,
      nodesEmbedded: embedded,
    };
  }

  /**
   * Reads and parses the export.
   *
   * Tolerates trailing bytes after the JSON document — an editor or a stray append can leave
   * them, and failing a 122 MB import over a trailing newline would be needlessly brittle.
   */
  private async readSource(filePath: string): Promise<{ document: GpcFile; sha256: string }> {
    let raw: string;

    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      throw new Error(
        `Could not read the GS1 GPC file at "${filePath}". Set GS1_GPC_FILE to its location. ` +
          `(${error instanceof Error ? error.message : String(error)})`,
      );
    }

    const sha256 = createHash('sha256').update(raw).digest('hex');

    try {
      return { document: JSON.parse(raw) as GpcFile, sha256 };
    } catch {
      const firstBrace = raw.indexOf('{');
      const lastBrace = raw.lastIndexOf('}');

      if (firstBrace === -1 || lastBrace <= firstBrace) {
        throw new Error(`"${filePath}" does not contain a JSON object.`);
      }

      const document = JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as GpcFile;

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { file: filePath },
        action: 'Recovered the JSON document after ignoring trailing content in the source file',
        output: { trailingBytesIgnored: raw.length - (lastBrace + 1) },
      });

      return { document, sha256 };
    }
  }

  /**
   * Splits the nested export into its two genuinely different structures.
   *
   * Levels 1-4 are a strict tree with globally unique codes: each becomes one node carrying
   * denormalised ancestry. Levels 5-6 are shared vocabulary — the value "YES" (30002654)
   * appears under 500 bricks — so each distinct code becomes one attribute row plus link
   * rows. Treating those occurrences as tree nodes is what makes `code` collide.
   */
  private flatten(schema: readonly GpcNode[]): ParsedTaxonomy {
    const nodes: TaxonomyNodeInput[] = [];
    const attributes = new Map<string, TaxonomyAttributeInput>();
    const typeLinks = new Map<string, BrickAttributeTypeLink>();
    const valueLinks = new Map<string, BrickAttributeValueLink>();

    const visit = (
      node: GpcNode,
      ancestry: {
        codes: Record<number, string>;
        titles: readonly string[];
        brickCode: string | null;
        attributeTypeCode: string | null;
      },
    ): void => {
      const code = node.Code === undefined ? null : String(node.Code);
      if (code === null || node.Title === undefined) return;

      const level = node.Level ?? ancestry.titles.length + 1;
      const titles = [...ancestry.titles, node.Title];

      if (level <= GPC_LEVEL.Brick) {
        const codes = { ...ancestry.codes, [level]: code };

        nodes.push({
          code,
          level,
          title: node.Title,
          definition: node.Definition ?? '',
          definitionExcludes: node.DefinitionExcludes ?? null,
          active: node.Active !== false,
          parentCode: ancestry.codes[level - 1] ?? null,
          segmentCode: codes[GPC_LEVEL.Segment] ?? null,
          familyCode: codes[GPC_LEVEL.Family] ?? null,
          classCode: codes[GPC_LEVEL.Class] ?? null,
          brickCode: codes[GPC_LEVEL.Brick] ?? null,
          embeddedText: this.buildEmbeddedText(titles, node.Definition ?? ''),
        });

        const brickCode = level === GPC_LEVEL.Brick ? code : ancestry.brickCode;

        for (const child of node.Childs ?? []) {
          visit(child, { codes, titles, brickCode, attributeTypeCode: null });
        }

        return;
      }

      // Levels 5 and 6: record the concept once, then the link that puts it on this brick.
      if (!attributes.has(code)) {
        attributes.set(code, {
          code,
          level,
          title: node.Title,
          definition: node.Definition ?? '',
          active: node.Active !== false,
        });
      }

      const brickCode = ancestry.brickCode;

      if (brickCode !== null && level === GPC_LEVEL.AttributeType) {
        typeLinks.set(`${brickCode}:${code}`, { brickCode, attributeTypeCode: code });
      }

      if (brickCode !== null && level === GPC_LEVEL.AttributeValue && ancestry.attributeTypeCode !== null) {
        valueLinks.set(`${brickCode}:${ancestry.attributeTypeCode}:${code}`, {
          brickCode,
          attributeTypeCode: ancestry.attributeTypeCode,
          attributeValueCode: code,
        });
      }

      for (const child of node.Childs ?? []) {
        visit(child, {
          codes: ancestry.codes,
          titles,
          brickCode,
          attributeTypeCode: level === GPC_LEVEL.AttributeType ? code : ancestry.attributeTypeCode,
        });
      }
    };

    for (const segment of schema) {
      visit(segment, { codes: {}, titles: [], brickCode: null, attributeTypeCode: null });
    }

    return {
      nodes,
      attributes: [...attributes.values()],
      typeLinks: [...typeLinks.values()],
      valueLinks: [...valueLinks.values()],
    };
  }

  /**
   * Builds the text that represents a node in vector space.
   *
   * Structure matters as much as content, because the embedding pools over the whole string:
   *
   * - The node's own title leads, and is repeated once. A buyer searching "hammer" must land
   *   on Hammers, not on Anvils whose definition happens to mention hammers. Without the
   *   emphasis those two rank within 0.002 of each other.
   * - The ancestor path follows, because "Brushes" under Arts/Crafts and "Brushes" under
   *   Cleaning Products are different capabilities and a title-only embedding cannot tell
   *   them apart — exactly the confusion the resolver exists to prevent.
   * - The definition is truncated to its opening, which carries the meaning without the
   *   cross-referencing tail.
   *
   * `DefinitionExcludes` is deliberately omitted: it lists what a node is *not*, and
   * embeddings have no notion of negation, so including it pulls nodes toward the very
   * queries they should repel.
   */
  private buildEmbeddedText(titles: readonly string[], definition: string): string {
    const title = titles[titles.length - 1] ?? '';
    const ancestors = titles.slice(0, -1);

    const parts = [`${title}. ${title}.`];
    if (ancestors.length > 0) parts.push(`Category: ${ancestors.join(' > ')}.`);

    const trimmed = definition.trim();
    if (trimmed.length > 0) {
      parts.push(
        trimmed.length <= MAX_DEFINITION_CHARS ? trimmed : `${trimmed.slice(0, MAX_DEFINITION_CHARS)}…`,
      );
    }

    const text = parts.join(' ');

    return text.length <= MAX_EMBED_CHARS ? text : `${text.slice(0, MAX_EMBED_CHARS)}…`;
  }

  /**
   * Writes the hierarchy, then the attribute vocabulary, then the links between them.
   *
   * Order matters: link rows carry foreign keys to both, so writing them first would fail.
   */
  private async importNodes(parsed: ParsedTaxonomy): Promise<void> {
    const startedAt = Date.now();

    // Level order so a parent row always exists before a child references it.
    await this.taxonomy.upsertNodes([...parsed.nodes].sort((a, b) => a.level - b.level));
    await this.taxonomy.upsertAttributes(parsed.attributes);
    await this.taxonomy.upsertBrickAttributeTypes(parsed.typeLinks);
    await this.taxonomy.upsertBrickAttributeValues(parsed.valueLinks);

    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Import`,
      input: {
        nodes: parsed.nodes.length,
        attributes: parsed.attributes.length,
        typeLinks: parsed.typeLinks.length,
        valueLinks: parsed.valueLinks.length,
      },
      action: 'Upserted the hierarchy, attribute vocabulary and links, preserving existing embeddings',
      output: { imported: parsed.nodes.length + parsed.attributes.length },
      durationMs: Date.now() - startedAt,
    });
  }

  /**
   * Embeds every node at or above `embedToLevel` that still lacks a vector.
   *
   * Resumable by construction: an interrupted run leaves already-embedded nodes alone, so
   * re-running costs only the remainder rather than the whole taxonomy again.
   */
  private async embedPending(embedToLevel: number, force: boolean): Promise<number> {
    if (force) {
      // Clearing first makes `force` go through the same resumable path as a fresh import.
      const cleared = await this.taxonomy.clearEmbeddings(embedToLevel);

      this.logger.stage({
        component: COMPONENT,
        stage: `${STAGE}:Embed`,
        input: { force: true, embedToLevel },
        action: 'Cleared existing embeddings so every node is regenerated with the current model',
        output: { cleared },
      });
    }

    let embedded = 0;

    for (;;) {
      const pending = await this.taxonomy.findNodesNeedingEmbedding(embedToLevel, EMBEDDING_BATCH);
      if (pending.length === 0) break;

      const startedAt = Date.now();
      const vectors = await this.embeddings.embedBatch(pending.map((node) => node.embeddedText));

      await this.taxonomy.writeEmbeddings(
        pending.map((node, index) => ({ code: node.code, embedding: vectors[index] })),
      );

      embedded += pending.length;

      this.logger.stage({
        component: COMPONENT,
        stage: `${STAGE}:Embed`,
        input: { batch: pending.length, deepestLevel: embedToLevel },
        action: `Embedded ${pending.length} node(s) via ${this.embeddings.model}`,
        output: { embeddedSoFar: embedded, example: pending[0].title },
        durationMs: Date.now() - startedAt,
      });
    }

    return embedded;
  }
}
