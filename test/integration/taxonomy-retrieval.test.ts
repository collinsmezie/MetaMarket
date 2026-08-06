import { Test } from '@nestjs/testing';
import { PrismaTaxonomyRepository } from '../../src/adapters/outbound/persistence/prisma-taxonomy.repository';
import { PrismaService } from '../../src/adapters/outbound/persistence/prisma.service';
import { AppConfigService } from '../../src/config/app-config.service';
import { AppConfigModule } from '../../src/config/config.module';
import { GPC_LEVEL, type TaxonomyNodeInput } from '../../src/domain/ports/outbound/taxonomy-repository.port';

/**
 * Hybrid taxonomy retrieval, tested with controlled vectors rather than real embeddings.
 *
 * Real embeddings would make this suite cost money and drift with the model. What needs
 * locking down is *our* fusion logic — that a head-noun match beats a better-scoring
 * qualified variant, and that a mid-title slash alternative does not count as a head noun.
 * Both were live defects found against the real GPC data: "hammer" ranked Hammer Drills
 * first, and "wire" ranked a welding-consumables brick above Electrical Wires.
 */
describe('Taxonomy hybrid retrieval', () => {
  let prisma: PrismaService;
  let taxonomy: PrismaTaxonomyRepository;
  let dimension: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [PrismaService, PrismaTaxonomyRepository],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    taxonomy = moduleRef.get(PrismaTaxonomyRepository);
    dimension = moduleRef.get(AppConfigService).embeddingDimension;

    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.taxonomyNode.deleteMany();
  });

  /**
   * Builds a unit vector whose cosine similarity to `axis(0)` is controllable: index 0 holds
   * `strength`, index 1 holds the remainder, so similarity to the query vector is exactly
   * `strength`.
   */
  const vectorWithSimilarity = (strength: number): number[] => {
    const vector = new Array<number>(dimension).fill(0);
    vector[0] = strength;
    vector[1] = Math.sqrt(Math.max(0, 1 - strength * strength));
    return vector;
  };

  const queryVector = (): number[] => {
    const vector = new Array<number>(dimension).fill(0);
    vector[0] = 1;
    return vector;
  };

  const node = (
    overrides: Partial<TaxonomyNodeInput> & { code: string; title: string },
  ): TaxonomyNodeInput => ({
    level: GPC_LEVEL.Brick,
    definition: '',
    definitionExcludes: null,
    active: true,
    parentCode: null,
    segmentCode: null,
    familyCode: null,
    classCode: null,
    brickCode: overrides.code,
    embeddedText: overrides.title,
    ...overrides,
  });

  const seed = async (entries: readonly { node: TaxonomyNodeInput; similarity: number }[]) => {
    await taxonomy.upsertNodes(entries.map((entry) => entry.node));
    await taxonomy.writeEmbeddings(
      entries.map((entry) => ({
        code: entry.node.code,
        embedding: vectorWithSimilarity(entry.similarity),
      })),
    );
  };

  it('promotes a head-noun match above a qualified variant with a better vector score', async () => {
    await seed([
      // The variant is deliberately the stronger vector match, as it was in real data.
      { node: node({ code: '10003659', title: 'Hammer Drills (Powered)' }), similarity: 0.9 },
      { node: node({ code: '10003500', title: 'Hammers (DIY) (Non Powered)' }), similarity: 0.7 },
    ]);

    const matches = await taxonomy.search({
      embedding: queryVector(),
      text: 'hammer',
      limit: 5,
      minSimilarity: 0,
    });

    expect(matches[0].node.code).toBe('10003500');
    // The reported similarity stays the true cosine value; fusion reorders, it does not lie.
    expect(matches[0].similarity).toBeCloseTo(0.7, 3);
  });

  it('treats slash alternatives as head nouns when the title is slash-separated single words', async () => {
    await seed([
      {
        node: node({ code: '10003527', title: 'Wrenches/Spanners/Keys - Replacement Parts' }),
        similarity: 0.9,
      },
      { node: node({ code: '10003508', title: 'Wrenches/Spanners (Non Powered)' }), similarity: 0.7 },
    ]);

    const matches = await taxonomy.search({
      embedding: queryVector(),
      text: 'spanner',
      limit: 5,
      minSimilarity: 0,
    });

    expect(matches[0].node.code).toBe('10003508');
  });

  it('does not treat a mid-title slash alternative as a head noun', async () => {
    await seed([
      // "Wire" is one of the slash parts, but the title is not about wire.
      {
        node: node({ code: '10007937', title: 'Welding/Blow Torches Rods/Wire/Solder - Consumables' }),
        similarity: 0.6,
      },
      { node: node({ code: '10005541', title: 'Electrical Wires' }), similarity: 0.8 },
    ]);

    const matches = await taxonomy.search({
      embedding: queryVector(),
      text: 'wire',
      limit: 5,
      minSimilarity: 0,
    });

    expect(matches[0].node.code).toBe('10005541');
  });

  it('matches a head noun across singular and plural forms', async () => {
    await seed([{ node: node({ code: '10005211', title: 'Generators' }), similarity: 0.5 }]);

    const matches = await taxonomy.search({
      embedding: queryVector(),
      text: 'generator',
      limit: 5,
      minSimilarity: 0,
    });

    expect(matches[0].node.code).toBe('10005211');
  });

  it('falls back to pure vector ranking when no query text is supplied', async () => {
    await seed([
      { node: node({ code: '10003500', title: 'Hammers (DIY) (Non Powered)' }), similarity: 0.6 },
      { node: node({ code: '10003659', title: 'Hammer Drills (Powered)' }), similarity: 0.9 },
    ]);

    // Searching by a vendor DNA vector rather than typed words: no lexical arm applies.
    const matches = await taxonomy.search({ embedding: queryVector(), limit: 5, minSimilarity: 0 });

    expect(matches[0].node.code).toBe('10003659');
  });

  it('applies the similarity floor even to a lexical-only hit', async () => {
    await seed([
      // Shares the word but is semantically unrelated; must not ride in on the word alone.
      { node: node({ code: '99999999', title: 'Hammer' }), similarity: 0.1 },
      { node: node({ code: '10003500', title: 'Hammers (DIY) (Non Powered)' }), similarity: 0.8 },
    ]);

    const matches = await taxonomy.search({
      embedding: queryVector(),
      text: 'hammer',
      limit: 5,
      minSimilarity: 0.5,
    });

    expect(matches.map((match) => match.node.code)).toEqual(['10003500']);
  });

  it('excludes inactive nodes', async () => {
    await seed([
      { node: node({ code: '10003500', title: 'Hammers', active: false }), similarity: 0.95 },
      { node: node({ code: '10003659', title: 'Hammer Drills (Powered)' }), similarity: 0.6 },
    ]);

    const matches = await taxonomy.search({
      embedding: queryVector(),
      text: 'hammer',
      limit: 5,
      minSimilarity: 0,
    });

    expect(matches.map((match) => match.node.code)).toEqual(['10003659']);
  });

  it('restricts results to the requested levels', async () => {
    await seed([
      { node: node({ code: '70000000', title: 'Tools', level: GPC_LEVEL.Segment }), similarity: 0.95 },
      { node: node({ code: '10003500', title: 'Hammers' }), similarity: 0.6 },
    ]);

    const matches = await taxonomy.search({
      embedding: queryVector(),
      text: 'tools',
      limit: 5,
      minSimilarity: 0,
      levels: [GPC_LEVEL.Brick],
    });

    expect(matches.map((match) => match.node.code)).toEqual(['10003500']);
  });

  it('rejects a query embedding whose dimension does not match the index', async () => {
    await expect(taxonomy.search({ embedding: [1, 2, 3], limit: 5, minSimilarity: 0 })).rejects.toThrow(
      /dimensions/,
    );
  });

  it('preserves embeddings across a re-import of unchanged nodes', async () => {
    await seed([{ node: node({ code: '10003500', title: 'Hammers' }), similarity: 0.8 }]);

    // Re-importing must not discard vectors already paid for.
    await taxonomy.upsertNodes([node({ code: '10003500', title: 'Hammers' })]);

    expect(await taxonomy.countEmbedded()).toBe(1);
  });
});
