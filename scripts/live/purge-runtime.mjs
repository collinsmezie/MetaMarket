#!/usr/bin/env node
/**
 * Clean slate for a local/dev environment: truncates every runtime table (conversations, turns,
 * vendors, wallets, evidence, traces, outbox, legacy evidence, LangGraph checkpoints…) and
 * flushes Redis, while preserving reference data (GS1 GPC taxonomy tables, migrations).
 *
 * Refuses to run unless DATABASE_URL and REDIS_URL point at localhost, or --force is given.
 *
 *   node scripts/live/purge-runtime.mjs [--dry] [--force]
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const args = new Set(process.argv.slice(2));
const dbUrl = process.env.DATABASE_URL ?? '';
const redisUrl = process.env.REDIS_URL ?? '';
const local = (url) => /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /\/\/(localhost|127\.0\.0\.1)[:/]/.test(url);
if (!args.has('--force') && !(local(dbUrl) && local(redisUrl))) {
  console.error('Refusing: DATABASE_URL/REDIS_URL are not local. Pass --force only if you really mean it.');
  process.exit(2);
}

const PRESERVE = new Set(['_prisma_migrations', 'taxonomy_nodes', 'taxonomy_attributes', 'brick_attribute_types', 'brick_attribute_values', 'taxonomy_imports']);

const prisma = new PrismaClient();
const tables = (await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`).map((r) => r.tablename);
const targets = tables.filter((t) => !PRESERVE.has(t));
console.log(`preserving: ${[...PRESERVE].filter((t) => tables.includes(t)).join(', ')}`);
console.log(`truncating ${targets.length} tables: ${targets.join(', ')}`);
if (!args.has('--dry')) {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${targets.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  const redis = new Redis(redisUrl);
  const keys = await redis.dbsize();
  await redis.flushall();
  await redis.quit();
  console.log(`truncated; redis flushed (${keys} keys)`);
}
await prisma.$disconnect();
