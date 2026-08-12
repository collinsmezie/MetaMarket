import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

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
  console.log(`\n✓ Exported updated clean seller records with original statements to ${filePath}`);
}

exportSellerRecords()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
