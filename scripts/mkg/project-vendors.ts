import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { CapabilityProjectionService } from '../../src/mkg/application/capability-projection.service';
import { PrismaMkgAdapter } from '../../src/mkg/adapters/persistence/prisma-mkg.adapter';
import { MKG_PREDICATES } from '../../src/mkg/domain/mkg-vocabulary';

async function main() {
  console.log('🚀 Bootstrapping MetaMarket context for MKG Vendor & Foundational Projection...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });

  try {
    const projection = app.get(CapabilityProjectionService);
    const mkgAdapter = app.get(PrismaMkgAdapter);

    console.log('📦 Projecting all existing database vendors into MKG...');
    const result = await projection.projectAllVendors();
    console.log(`✅ Projected ${result.totalVendors} vendors into MKG (${result.totalEdges} edges created).`);

    console.log('🔗 Seeding foundational commercial relationships (TDR §28.1 Scenarios)...');
    
    // Scenario A & Nigerian language: "hot flask" expresses vacuum flask
    await mkgAdapter.upsertNode({ id: 'phrase:hot_flask', nodeType: 'PHRASE', label: 'hot flask' });
    await mkgAdapter.upsertNode({ id: 'concept:vacuum_flask', nodeType: 'CONCEPT', label: 'vacuum flask' });
    await mkgAdapter.applyGraphChange({
      decisionId: 'seed_phrase_hot_flask',
      operation: 'ADD',
      subjectId: 'phrase:hot_flask',
      predicate: MKG_PREDICATES.EXPRESSES,
      objectId: 'concept:vacuum_flask',
      beliefScore: 0.95,
      locality: 'Nigeria',
    });

    // Scenario B: Drill Bit -> ACCESSORY_OF -> Drill
    await mkgAdapter.upsertNode({ id: 'concept:drill_bit', nodeType: 'CONCEPT', label: 'drill bit' });
    await mkgAdapter.upsertNode({ id: 'concept:drill', nodeType: 'CONCEPT', label: 'rotary drill' });
    await mkgAdapter.applyGraphChange({
      decisionId: 'seed_rel_drill_bit',
      operation: 'ADD',
      subjectId: 'concept:drill_bit',
      predicate: MKG_PREDICATES.ACCESSORY_OF,
      objectId: 'concept:drill',
      beliefScore: 0.92,
    });

    // User Scenario: "pouch" / "phone pouch" is accessory of smartphone / substitute for phone case
    await mkgAdapter.upsertNode({ id: 'phrase:phone_pouch', nodeType: 'PHRASE', label: 'phone pouch' });
    await mkgAdapter.upsertNode({ id: 'concept:phone_case', nodeType: 'CONCEPT', label: 'phone case', aliases: ['phone pouch', 'pouch'] });
    await mkgAdapter.upsertNode({ id: 'concept:smartphone', nodeType: 'CONCEPT', label: 'smartphone', aliases: ['mobile phone', 'phone'] });
    
    await mkgAdapter.applyGraphChange({
      decisionId: 'seed_phrase_phone_pouch',
      operation: 'ADD',
      subjectId: 'phrase:phone_pouch',
      predicate: MKG_PREDICATES.EXPRESSES,
      objectId: 'concept:phone_case',
      beliefScore: 0.95,
      locality: 'Nigeria',
    });

    await mkgAdapter.applyGraphChange({
      decisionId: 'seed_rel_phone_case_accessory',
      operation: 'ADD',
      subjectId: 'concept:phone_case',
      predicate: MKG_PREDICATES.ACCESSORY_OF,
      objectId: 'concept:smartphone',
      beliefScore: 0.95,
    });

    // Commonly sold with: Plug & Socket
    await mkgAdapter.upsertNode({ id: 'concept:plug', nodeType: 'CONCEPT', label: 'electrical plug' });
    await mkgAdapter.upsertNode({ id: 'concept:socket', nodeType: 'CONCEPT', label: 'wall socket' });
    await mkgAdapter.applyGraphChange({
      decisionId: 'seed_rel_plug_socket',
      operation: 'ADD',
      subjectId: 'concept:plug',
      predicate: MKG_PREDICATES.COMMONLY_SOLD_WITH,
      objectId: 'concept:socket',
      beliefScore: 0.88,
    });

    console.log('🎉 MKG vendor capability and relationship seeding complete!');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('❌ Error during MKG projection:', err);
  process.exit(1);
});
