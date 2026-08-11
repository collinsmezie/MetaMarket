import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { CapabilityDiscoveryService } from '../src/application/capability/capability-discovery.service';

const prisma = new PrismaClient();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface NonWhatsappVendor {
  phone: string;
  businessName: string;
  city: string;
  state: string;
  statement: string;
  categoryType: string;
}

const VENDORS: NonWhatsappVendor[] = [
  // Group A: 5 Distinct Vendors with BROAD input statements (Domains / Business Description, NO single items/bricks)
  {
    phone: '2348011110001',
    businessName: 'Lagos General Household Provisions',
    city: 'Ikeja',
    state: 'Lagos',
    statement: 'I run a general merchant store supplying household provisions, groceries, and domestic supplies',
    categoryType: 'Broad Domain (Business Description)',
  },
  {
    phone: '2348011110002',
    businessName: 'Kano Agricultural Inputs & Machinery',
    city: 'Kano',
    state: 'Kano',
    statement: 'I am an agricultural dealer supplying farm inputs, crop protection, and farming machinery',
    categoryType: 'Broad Domain (Business Description)',
  },
  {
    phone: '2348011110003',
    businessName: 'Ibadan Motor Spare Parts Depot',
    city: 'Ibadan',
    state: 'Oyo',
    statement: 'I operate a motor spare parts dealership supplying vehicle components and automotive accessories',
    categoryType: 'Broad Domain (Business Description)',
  },
  {
    phone: '2348011110004',
    businessName: 'Abuja Commercial Stationery & Print',
    city: 'Wuse',
    state: 'Abuja',
    statement: 'I deal in commercial office stationery, printing paper, and office machinery',
    categoryType: 'Broad Domain (Business Description)',
  },
  {
    phone: '2348011110005',
    businessName: 'Port Harcourt Industrial Safety Gear',
    city: 'Port Harcourt',
    state: 'Rivers',
    statement: 'I am a wholesale distributor of industrial safety gear, personal protective equipment, and workshop apparel',
    categoryType: 'Broad Domain (Business Description)',
  },

  // Group B: 2 Distinct Vendors whose input statement contains ITEMS / BRICKS
  {
    phone: '2348011110006',
    businessName: 'Warri Building & Hardware Supplies',
    city: 'Warri',
    state: 'Delta',
    statement: 'I sell cement, roofing sheets, iron rods, PVC pipes, and masonry blocks',
    categoryType: 'Specific Items / Bricks',
  },
  {
    phone: '2348011110007',
    businessName: 'Enugu Solar & Electrical Store',
    city: 'Enugu',
    state: 'Enugu',
    statement: 'I sell solar panels, inverter batteries, copper cables, and circuit breakers',
    categoryType: 'Specific Items / Bricks',
  },

  // Group C: 2 Distinct Vendors whose input statement contains FAMILIES & CLASSES
  {
    phone: '2348011110008',
    businessName: 'Onitsha Healthcare & Medical Supplies',
    city: 'Onitsha',
    state: 'Anambra',
    statement: 'I deal in medical equipment, pharmaceutical drugs, first aid supplies, and healthcare consumables',
    categoryType: 'GPC Families & Classes',
  },
  {
    phone: '2348011110009',
    businessName: 'Kaduna Footwear & Luggage Emporium',
    city: 'Kaduna',
    state: 'Kaduna',
    statement: 'I supply footwear, leather goods, travel luggage, and mens apparel',
    categoryType: 'GPC Families & Classes',
  },

  // Group D: 1 Vendor whose input statement contains a COMBINATION of GPC layers
  {
    phone: '2348011110010',
    businessName: 'Benin Multi-Trade Hardware & Electricals',
    city: 'Benin City',
    state: 'Edo',
    statement: 'I run a building products and electrical store selling generator spare parts, LED bulbs, 2.5mm copper wire, and roofing sheets',
    categoryType: 'Combination of GPC Layers',
  },
];

async function exportSellerRecords() {
  const vendors = await prisma.vendor.findMany({
    include: {
      capabilities: {
        orderBy: { confidence: 'desc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const lines: string[] = [];
  lines.push('# MetaMarket Seller Data Records — Clean Non-WhatsApp Live CDE Test');
  lines.push('');
  lines.push('Full database records for 10 distinct vendors onboarded via the non-WhatsApp CDE pipeline context.');
  lines.push('');
  lines.push(`- **Snapshot taken:** ${new Date().toISOString()}`);
  lines.push('- **Pipeline:** Non-WhatsApp CDE Direct Onboarding → BusinessUnderstanding → Contextualized Retrieval → CDE Capability DNA');
  lines.push(`- **Total Vendors:** ${vendors.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  vendors.forEach((v, index) => {
    const num = index + 1;
    lines.push(`## ${num}. ${v.businessName} (${v.userId})`);
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|---|---|');
    lines.push(`| business_name | ${v.businessName} |`);
    lines.push(`| vendor_id | \`${v.id}\` |`);
    lines.push(`| user_id | \`${v.userId}\` |`);
    lines.push(`| status | ${v.status} |`);
    lines.push(`| city / state | ${v.city} / ${v.state} |`);
    lines.push(`| conversation_summary | ${v.conversationSummary} |`);
    lines.push(`| total_capabilities | ${v.capabilities.length} |`);
    lines.push(`| wallet_balance | 2000 credits |`);
    lines.push(`| created_at | ${v.createdAt.toISOString()} |`);
    lines.push('');
    lines.push(`### ${num}.1 Capability DNA (\`vendor_capabilities\`) — ${v.capabilities.length} Total`);
    lines.push('');
    lines.push('| Capability Name | Capability ID | Confidence | Type | Log Odds |');
    lines.push('|---|---|---|---|---|');

    v.capabilities.forEach((c) => {
      const type = c.inferred ? 'Taxonomy Inferred' : 'Direct Statement';
      const confPct = (c.confidence * 100).toFixed(1) + '% (' + c.confidence.toFixed(3) + ')';
      lines.push(`| ${c.capabilityName} | \`${c.capabilityId}\` | ${confPct} | ${type} | ${c.logOdds.toFixed(4)} |`);
    });

    lines.push('');
    lines.push('---');
    lines.push('');
  });

  const filePath = path.join(__dirname, '../opencode/seller-records.md');
  fs.writeFileSync(filePath, lines.join('\n'));
  console.log(`\n✓ Exported updated clean seller records to ${filePath}`);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║       MetaMarket Non-WhatsApp Vendor Onboarding & CDE Verification ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  console.log('\n[1/3] Clearing previous vendor records from PostgreSQL database...');
  await prisma.vendorCapability.deleteMany({});
  await prisma.capabilityEvidence.deleteMany({});
  await prisma.vendor.deleteMany({});
  await prisma.conversation.deleteMany({});
  console.log('✓ Database cleared.');

  console.log('\n[2/3] Initializing NestJS application context...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const discoveryService = app.get(CapabilityDiscoveryService);
  console.log('✓ NestJS CDE Application Context initialized.');

  console.log(`\n[3/3] Onboarding 10 vendors across specified input scenarios...\n`);

  for (let i = 0; i < VENDORS.length; i++) {
    const v = VENDORS[i];
    const vendorStart = Date.now();
    console.log(`─`.repeat(70));
    console.log(`[${i + 1}/10] Onboarding Vendor: "${v.businessName}"`);
    console.log(`      Scenario Category: ${v.categoryType}`);
    console.log(`      Input Statement: "${v.statement}"`);

    // Create vendor shell with unique conversation ID
    const conversationId = randomUUID();
    
    await prisma.conversation.create({
      data: {
        id: conversationId,
        userId: v.phone,
        lastChannel: 'api',
      },
    });

    const dbVendor = await prisma.vendor.create({
      data: {
        userId: v.phone,
        conversationId,
        businessName: v.businessName,
        city: v.city,
        state: v.state,
        status: 'active',
        conversationSummary: `${v.businessName} located in ${v.city}, ${v.state}. ${v.statement}`,
      },
    });

    // Pass through CDE observeStatement
    const result = await discoveryService.observeStatement({
      vendorId: dbVendor.id,
      statement: v.statement,
      source: 'onboarding_statement',
      conversationId,
    });

    const duration = Date.now() - vendorStart;
    console.log(`    → Resolved ${result.dna.beliefs.length} capability signals in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    console.log(`    → Top Capabilities:`);
    result.dna.beliefs.slice(0, 4).forEach((b) => {
      console.log(`       • ${b.capability.name} (${(b.confidence * 100).toFixed(1)}%)`);
    });

    // Pacing between vendors
    if (i < VENDORS.length - 1) {
      await sleep(2500);
    }
  }

  await exportSellerRecords();

  await app.close();
}

main()
  .catch((e) => {
    console.error('Error during non-whatsapp vendor onboarding:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
