import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../domain/ports/outbound/embedding-provider.port';
import {
  GPC_LEVEL,
  TAXONOMY_REPOSITORY,
  type TaxonomyRepositoryPort,
} from '../domain/ports/outbound/taxonomy-repository.port';

/**
 * Queries the embedded GS1 GPC taxonomy in the way the Capability Resolver will.
 *
 * Exists to make retrieval quality inspectable rather than assumed: a taxonomy that imported
 * cleanly but embeds poorly would silently produce bad vendor matches for every search.
 *
 *   node dist/cli/taxonomy-search.js "hammer"
 *   node dist/cli/taxonomy-search.js --level 4 --limit 5 "the thing used to tighten bolts"
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  const limitFlag = argv.indexOf('--limit');
  const limit = limitFlag === -1 ? 5 : Number.parseInt(argv[limitFlag + 1] ?? '5', 10);

  const levelFlag = argv.indexOf('--level');
  const levels = levelFlag === -1 ? undefined : [Number.parseInt(argv[levelFlag + 1] ?? '4', 10)];

  const queries = argv.filter(
    (arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--limit' && argv[index - 1] !== '--level',
  );

  if (queries.length === 0) {
    console.error('Usage: node dist/cli/taxonomy-search.js [--level N] [--limit N] "<query>" ...');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    const embeddings = app.get<EmbeddingProviderPort>(EMBEDDING_PROVIDER);
    const taxonomy = app.get<TaxonomyRepositoryPort>(TAXONOMY_REPOSITORY);

    const embedded = await taxonomy.countEmbedded();
    if (embedded === 0) {
      console.error('The taxonomy has no embeddings yet. Run `npm run seed:taxonomy` first.');
      process.exit(1);
    }

    console.log(`Searching ${embedded.toLocaleString()} embedded GPC nodes\n`);

    for (const query of queries) {
      const vector = await embeddings.embed(query);
      const matches = await taxonomy.search({
        embedding: vector,
        // Passing the raw text enables the lexical arm of hybrid retrieval.
        text: query,
        limit,
        // Deliberately permissive: the point is to see the ranking, including weak matches.
        minSimilarity: 0,
        ...(levels !== undefined ? { levels } : {}),
      });

      console.log(`"${query}"`);

      if (matches.length === 0) {
        console.log('  (no matches)\n');
        continue;
      }

      for (const match of matches) {
        const level = levelName(match.node.level);
        console.log(`  ${match.similarity.toFixed(3)}  [${level}] ${match.node.title}  (${match.node.code})`);
      }
      console.log();
    }
  } finally {
    await app.close();
  }
}

function levelName(level: number): string {
  switch (level) {
    case GPC_LEVEL.Segment:
      return 'Segment';
    case GPC_LEVEL.Family:
      return 'Family ';
    case GPC_LEVEL.Class:
      return 'Class  ';
    case GPC_LEVEL.Brick:
      return 'Brick  ';
    default:
      return `L${level}`;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
