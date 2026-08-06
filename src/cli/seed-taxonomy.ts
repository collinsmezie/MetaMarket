import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AppConfigService } from '../config/app-config.service';
import { TaxonomySeeder } from '../application/taxonomy/taxonomy-seeder.service';
import { GPC_LEVEL } from '../domain/ports/outbound/taxonomy-repository.port';

/**
 * Imports the GS1 GPC taxonomy and builds its semantic index.
 *
 *   npm run seed:taxonomy -- --dry-run          inspect the file, write nothing
 *   npm run seed:taxonomy                        import + embed to Brick (level 4)
 *   npm run seed:taxonomy -- --embed-to-level 6  also embed attributes (≈30× the cost)
 *   npm run seed:taxonomy -- --force             re-embed everything
 *
 * Runs as a standalone Nest context so it reuses the same adapters, configuration and
 * validation as the server, rather than a parallel script with its own database client.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');

  const levelFlag = argv.indexOf('--embed-to-level');
  const embedToLevel = levelFlag === -1 ? GPC_LEVEL.Brick : Number.parseInt(argv[levelFlag + 1] ?? '', 10);

  if (!Number.isInteger(embedToLevel) || embedToLevel < 1 || embedToLevel > 6) {
    console.error('--embed-to-level must be an integer from 1 (Segment) to 6 (Attribute Value).');
    process.exit(1);
  }

  const fileFlag = argv.indexOf('--file');

  // `logger: false` silences Nest's boot chatter so the stage logs are the output.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const config = app.get(AppConfigService);
    const seeder = app.get(TaxonomySeeder);
    const filePath = fileFlag === -1 ? config.taxonomy.gs1GpcFile : (argv[fileFlag + 1] ?? '');

    if (!dryRun && config.openai.apiKey === undefined) {
      console.error(
        'OPENAI_API_KEY is required to generate embeddings. Set it, or re-run with --dry-run to inspect the file only.',
      );
      process.exit(1);
    }

    const result = await seeder.seed({ filePath, embedToLevel, dryRun, force });

    console.log('\n─── GS1 GPC import ───────────────────────────────────────────');
    console.log(`  source            : ${filePath}`);
    console.log(`  sha256            : ${result.sourceSha256.slice(0, 16)}…`);
    console.log(`  language / date   : ${result.languageCode} / ${result.publishedOn}`);
    console.log(`  nodes parsed      : ${result.nodesParsed.toLocaleString()}`);

    for (const [level, count] of Object.entries(result.nodesByLevel).sort()) {
      console.log(`    level ${level} (${levelName(Number(level))}): ${count.toLocaleString()}`);
    }

    console.log(`  hierarchy nodes   : ${result.nodesImported.toLocaleString()} (levels 1-4)`);
    console.log(
      `  distinct attrs    : ${result.attributesImported.toLocaleString()} (levels 5-6, deduplicated)`,
    );
    console.log(`  brick↔attr links  : ${result.attributeLinksImported.toLocaleString()}`);
    console.log(
      `  nodes embedded    : ${result.nodesEmbedded.toLocaleString()} (to level ${result.embeddedToLevel})`,
    );
    console.log(`  embedding model   : ${result.embeddingModel}`);
    if (result.dryRun) console.log('  DRY RUN — nothing was written.');
    console.log('──────────────────────────────────────────────────────────────\n');
  } finally {
    await app.close();
  }
}

function levelName(level: number): string {
  return ['Segment', 'Family', 'Class', 'Brick', 'Attribute Type', 'Attribute Value'][level - 1] ?? 'Unknown';
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
