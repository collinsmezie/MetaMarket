import { PrismaClient, MkgLifecycleState } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '_')
    .replace(/^-+|-+$/g, '');
}

function computeMkgIdempotencyKey(
  decisionId: string,
  operation: string,
  subjectId: string,
  predicate: string,
  objectId: string,
): string {
  return createHash('sha256')
    .update(`${decisionId}:${operation}:${subjectId}:${predicate}:${objectId}`)
    .digest('hex');
}

async function main() {
  console.log('🌱 Starting MetaMarket Production Database Seeding (Approach A)...');
  const startTime = Date.now();

  const dataPath = path.join(__dirname, 'seed-vendors-data.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Seed data file not found at: ${dataPath}`);
  }

  const vendorsData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  console.log(`📦 Loaded ${vendorsData.length} vendors from seed data.`);

  let vendorsUpserted = 0;
  let capabilitiesUpserted = 0;
  let walletsUpserted = 0;
  let mkgNodesUpserted = 0;
  let mkgEdgesUpserted = 0;

  for (const v of vendorsData) {
    // 1. Ensure Conversation Aggregate exists for user
    const conversation = await prisma.conversation.upsert({
      where: { userId: v.phone },
      update: {
        lastChannel: 'whatsapp',
        memorySummary: v.summary ?? '',
      },
      create: {
        userId: v.phone,
        lastChannel: 'whatsapp',
        memorySummary: v.summary ?? '',
      },
    });

    // 2. Upsert Vendor Profile
    const vendor = await prisma.vendor.upsert({
      where: { userId: v.phone },
      update: {
        conversationId: conversation.id,
        businessName: v.businessName,
        contactPhone: v.phone,
        city: v.city,
        state: v.state,
        country: 'Nigeria',
        status: 'active',
        locationConfidence: 1.0,
        declaredProducts: v.declaredProducts,
        declaredServices: v.declaredServices ?? [],
        conversationSummary: v.summary ?? '',
        onboardedAt: new Date(),
      },
      create: {
        userId: v.phone,
        conversationId: conversation.id,
        businessName: v.businessName,
        contactPhone: v.phone,
        city: v.city,
        state: v.state,
        country: 'Nigeria',
        status: 'active',
        locationConfidence: 1.0,
        declaredProducts: v.declaredProducts,
        declaredServices: v.declaredServices ?? [],
        conversationSummary: v.summary ?? '',
        onboardedAt: new Date(),
      },
    });
    vendorsUpserted++;

    // 3. Upsert Credit Wallet (2000 initial onboarding grant)
    await prisma.creditWallet.upsert({
      where: { userId: v.phone },
      update: {}, // preserve existing balance if already provisioned
      create: {
        userId: v.phone,
        conversationId: conversation.id,
        balanceCredits: 2000,
        currency: 'NGN',
      },
    });
    walletsUpserted++;

    // 4. Upsert Vendor Capabilities
    for (const cap of v.capabilities) {
      await prisma.vendorCapability.upsert({
        where: {
          vendorId_capabilityDomain_capabilityId: {
            vendorId: vendor.id,
            capabilityDomain: cap.domain,
            capabilityId: cap.id,
          },
        },
        update: {
          capabilityName: cap.name,
          confidence: cap.confidence ?? 0.85,
          logOdds: cap.logOdds ?? 1.73,
          inferred: cap.inferred ?? false,
          lastObservedAt: new Date(),
        },
        create: {
          vendorId: vendor.id,
          capabilityDomain: cap.domain,
          capabilityId: cap.id,
          capabilityName: cap.name,
          confidence: cap.confidence ?? 0.85,
          logOdds: cap.logOdds ?? 1.73,
          inferred: cap.inferred ?? false,
          evidenceCount: 1,
          lastObservedAt: new Date(),
        },
      });
      capabilitiesUpserted++;
    }

    // 5. Upsert MKG Actor & Context Nodes
    const actorId = `actor:vendor:${vendor.id}`;
    const citySlug = slugify(v.city || 'nigeria');
    const locationId = `context:location:${citySlug}`;

    await prisma.mkgNode.upsert({
      where: { id: actorId },
      update: {
        label: vendor.businessName,
        description: vendor.conversationSummary ?? undefined,
        status: 'ACTIVE',
      },
      create: {
        id: actorId,
        nodeType: 'ACTOR',
        label: vendor.businessName,
        description: vendor.conversationSummary ?? undefined,
        status: 'ACTIVE',
      },
    });
    mkgNodesUpserted++;

    await prisma.mkgNode.upsert({
      where: { id: locationId },
      update: { label: v.city, status: 'ACTIVE' },
      create: {
        id: locationId,
        nodeType: 'CONTEXT',
        label: v.city,
        status: 'ACTIVE',
      },
    });
    mkgNodesUpserted++;

    // Edge: Vendor -> LOCATED_IN -> City
    const locIdempKey = computeMkgIdempotencyKey(
      `seed_loc_${vendor.id}`,
      'ADD',
      actorId,
      'mkg:LOCATED_IN',
      locationId,
    );
    await prisma.mkgEdge.upsert({
      where: {
        mkg_edge_unique_triple: {
          subjectId: actorId,
          predicate: 'mkg:LOCATED_IN',
          objectId: locationId,
        },
      },
      update: {
        beliefScore: 1.0,
        lifecycleState: MkgLifecycleState.ACTIVE,
        decisionId: `seed_loc_${vendor.id}`,
        idempotencyKey: locIdempKey,
      },
      create: {
        subjectId: actorId,
        predicate: 'mkg:LOCATED_IN',
        objectId: locationId,
        beliefScore: 1.0,
        priorScore: 1.0,
        lifecycleState: MkgLifecycleState.ACTIVE,
        decisionId: `seed_loc_${vendor.id}`,
        idempotencyKey: locIdempKey,
      },
    });
    mkgEdgesUpserted++;

    // Edge: Vendor -> SUPPLIES -> Declared Products
    for (const prod of v.declaredProducts) {
      const prodSlug = slugify(prod);
      const conceptId = `concept:${prodSlug}`;

      await prisma.mkgNode.upsert({
        where: { id: conceptId },
        update: { label: prod, status: 'ACTIVE' },
        create: {
          id: conceptId,
          nodeType: 'CONCEPT',
          label: prod,
          status: 'ACTIVE',
        },
      });
      mkgNodesUpserted++;

      const prodIdempKey = computeMkgIdempotencyKey(
        `seed_prod_${vendor.id}_${prodSlug}`,
        'ADD',
        actorId,
        'mkg:SUPPLIES',
        conceptId,
      );
      await prisma.mkgEdge.upsert({
        where: {
          mkg_edge_unique_triple: {
            subjectId: actorId,
            predicate: 'mkg:SUPPLIES',
            objectId: conceptId,
          },
        },
        update: {
          beliefScore: 0.95,
          lifecycleState: MkgLifecycleState.ACTIVE,
          decisionId: `seed_prod_${vendor.id}_${prodSlug}`,
          idempotencyKey: prodIdempKey,
        },
        create: {
          subjectId: actorId,
          predicate: 'mkg:SUPPLIES',
          objectId: conceptId,
          beliefScore: 0.95,
          priorScore: 0.95,
          lifecycleState: MkgLifecycleState.ACTIVE,
          decisionId: `seed_prod_${vendor.id}_${prodSlug}`,
          idempotencyKey: prodIdempKey,
        },
      });
      mkgEdgesUpserted++;
    }

    // Edge: Vendor -> SUPPLIES -> Primary GPC Bricks
    for (const cap of v.capabilities.filter((c: any) => !c.inferred && c.domain === 'product')) {
      const brickNodeId = `gpc:brick:${cap.id}`;

      await prisma.mkgNode.upsert({
        where: { id: brickNodeId },
        update: { label: cap.name, status: 'ACTIVE' },
        create: {
          id: brickNodeId,
          nodeType: 'CONCEPT',
          label: cap.name,
          status: 'ACTIVE',
        },
      });
      mkgNodesUpserted++;

      const brickIdempKey = computeMkgIdempotencyKey(
        `seed_brick_${vendor.id}_${cap.id}`,
        'ADD',
        actorId,
        'mkg:SUPPLIES',
        brickNodeId,
      );
      await prisma.mkgEdge.upsert({
        where: {
          mkg_edge_unique_triple: {
            subjectId: actorId,
            predicate: 'mkg:SUPPLIES',
            objectId: brickNodeId,
          },
        },
        update: {
          beliefScore: cap.confidence ?? 0.9,
          lifecycleState: MkgLifecycleState.ACTIVE,
          decisionId: `seed_brick_${vendor.id}_${cap.id}`,
          idempotencyKey: brickIdempKey,
        },
        create: {
          subjectId: actorId,
          predicate: 'mkg:SUPPLIES',
          objectId: brickNodeId,
          beliefScore: cap.confidence ?? 0.9,
          priorScore: cap.confidence ?? 0.9,
          lifecycleState: MkgLifecycleState.ACTIVE,
          decisionId: `seed_brick_${vendor.id}_${cap.id}`,
          idempotencyKey: brickIdempKey,
        },
      });
      mkgEdgesUpserted++;
    }
  }

  // 6. Seed Foundational Commercial Knowledge Relationships (TDR §28.1 Scenarios)
  console.log('🔗 Seeding foundational MKG commercial graph edges...');
  const foundationalEdges = [
    {
      decisionId: 'seed_phrase_hot_flask',
      subId: 'phrase:hot_flask',
      subType: 'PHRASE',
      subLabel: 'hot flask',
      pred: 'mkg:EXPRESSES',
      objId: 'concept:vacuum_flask',
      objType: 'CONCEPT',
      objLabel: 'vacuum flask',
      score: 0.95,
      locality: 'Nigeria',
    },
    {
      decisionId: 'seed_rel_drill_bit',
      subId: 'concept:drill_bit',
      subType: 'CONCEPT',
      subLabel: 'drill bit',
      pred: 'mkg:ACCESSORY_OF',
      objId: 'concept:drill',
      objType: 'CONCEPT',
      objLabel: 'rotary drill',
      score: 0.92,
    },
    {
      decisionId: 'seed_phrase_phone_pouch',
      subId: 'phrase:phone_pouch',
      subType: 'PHRASE',
      subLabel: 'phone pouch',
      pred: 'mkg:EXPRESSES',
      objId: 'concept:phone_case',
      objType: 'CONCEPT',
      objLabel: 'phone case',
      score: 0.95,
      locality: 'Nigeria',
    },
    {
      decisionId: 'seed_acc_phone_case',
      subId: 'concept:phone_case',
      subType: 'CONCEPT',
      subLabel: 'phone case',
      pred: 'mkg:ACCESSORY_OF',
      objId: 'concept:smartphone',
      objType: 'CONCEPT',
      objLabel: 'smartphone',
      score: 0.95,
    },
    {
      decisionId: 'seed_sub_phone_pouch',
      subId: 'concept:phone_case',
      subType: 'CONCEPT',
      subLabel: 'phone case',
      pred: 'mkg:SUBSTITUTE_FOR',
      objId: 'concept:phone_pouch',
      objType: 'CONCEPT',
      objLabel: 'phone pouch',
      score: 0.90,
    },
    {
      decisionId: 'seed_com_plug_socket',
      subId: 'concept:plug',
      subType: 'CONCEPT',
      subLabel: 'electrical plug',
      pred: 'mkg:COMMONLY_SOLD_WITH',
      objId: 'concept:socket',
      objType: 'CONCEPT',
      objLabel: 'wall socket',
      score: 0.88,
    },
    {
      decisionId: 'seed_acc_car_charger',
      subId: 'concept:car_charger',
      subType: 'CONCEPT',
      subLabel: 'car charger',
      pred: 'mkg:ACCESSORY_OF',
      objId: 'concept:smartphone',
      objType: 'CONCEPT',
      objLabel: 'smartphone',
      score: 0.92,
    },
  ];

  for (const edge of foundationalEdges) {
    await prisma.mkgNode.upsert({
      where: { id: edge.subId },
      update: { label: edge.subLabel, status: 'ACTIVE' },
      create: { id: edge.subId, nodeType: edge.subType as any, label: edge.subLabel, status: 'ACTIVE' },
    });
    await prisma.mkgNode.upsert({
      where: { id: edge.objId },
      update: { label: edge.objLabel, status: 'ACTIVE' },
      create: { id: edge.objId, nodeType: edge.objType as any, label: edge.objLabel, status: 'ACTIVE' },
    });

    const idempKey = computeMkgIdempotencyKey(edge.decisionId, 'ADD', edge.subId, edge.pred, edge.objId);
    await prisma.mkgEdge.upsert({
      where: {
        mkg_edge_unique_triple: {
          subjectId: edge.subId,
          predicate: edge.pred,
          objectId: edge.objId,
        },
      },
      update: {
        beliefScore: edge.score,
        lifecycleState: MkgLifecycleState.ACTIVE,
        decisionId: edge.decisionId,
        idempotencyKey: idempKey,
      },
      create: {
        subjectId: edge.subId,
        predicate: edge.pred,
        objectId: edge.objId,
        beliefScore: edge.score,
        priorScore: edge.score,
        lifecycleState: MkgLifecycleState.ACTIVE,
        locality: edge.locality ?? null,
        decisionId: edge.decisionId,
        idempotencyKey: idempKey,
      },
    });
    mkgEdgesUpserted++;
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n======================================================`);
  console.log(`✅ Production Seeding Completed in ${durationSec}s!`);
  console.log(`   - Vendors: ${vendorsUpserted}`);
  console.log(`   - Capabilities: ${capabilitiesUpserted}`);
  console.log(`   - Wallets: ${walletsUpserted} verified`);
  console.log(`   - MKG Nodes: ${mkgNodesUpserted}`);
  console.log(`   - MKG Edges: ${mkgEdgesUpserted}`);
  console.log(`======================================================\n`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
