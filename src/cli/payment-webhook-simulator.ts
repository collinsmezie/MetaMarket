import { createHmac, randomUUID } from 'node:crypto';

/**
 * Sends a correctly-signed Paystack `dedicated_account.credit` webhook to a running instance
 * (Konnet Credits Recharge TDR §21.3).
 *
 * Lets the whole funding path be exercised — signature check, intake, crediting, confirmation —
 * without waiting for a real bank transfer. The signature is computed exactly as Paystack
 * computes it, so this tests the real verification path rather than bypassing it.
 *
 * Usage:
 *   node dist/cli/payment-webhook-simulator.js --account 8134567892 --naira 5000
 *   node dist/cli/payment-webhook-simulator.js --account 8134567892 --naira 50    # below minimum
 */
interface Options {
  readonly accountNumber: string;
  readonly amountKobo: number;
  readonly url: string;
  readonly secretKey: string;
  readonly reference: string;
}

function parseArgs(argv: readonly string[]): Options {
  const args = [...argv];
  let accountNumber = '';
  let naira = 5_000;
  let reference = `sim-${randomUUID()}`;

  while (args.length > 0) {
    const arg = args.shift() as string;

    if (arg === '--account') accountNumber = args.shift() ?? '';
    else if (arg === '--naira') naira = Number.parseFloat(args.shift() ?? '5000');
    else if (arg === '--reference') reference = args.shift() ?? reference;
  }

  return {
    accountNumber,
    amountKobo: Math.round(naira * 100),
    reference,
    url: process.env.PAYSTACK_WEBHOOK_URL ?? `http://localhost:${process.env.PORT ?? 3000}/webhooks/paystack`,
    secretKey: process.env.PAYSTACK_SECRET_KEY ?? '',
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.accountNumber.length === 0) {
    console.error('Usage: node dist/cli/payment-webhook-simulator.js --account <number> [--naira 5000]');
    console.error('Tip: run "Recharge" through WhatsApp first to provision an account number.');
    process.exit(1);
  }

  if (options.secretKey.length === 0) {
    // Without the secret the signature cannot be computed and the server will (correctly)
    // reject the request, so fail here with an actionable message instead.
    console.error(
      'PAYSTACK_SECRET_KEY is not set. Export it, or run the server with PAYSTACK_WEBHOOK_SIGNATURE_VERIFY=false.',
    );
    process.exit(1);
  }

  const payload = {
    event: 'dedicated_account.credit',
    data: {
      id: Date.now(),
      reference: options.reference,
      amount: options.amountKobo,
      currency: 'NGN',
      status: 'success',
      dedicated_account: {
        account_number: options.accountNumber,
        account_name: 'konnet - Simulated',
        bank: { name: 'Paystack-Titan' },
      },
    },
  };

  const raw = Buffer.from(JSON.stringify(payload));
  const signature = createHmac('sha512', options.secretKey).update(raw).digest('hex');

  console.log(`→ POST ${options.url}`);
  console.log(`  account  : ${options.accountNumber}`);
  console.log(`  amount   : ₦${(options.amountKobo / 100).toLocaleString('en-NG')}`);
  console.log(`  reference: ${options.reference}`);

  const response = await fetch(options.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': signature },
    body: raw,
  });

  console.log(`← HTTP ${response.status} ${await response.text()}`);
  console.log('\nCrediting happens off the webhook path — watch the server terminal for the stage logs.');
  console.log('Re-run with the same --reference to verify it credits exactly once.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
