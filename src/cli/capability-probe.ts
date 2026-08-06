import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BusinessUnderstandingService } from '../application/capability/business-understanding.service';
import { CapabilityResolver } from '../application/capability/capability-resolver.service';
import { AppConfigService } from '../config/app-config.service';

/**
 * Runs a vendor statement through the Capability Discovery Engine and prints what it would
 * conclude — understanding, archetype expansion and canonical resolution — without touching
 * any vendor record.
 *
 * Read-only by design: the point is to inspect the engine's judgement on real phrasings before
 * trusting it with a real seller's profile.
 *
 *   node dist/cli/capability-probe.js "I sell household items"
 *   node dist/cli/capability-probe.js "I repair generators" "I sell buckets, basins and mops"
 */
async function main(): Promise<void> {
  const statements = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

  if (statements.length === 0) {
    console.error('Usage: node dist/cli/capability-probe.js "<vendor statement>" ...');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    const config = app.get(AppConfigService);

    if (config.openai.apiKey === undefined) {
      console.error('OPENAI_API_KEY is required: this probe deliberately exercises the real model.');
      process.exit(1);
    }

    const understanding = app.get(BusinessUnderstandingService);
    const resolver = app.get(CapabilityResolver);

    for (const statement of statements) {
      console.log(`\n${'─'.repeat(78)}`);
      console.log(`VENDOR: "${statement}"`);
      console.log('─'.repeat(78));

      const understood = await understanding.understand({ statement });

      console.log(`  expression type   : ${understood.expressionType}`);
      console.log(`  information density: ${understood.informationDensity}`);
      console.log(
        `  archetype         : ${understood.businessArchetype} (${understood.archetypeConfidence.toFixed(2)})`,
      );
      console.log(`  ambiguity         : ${understood.ambiguityScore.toFixed(2)}`);

      if (understood.clarificationQuestion.length > 0) {
        console.log(`  would ask         : "${understood.clarificationQuestion}"`);
      }

      const stated = [...understood.products, ...understood.services].filter((item) => item.stated);
      const implied = [...understood.products, ...understood.services].filter((item) => !item.stated);

      console.log(`\n  STATED  : ${stated.map((item) => item.term).join(', ') || '(none)'}`);
      console.log(
        `  IMPLIED : ${implied.map((item) => `${item.term} (${item.confidence.toFixed(2)})`).join(', ') || '(none)'}`,
      );

      const [products, services] = await Promise.all([
        resolver.resolveProducts(understood.products.map((product) => product.term)),
        resolver.resolveServices(understood.services.map((service) => service.term).join('; ')),
      ]);

      if (products.length > 0) {
        console.log('\n  RESOLVED PRODUCT CAPABILITIES (GS1 GPC):');
        for (const item of products) {
          console.log(`    ${item.confidence.toFixed(2)}  ${item.capability.name}  (${item.capability.id})`);
        }
      }

      if (services.length > 0) {
        console.log('\n  RESOLVED SERVICE CAPABILITIES (registry):');
        for (const item of services) {
          console.log(`    ${item.confidence.toFixed(2)}  ${item.capability.name}  (${item.capability.id})`);
        }
      }

      if (products.length === 0 && services.length === 0) {
        console.log('\n  No canonical capability could be resolved.');
      }
    }

    console.log();
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
