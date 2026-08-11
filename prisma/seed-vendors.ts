/**
 * Vendor Onboarding Simulation Harness.
 *
 * Sends real WhatsApp-format webhook payloads to the local server so each vendor
 * passes through the full platform pipeline:
 *
 *   Webhook → Adapter → TurnProcessor → Triage → VendorOnboarding
 *   → BusinessUnderstanding → CapabilityExpansion → CapabilityResolver → DNA
 *
 * This is NOT a database seed. Every vendor's Capability DNA is produced by the
 * live CDE, exactly as it would be for a real WhatsApp user. The script waits
 * between turns so stage logs can be studied for performance and hallucinations.
 *
 * Usage:
 *   npx ts-node prisma/seed-vendors.ts
 *
 * Prerequisites:
 *   - Server running on localhost:3000 (`npm run start:dev`)
 *   - WHATSAPP_VERIFY_SIGNATURE=false in .env (local testing)
 */

const BASE_URL = 'http://localhost:3000/webhooks/whatsapp';

/** Delay between turns in ms — enough for the LLM pipeline to finish without lock timeouts. */
const INTER_TURN_DELAY_MS = 25_000;

/** Delay between vendors — allows stage logs to settle before next vendor. */
const INTER_VENDOR_DELAY_MS = 5_000;

interface VendorScenario {
  /** Unique phone number (digits only, as Meta sends them). */
  phone: string;
  /** Display name as it would appear in WhatsApp profile. */
  profileName: string;
  /** Ordered turns the vendor sends. The system determines the questions. */
  turns: string[];
}

/**
 * 10 realistic Nigerian merchant scenarios spanning distinct trade archetypes.
 *
 * Each scenario's first message triggers Triage → VendorOnboarding, subsequent
 * messages answer the workflow's questions (capability, location, business name).
 */
const VENDORS: VendorScenario[] = [
  {
    phone: '2348031112233',
    profileName: 'Onyeka',
    turns: [
      'I want to sell',
      'I sell building materials, cement, roofing sheets, iron rods, and blocks',
      'Warri, Delta State',
      'Delta Building Materials',
    ],
  },
  {
    phone: '2348032223344',
    profileName: 'Musa',
    turns: [
      'I am a vendor',
      'I sell solar panels, inverters, electrical cables and solar batteries',
      'Kano, Kano State',
      'Kano Solar & Electrical Supplies',
    ],
  },
  {
    phone: '2348033334455',
    profileName: 'Chidinma',
    turns: [
      'I want to sell',
      'I sell clothes, designer suits, dresses, shoes and fashion accessories',
      'Ikeja, Lagos',
      'Ikeja City Boutique',
    ],
  },
  {
    phone: '2348034445566',
    profileName: 'Emeka',
    turns: [
      'I am a seller',
      'I sell drugs, vitamins, first aid kits, and patent medicine',
      'Onitsha, Anambra',
      'Onitsha Central Pharmacy',
    ],
  },
  {
    phone: '2348035556677',
    profileName: 'Fatima',
    turns: [
      'Sell',
      'I sell provisions, rice, milk, sugar, cooking oil and detergents',
      'Wuse, Abuja',
      'Wuse Provisions Supermarket',
    ],
  },
  {
    phone: '2348036667788',
    profileName: 'Chidi',
    turns: [
      'I want to sell',
      'I sell frozen foods, frozen chicken, turkey, croaker fish and sausages',
      'Port Harcourt, Rivers',
      'Port Harcourt Frozen Foods',
    ],
  },
  {
    phone: '2348037778899',
    profileName: 'Adebayo',
    turns: [
      'I am a vendor',
      'I sell car tyres, alloy rims, tyre inflators and car accessories',
      'Ibadan, Oyo',
      'Ibadan Tyres & Wheels',
    ],
  },
  {
    phone: '2348038889900',
    profileName: 'Nnamdi',
    turns: [
      'I want to sell',
      'I sell plumbing materials, PVC pipes, faucets, shower heads, and water tanks',
      'Enugu, Enugu State',
      'Enugu Sanitary & Plumbing Wares',
    ],
  },
  {
    phone: '2348039990011',
    profileName: 'Blessing',
    turns: [
      'Vendor',
      'I sell furniture, office desks, ergonomic chairs, dining tables and wardrobes',
      'Benin City, Edo State',
      'Benin Executive Furniture',
    ],
  },
  {
    phone: '2348040001122',
    profileName: 'Ibrahim',
    turns: [
      'I am a seller',
      'I sell grains, maize, soya beans, sorghum and fertilizer',
      'Kaduna, Kaduna',
      'Kaduna Agro Produce & Grains',
    ],
  },
];

/**
 * Builds a Meta Cloud API webhook payload for a single text message.
 *
 * Matches the exact shape the WhatsApp adapter expects (see whatsapp-payload.mapper.ts).
 */
function buildWebhookPayload(phone: string, text: string, profileName: string): object {
  const messageId = `wamid.SIM${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'SIMULATED_WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550000000',
                phone_number_id: 'SIMULATED_PHONE_NUMBER_ID',
              },
              contacts: [
                {
                  wa_id: phone,
                  profile: { name: profileName },
                },
              ],
              messages: [
                {
                  id: messageId,
                  from: phone,
                  timestamp,
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendMessage(phone: string, text: string, profileName: string): Promise<void> {
  const payload = buildWebhookPayload(phone, text, profileName);

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}: ${await response.text()}`);
  }
}

async function onboardVendor(vendor: VendorScenario, index: number): Promise<void> {
  const label = `[${index + 1}/${VENDORS.length}] ${vendor.profileName} (+${vendor.phone})`;
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ONBOARDING: ${label}`);
  console.log(`${'═'.repeat(70)}`);

  const vendorStart = Date.now();

  for (let turn = 0; turn < vendor.turns.length; turn++) {
    const text = vendor.turns[turn];
    const turnStart = Date.now();

    console.log(`  Turn ${turn + 1}/${vendor.turns.length}: "${text}"`);

    await sendMessage(vendor.phone, text, vendor.profileName);

    const sendDuration = Date.now() - turnStart;
    console.log(`    → Webhook accepted in ${sendDuration}ms`);

    // Wait for the pipeline to process before sending the next turn.
    if (turn < vendor.turns.length - 1) {
      console.log(`    ⏳ Waiting ${INTER_TURN_DELAY_MS}ms for pipeline to complete...`);
      await sleep(INTER_TURN_DELAY_MS);
    }
  }

  const totalDuration = Date.now() - vendorStart;
  console.log(`  ✓ ${vendor.profileName} onboarding sent in ${totalDuration}ms (${(totalDuration / 1000).toFixed(1)}s)`);
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║        MetaMarket Vendor Onboarding Simulation Harness             ║');
  console.log('║                                                                    ║');
  console.log('║  Sends real messages through the full platform pipeline:           ║');
  console.log('║  Webhook → Triage → Onboarding → CDE → Capability DNA             ║');
  console.log('║                                                                    ║');
  console.log('║  Monitor server logs for performance timing and hallucinations.    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`\nTarget: ${BASE_URL}`);
  console.log(`Vendors: ${VENDORS.length}`);
  console.log(`Inter-turn delay: ${INTER_TURN_DELAY_MS}ms`);
  console.log(`Inter-vendor delay: ${INTER_VENDOR_DELAY_MS}ms`);

  // Health check
  try {
    const health = await fetch('http://localhost:3000/health');
    if (!health.ok) throw new Error(`Health check returned ${health.status}`);
    console.log('Server health: ✓ OK');
  } catch (error) {
    console.error('Server health check failed. Is the server running on localhost:3000?');
    console.error(error);
    process.exit(1);
  }

  const harnesStart = Date.now();

  for (let i = 0; i < VENDORS.length; i++) {
    await onboardVendor(VENDORS[i], i);

    // Wait between vendors so logs settle
    if (i < VENDORS.length - 1) {
      console.log(`\n  ⏳ Waiting ${INTER_VENDOR_DELAY_MS}ms before next vendor...\n`);
      await sleep(INTER_VENDOR_DELAY_MS);
    }
  }

  const totalDuration = Date.now() - harnesStart;
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  SIMULATION COMPLETE`);
  console.log(`  Total time: ${totalDuration}ms (${(totalDuration / 1000).toFixed(1)}s)`);
  console.log(`  Vendors onboarded: ${VENDORS.length}`);
  console.log(`  Average per vendor: ${(totalDuration / VENDORS.length / 1000).toFixed(1)}s`);
  console.log(`${'═'.repeat(70)}`);
  console.log('\nCheck server stage logs for:');
  console.log('  - [MCOS] [TurnProcessor] → Total turn processing time');
  console.log('  - [CDE] [CapabilityResolver:Products] → GPC resolution time');
  console.log('  - [CDE] [BusinessUnderstanding] → Expansion correctness');
  console.log('  - [CME] [RankingEngine] → Matching time');
  console.log('  - Verify domain boundaries: no cross-domain GPC codes');
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
