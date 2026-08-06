import { createHmac } from 'node:crypto';

/**
 * Sends a correctly-signed WhatsApp webhook to a locally running MetaMarket instance.
 *
 * Lets the full pipeline — and its stage logs — be exercised without Meta, a tunnel, or a
 * real phone. The signature is computed the same way Meta computes it, so this exercises
 * the real verification path rather than bypassing it.
 *
 * Usage:
 *   npm run build
 *   node dist/cli/send-test-webhook.js "I need artist brush"
 *   node dist/cli/send-test-webhook.js --voice media_456
 *   node dist/cli/send-test-webhook.js --from 2348011111111 "I sell electrical materials"
 */

interface Options {
  readonly text: string;
  readonly from: string;
  readonly voiceMediaId: string | null;
  readonly url: string;
  readonly appSecret: string;
}

function parseArgs(argv: readonly string[]): Options {
  const args = [...argv];
  let from = '2348012345678';
  let voiceMediaId: string | null = null;
  const words: string[] = [];

  while (args.length > 0) {
    const arg = args.shift() as string;

    if (arg === '--from') from = args.shift() ?? from;
    else if (arg === '--voice') voiceMediaId = args.shift() ?? 'media_test';
    else words.push(arg);
  }

  return {
    text: words.join(' ') || 'I need artist brush',
    from,
    voiceMediaId,
    url: process.env.WEBHOOK_URL ?? `http://localhost:${process.env.PORT ?? 3000}/webhooks/whatsapp`,
    appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
  };
}

function buildPayload(options: Options): unknown {
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  // Unique per run so message-level deduplication does not swallow repeat invocations.
  const messageId = `wamid.local.${Date.now()}`;

  const message =
    options.voiceMediaId !== null
      ? {
          from: options.from,
          id: messageId,
          timestamp,
          type: 'audio',
          audio: { id: options.voiceMediaId, mime_type: 'audio/ogg; codecs=opus', voice: true },
        }
      : {
          from: options.from,
          id: messageId,
          timestamp,
          type: 'text',
          text: { body: options.text },
        };

  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881', phone_number_id: 'local-test' },
              contacts: [{ wa_id: options.from, profile: { name: 'Local Tester' } }],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.appSecret.length === 0) {
    // Without the secret the signature cannot be computed and the server will (correctly)
    // reject the request, so fail here with an actionable message instead.
    console.error(
      'WHATSAPP_APP_SECRET is not set. Export it, or run with WHATSAPP_VERIFY_SIGNATURE=false on the server.',
    );
    process.exit(1);
  }

  const raw = Buffer.from(JSON.stringify(buildPayload(options)));
  const signature = `sha256=${createHmac('sha256', options.appSecret).update(raw).digest('hex')}`;

  console.log(`→ POST ${options.url}`);
  console.log(`  from: ${options.from}`);
  console.log(
    options.voiceMediaId !== null
      ? `  voice note: mediaId=${options.voiceMediaId}`
      : `  text: "${options.text}"`,
  );

  const response = await fetch(options.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature },
    body: raw,
  });

  console.log(`← HTTP ${response.status} ${await response.text()}`);
  console.log('\nThe reply is delivered asynchronously — watch the server terminal for the stage logs.');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
