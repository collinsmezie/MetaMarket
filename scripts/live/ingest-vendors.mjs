#!/usr/bin/env node
/**
 * Onboards the vendors in seed/vendors-ng-30.json strictly through the live inbound channel
 * adapters: `POST /channels/web/messages` (+ SSE stream for replies) or the WhatsApp webhook
 * (replies read back through the transcript endpoint). Every vendor therefore exercises real
 * MCOS logical turns: ingestion → assembly → LangGraph orchestrator → workflows → delivery.
 *
 *   node scripts/live/ingest-vendors.mjs [--base http://localhost:4000] [--only v01,v02] [--parallel 4]
 *
 * Writes a run log to seed/out/ingest-<timestamp>.json (conversation ids, turns, replies).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));
const BASE = args.base ?? process.env.BASE ?? 'http://localhost:4000';
const PARALLEL = Number(args.parallel ?? 4);
const TURN_TIMEOUT_MS = Number(args.turnTimeout ?? 240_000);
const only = args.only ? new Set(args.only.split(',')) : null;

const seed = JSON.parse(await readFile(new URL('../../seed/vendors-ng-30.json', import.meta.url), 'utf8'));
const vendors = seed.vendors.filter((v) => only === null || only.has(v.id));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

/** Chooses the answer to the workflow's latest question (Information Before Questions applies: any turn may carry more). */
function answerFor(reply, vendor, sentSoFar) {
  const q = reply.toLowerCase();
  if (/all set|you're listed|profile created/.test(q)) return null;
  if (/which city and state|where is your business|which state is that/.test(q)) return vendor.followups.location;
  if (/right\?/.test(q)) return 'Yes';
  if (/business name/.test(q)) return vendor.followups.businessName;
  if (/whatsapp number|phone number|which number/.test(q)) return vendor.followups.phone;
  if (/what do you sell|what would you like to add|what service/.test(q)) return sentSoFar.includes(vendor.statement) ? `${vendor.statement}. That is all.` : vendor.statement;
  if (/buy something|sell something|want to buy|want to sell|buy or sell/.test(q)) return 'I want to sell';
  return null;
}

async function historyFor(vendor) {
  const params = new URLSearchParams({ sessionId: `seed-${vendor.id}`, phone: vendor.phone });
  const res = await fetch(`${BASE}/channels/web/history?${params}`);
  return json(res);
}

/** Waits until the transcript grows by at least one assistant entry beyond `seen`, ignoring heartbeats. */
async function waitForAssistant(vendor, seen) {
  const started = Date.now();
  while (Date.now() - started < TURN_TIMEOUT_MS) {
    const h = await historyFor(vendor);
    const assistant = (h.history ?? []).filter((e) => e.role === 'assistant' && !/still working on your request/.test(e.content));
    if (assistant.length > seen) return { conversationId: h.conversationId, assistant };
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for a reply for ${vendor.id}`);
}

async function sendWeb(vendor, text, index) {
  const res = await fetch(`${BASE}/channels/web/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: `seed-${vendor.id}`, phone: vendor.phone, text, clientMessageId: `seed-${vendor.id}-${index}` }),
  });
  if (res.status !== 202) throw new Error(`web message rejected: ${res.status} ${await res.text()}`);
  return json(res);
}

async function sendWhatsApp(vendor, text, index) {
  const wa = vendor.phone.replace(/^\+/, '');
  const body = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'seed',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: 'seed' },
              contacts: [{ profile: { name: vendor.businessName }, wa_id: wa }],
              messages: [{ from: wa, id: `wamid.seed.${vendor.id}.${index}.${Date.now()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
  const res = await fetch(`${BASE}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status !== 200) throw new Error(`webhook rejected: ${res.status} ${await res.text()}`);
  return { accepted: true };
}

async function onboard(vendor) {
  const send = vendor.channel === 'whatsapp' ? sendWhatsApp : sendWeb;
  const log = { id: vendor.id, channel: vendor.channel, businessName: vendor.businessName, turns: [], conversationId: null, completed: false, error: null };
  const sent = [];
  try {
    let text = vendor.statement;
    let seen = ((await historyFor(vendor)).history ?? []).filter((e) => e.role === 'assistant').length;
    for (let turn = 1; turn <= 8 && text !== null; turn += 1) {
      const startedAt = Date.now();
      await send(vendor, text, turn);
      sent.push(text);
      const { conversationId, assistant } = await waitForAssistant(vendor, seen);
      log.conversationId = conversationId;
      seen = assistant.length;
      const reply = assistant[assistant.length - 1].content;
      log.turns.push({ turn, sent: text, reply, seconds: Math.round((Date.now() - startedAt) / 1000) });
      if (/all set|you're listed in/i.test(reply)) {
        log.completed = true;
        break;
      }
      text = answerFor(reply, vendor, sent);
      if (text === null) log.error = `No scripted answer for reply: ${reply.slice(0, 160)}`;
    }
  } catch (error) {
    log.error = error.message;
  }
  console.log(`${log.completed ? '✓' : '✕'} ${vendor.id} ${vendor.businessName} [${vendor.channel}] turns=${log.turns.length}${log.error ? ` error=${log.error}` : ''}`);
  return log;
}

const results = [];
for (let i = 0; i < vendors.length; i += PARALLEL) {
  const batch = vendors.slice(i, i + PARALLEL);
  results.push(...(await Promise.all(batch.map(onboard))));
}
await mkdir(new URL('../../seed/out/', import.meta.url), { recursive: true });
const out = new URL(`../../seed/out/ingest-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
await writeFile(out, JSON.stringify({ base: BASE, startedAt: new Date().toISOString(), results }, null, 2));
console.log(`\ncompleted ${results.filter((r) => r.completed).length}/${results.length}; log ${out.pathname}`);
