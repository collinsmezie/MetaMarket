#!/usr/bin/env node
/**
 * Subsystem audit for the seeded vendors: for each vendor in seed/vendors-ng-30.json, what CSRE
 * extracted, what the (legacy) capability layer recorded, what the Evidence System learned, and
 * whether the wallet received the onboarding grant. Reads Postgres directly through Prisma
 * (read-only) and writes docs/architecture/rebuild/VENDOR-SEED-AUDIT.md plus seed/out/audit.json.
 *
 *   node scripts/live/audit-vendors.mjs [--ingest seed/out/ingest-<ts>.json]
 */
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const seed = JSON.parse(await readFile(new URL('../../seed/vendors-ng-30.json', import.meta.url), 'utf8'));
const outDir = new URL('../../seed/out/', import.meta.url);
await mkdir(outDir, { recursive: true });
let ingest = null;
if (args.ingest) ingest = JSON.parse(await readFile(args.ingest, 'utf8'));
else {
  const files = (await readdir(outDir)).filter((f) => f.startsWith('ingest-')).sort();
  if (files.length > 0) ingest = JSON.parse(await readFile(new URL(files[files.length - 1], outDir), 'utf8'));
}
const ingestById = new Map((ingest?.results ?? []).map((r) => [r.id, r]));

const normalizePhone = (p) => p.replace(/[^\d+]/g, '').replace(/^0/, '+234').replace(/^234/, '+234');
const f3 = (n) => (typeof n === 'number' ? n.toFixed(3) : '—');

const rows = [];
for (const vendor of seed.vendors) {
  const phone = normalizePhone(vendor.phone);
  const v = await prisma.vendor.findFirst({ where: { OR: [{ userId: phone }, { contactPhone: phone }, { contactPhone: vendor.followups.phone }, { businessName: vendor.businessName }] } });
  const row = { id: vendor.id, sector: vendor.sector, style: vendor.style, channel: vendor.channel, businessName: vendor.businessName, statement: vendor.statement, gpcExpected: vendor.gpcExpected, ingest: ingestById.get(vendor.id) ?? null };
  if (v === null) {
    rows.push({ ...row, vendor: null });
    continue;
  }
  const conversationId = v.conversationId;
  const wallet = await prisma.creditWallet.findFirst({ where: { userId: v.userId } });
  const [grants, capabilities, semanticObjects, gpcMappings, assertions, observations, turns] = await Promise.all([
    wallet === null ? [] : prisma.creditTransaction.findMany({ where: { walletId: wallet.id, reason: 'onboarding_grant' } }),
    prisma.vendorCapability.findMany({ where: { vendorId: v.id }, orderBy: { confidence: 'desc' }, take: 8 }),
    prisma.semanticObject.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } }),
    prisma.gpcMapping.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } }),
    prisma.evidenceAssertion.findMany({ where: { subject: `vendor:${v.id}` }, orderBy: { belief: 'desc' } }),
    prisma.observation.findMany({ where: { OR: [{ actorId: v.id }, { conversationId }] }, orderBy: { observedAt: 'asc' } }),
    prisma.logicalTurn.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } }),
  ]);
  const phraseAssertions = await prisma.evidenceAssertion.findMany({
    where: { assertionId: { in: (await prisma.evidence.findMany({ where: { observationId: { in: observations.map((o) => o.observationId) } }, select: { assertionId: true } })).map((e) => e.assertionId) } },
  });
  const decisions = await prisma.graphChangeDecision.findMany({ where: { assertionId: { in: [...assertions, ...phraseAssertions].map((a) => a.assertionId) } } });
  rows.push({
    ...row,
    vendor: { id: v.id, status: v.status, businessName: v.businessName, contactPhone: v.contactPhone, city: v.city ?? null, state: v.state ?? null, onboardedAt: v.onboardedAt, conversationId },
    turns: turns.map((t) => ({ status: t.status, channel: t.channel })),
    wallet: wallet === null ? null : { balance: wallet.balanceCredits, grants: grants.length, grantAmount: grants[0]?.amountCredits ?? null },
    csre: semanticObjects.map((o) => ({ surface: o.surfaceForm, canonical: o.canonicalForm, entityType: o.entityType, concept: o.concept, status: o.conceptStatus, confidence: o.semanticConfidence, relevance: o.commercialRelevance })),
    gpc: gpcMappings.map((m) => ({ concept: m.concept, state: m.state, code: m.gpcCode, level: m.gpcLevel, title: m.gpcTitle, confidence: m.mappingConfidence })),
    capabilities: capabilities.map((c) => ({ name: c.capabilityName, domain: c.capabilityDomain, confidence: c.confidence, inferred: c.inferred, evidence: c.evidenceCount })),
    evidence: {
      observations: observations.map((o) => ({ type: o.observationType, status: o.status, evidence: o.evidenceCount })),
      vendorAssertions: assertions.map((a) => ({ predicate: a.predicate, object: a.objectLabel, belief: a.belief, state: a.state, sources: a.independentSourceCount, counts: [a.positiveCount, a.negativeCount] })),
      phraseAssertions: phraseAssertions.filter((a) => !a.subject.startsWith('vendor:')).map((a) => ({ subject: a.subjectLabel, predicate: a.predicate, object: a.objectLabel, belief: a.belief, state: a.state })),
      decisions: decisions.map((d) => ({ operation: d.operation, predicate: d.predicate, object: d.objectId, belief: d.beliefScore, status: d.status })),
    },
  });
}

await writeFile(new URL('audit.json', outDir), JSON.stringify(rows, null, 2));

const lines = [];
lines.push('# Vendor seed audit — 30 vendors through the live channels', '');
lines.push(`Generated ${new Date().toISOString()} from \`seed/vendors-ng-30.json\`${ingest ? ` and \`${args.ingest ?? 'latest ingest log'}\`` : ''}.`, '');
const completed = rows.filter((r) => r.vendor?.status === 'active').length;
const granted = rows.filter((r) => r.wallet?.grants >= 1).length;
lines.push('## Summary', '', '| Metric | Value |', '| --- | --- |');
lines.push(`| Vendors in seed | ${rows.length} |`);
lines.push(`| Onboarded (status active) | ${completed} |`);
lines.push(`| Onboarding grant received | ${granted} |`);
lines.push(`| Vendors with ≥1 CSRE object | ${rows.filter((r) => (r.csre?.length ?? 0) > 0).length} |`);
lines.push(`| Vendors with ≥1 GPC mapping | ${rows.filter((r) => (r.gpc?.length ?? 0) > 0).length} |`);
lines.push(`| Vendors with legacy capabilities | ${rows.filter((r) => (r.capabilities?.length ?? 0) > 0).length} |`);
lines.push(`| Vendors with Evidence SUPPLIES beliefs | ${rows.filter((r) => (r.evidence?.vendorAssertions?.length ?? 0) > 0).length} |`);
lines.push(`| GraphChangeDecisions emitted | ${rows.reduce((n, r) => n + (r.evidence?.decisions?.length ?? 0), 0)} |`, '');
for (const r of rows) {
  lines.push(`## ${r.id} — ${r.businessName} (${r.sector})`, '');
  lines.push(`- Style: **${r.style}** · Channel: **${r.channel}** · Statement: "${r.statement}"`);
  lines.push(`- Expected GPC anchor: ${r.gpcExpected.title} (${r.gpcExpected.level}${r.gpcExpected.code ? `, ${r.gpcExpected.code}` : ''})`);
  if (r.ingest) lines.push(`- Onboarding turns: ${r.ingest.turns.length} (${r.ingest.turns.map((t) => `${t.seconds}s`).join(', ')}) · completed: ${r.ingest.completed}${r.ingest.error ? ` · error: ${r.ingest.error}` : ''}`);
  if (!r.vendor) {
    lines.push('- **Vendor record: NOT CREATED**', '');
    continue;
  }
  lines.push(`- Vendor: status \`${r.vendor.status}\`, ${r.vendor.city ?? '?'}, ${r.vendor.state ?? '?'}, contact ${r.vendor.contactPhone ?? '—'}; turns ${r.turns.map((t) => t.status).join(', ')}`);
  lines.push(`- **Wallet**: ${r.wallet ? `balance ${r.wallet.balance}, onboarding grants ${r.wallet.grants}${r.wallet.grantAmount !== null ? ` × ${r.wallet.grantAmount}` : ''}` : 'no wallet'}`);
  lines.push(`- **CSRE objects** (${r.csre.length}): ${r.csre.map((o) => `"${o.surface}" → ${o.canonical} [${o.entityType}, ${o.status}, ${f3(o.confidence)}]`).join('; ') || '—'}`);
  lines.push(`- **GPC mappings** (${r.gpc.length}): ${r.gpc.map((m) => `${m.concept} → ${m.state}${m.code ? ` ${m.level} ${m.code} ${m.title}` : ''} (${f3(m.confidence)})`).join('; ') || '—'}`);
  lines.push(`- **Capability layer (legacy CDE)** (${r.capabilities.length}): ${r.capabilities.map((c) => `${c.name} [${c.domain}] ${f3(c.confidence)}${c.inferred ? ' inferred' : ''}`).join('; ') || '—'}`);
  lines.push(`- **Evidence observations** (${r.evidence.observations.length}): ${Object.entries(r.evidence.observations.reduce((acc, o) => ((acc[o.type] = (acc[o.type] ?? 0) + 1), acc), {})).map(([k, n]) => `${k}×${n}`).join(', ') || '—'}`);
  lines.push(`- **Evidence vendor beliefs** (${r.evidence.vendorAssertions.length}): ${r.evidence.vendorAssertions.map((a) => `${a.predicate.replace('mkg:', '')} ${a.object} = ${f3(a.belief)} ${a.state}${a.counts[1] > 0 ? ` (−${a.counts[1]})` : ''}`).join('; ') || '—'}`);
  lines.push(`- **Evidence phrase/taxonomy assertions** (${r.evidence.phraseAssertions.length}): ${r.evidence.phraseAssertions.slice(0, 8).map((a) => `${a.subject} ${a.predicate.replace('mkg:', '')} ${a.object} = ${f3(a.belief)}`).join('; ') || '—'}`);
  lines.push(`- **GraphChangeDecisions** (${r.evidence.decisions.length}): ${Object.entries(r.evidence.decisions.reduce((acc, d) => ((acc[d.operation] = (acc[d.operation] ?? 0) + 1), acc), {})).map(([k, n]) => `${k}×${n}`).join(', ') || '—'} (all ${[...new Set(r.evidence.decisions.map((d) => d.status))].join('/') || '—'})`);
  lines.push('');
}
await writeFile(new URL('../../docs/architecture/rebuild/VENDOR-SEED-AUDIT.md', import.meta.url), lines.join('\n'));
console.log(`audited ${rows.length} vendors: active=${completed} granted=${granted}`);
await prisma.$disconnect();
