import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { CapabilityDiscoveryService } from '../src/application/capability/capability-discovery.service';

const prisma = new PrismaClient();

const NEW_VENDOR = {
  phone: '2348011110011',
  businessName: 'Enugu Sports Equipment & Materials',
  city: 'Enugu',
  state: 'Enugu',
  statement: 'I sell sports materials',
  categoryType: 'Short / Broad Domain Statement ("I sell sports materials")',
};

const VENDORS_MAP = new Map([
  ['2348011110001', { statement: 'I run a general merchant store supplying household provisions, groceries, and domestic supplies', category: 'Broad Domain (Business Description)' }],
  ['2348011110002', { statement: 'I am an agricultural dealer supplying farm inputs, crop protection, and farming machinery', category: 'Broad Domain (Business Description)' }],
  ['2348011110003', { statement: 'I operate a motor spare parts dealership supplying vehicle components and automotive accessories', category: 'Broad Domain (Business Description)' }],
  ['2348011110004', { statement: 'I deal in commercial office stationery, printing paper, and office machinery', category: 'Broad Domain (Business Description)' }],
  ['2348011110005', { statement: 'I am a wholesale distributor of industrial safety gear, personal protective equipment, and workshop apparel', category: 'Broad Domain (Business Description)' }],
  ['2348011110006', { statement: 'I sell cement, roofing sheets, iron rods, PVC pipes, and masonry blocks', category: 'Specific Items / Bricks' }],
  ['2348011110007', { statement: 'I sell solar panels, inverter batteries, copper cables, and circuit breakers', category: 'Specific Items / Bricks' }],
  ['2348011110008', { statement: 'I deal in medical equipment, pharmaceutical drugs, first aid supplies, and healthcare consumables', category: 'GPC Families & Classes' }],
  ['2348011110009', { statement: 'I supply footwear, leather goods, travel luggage, and mens apparel', category: 'GPC Families & Classes' }],
  ['2348011110010', { statement: 'I run a building products and electrical store selling generator spare parts, LED bulbs, 2.5mm copper wire, and roofing sheets', category: 'Combination of GPC Layers' }],
  ['2348011110011', { statement: 'I sell sports materials', category: 'Short / Ambiguous Domain Input' }],
]);

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
  lines.push(`Full database records for ${vendors.length} distinct vendors onboarded via the non-WhatsApp CDE pipeline context.`);
  lines.push('');
  lines.push(`- **Snapshot taken:** ${new Date().toISOString()}`);
  lines.push('- **Pipeline:** Non-WhatsApp CDE Direct Onboarding → BusinessUnderstanding → Contextualized Retrieval → CDE Capability DNA');
  lines.push(`- **Total Vendors:** ${vendors.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  vendors.forEach((v, index) => {
    const num = index + 1;
    const info = VENDORS_MAP.get(v.userId);
    lines.push(`## ${num}. ${v.businessName} (${v.userId})`);
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|---|---|');
    lines.push(`| business_name | ${v.businessName} |`);
    lines.push(`| vendor_id | \`${v.id}\` |`);
    lines.push(`| user_id | \`${v.userId}\` |`);
    lines.push(`| status | ${v.status} |`);
    lines.push(`| city / state | ${v.city} / ${v.state} |`);
    lines.push(`| original_input_statement | "${info?.statement ?? ''}" |`);
    lines.push(`| scenario_category | ${info?.category ?? ''} |`);
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
  console.log(`\n✓ Exported updated clean seller records (${vendors.length} vendors) to ${filePath}`);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║       MetaMarket Sports Vendor Onboarding & CDE Verification        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  console.log('\n[1/2] Initializing NestJS application context...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const discoveryService = app.get(CapabilityDiscoveryService);
  console.log('✓ NestJS CDE Application Context initialized.');

  console.log(`\n[2/2] Onboarding Vendor #11: "${NEW_VENDOR.businessName}"`);
  console.log(`      Statement: "${NEW_VENDOR.statement}"\n`);

  const conversationId = randomUUID();

  await prisma.conversation.create({
    data: {
      id: conversationId,
      userId: NEW_VENDOR.phone,
      lastChannel: 'api',
    },
  });

  const dbVendor = await prisma.vendor.create({
    data: {
      userId: NEW_VENDOR.phone,
      conversationId,
      businessName: NEW_VENDOR.businessName,
      city: NEW_VENDOR.city,
      state: NEW_VENDOR.state,
      status: 'active',
      conversationSummary: `${NEW_VENDOR.businessName} located in ${NEW_VENDOR.city}, ${NEW_VENDOR.state}. ${NEW_VENDOR.statement}`,
    },
  });

  const vendorStart = Date.now();
  const result = await discoveryService.observeStatement({
    vendorId: dbVendor.id,
    statement: NEW_VENDOR.statement,
    source: 'onboarding_statement',
    conversationId,
  });

  const duration = Date.now() - vendorStart;
  console.log(`✓ Resolved ${result.dna.beliefs.length} capability signals in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
  console.log(`\nTop Resolved Capabilities for "I sell sports materials":`);
  result.dna.beliefs.slice(0, 10).forEach((b) => {
    console.log(`   • ${b.capability.name} (${(b.confidence * 100).toFixed(1)}%)`);
  });

  await exportSellerRecords();

  await app.close();
}

main()
  .catch((e) => {
    console.error('Error during sports vendor onboarding:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
