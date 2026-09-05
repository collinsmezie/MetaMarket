import { z } from 'zod';

/**
 * Boot-time configuration contract.
 *
 * Misconfiguration is a deployment bug, not a runtime condition to degrade around,
 * so the process refuses to start rather than discovering a missing URL on the
 * first webhook.
 */

const booleanFromString = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');

const intFromString = (defaultValue: number, min?: number) => {
  let schema = z.coerce.number().int();
  if (min !== undefined) schema = schema.min(min);
  return schema.default(defaultValue);
};

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: intFromString(3000, 1),
    // How Node orders A/AAAA records for every outbound call. Defaults to `ipv4first` because
    // a host with no IPv6 route still gets AAAA records for graph.facebook.com and fails on
    // them; set `verbatim` (Node's own default) on a dual-stack or IPv6-only host.
    DNS_RESULT_ORDER: z.enum(['ipv4first', 'verbatim', 'ipv6first']).default('ipv4first'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    LOG_PRETTY: booleanFromString(false),

    // Comma-separated origins allowed to call the web channel endpoints. The web client is
    // deployed separately, so it is always cross-origin; an empty list disables CORS entirely
    // rather than defaulting to '*', because these endpoints start workflows and spend credits.
    WEB_CLIENT_ORIGINS: z.string().default(''),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('metamarket-media'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanFromString(true),

    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default('gpt-4o-2024-11-20'),
    OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    EMBEDDING_DIMENSION: intFromString(1536, 1),

    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-2.0-flash'),

    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),

    LLM_MAX_ATTEMPTS: intFromString(3, 1),
    LLM_TIMEOUT_MS: intFromString(30_000, 1_000),
    LLM_CIRCUIT_BREAKER_THRESHOLD: intFromString(5, 1),
    LLM_CIRCUIT_BREAKER_RESET_MS: intFromString(60_000, 1_000),

    STT_PROVIDER: z.enum(['openai']).default('openai'),
    STT_MODEL: z.string().default('whisper-1'),
    STT_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.55),

    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_GRAPH_API_VERSION: z.string().default('v21.0'),
    WHATSAPP_VERIFY_SIGNATURE: booleanFromString(true),

    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_MESSAGING_FROM: z.string().optional(),

    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_PUBLIC_KEY: z.string().optional(),
    PAYSTACK_API_BASE: z.string().url().default('https://api.paystack.co'),
    PAYSTACK_WEBHOOK_SIGNATURE_VERIFY: booleanFromString(true),
    // Bank partner for dedicated accounts. Left unset it is derived from the key mode, which is
    // what you want: Paystack only accepts `test-bank` on a test key and rejects it on a live
    // one. Set explicitly if your business is provisioned with a different partner.
    PAYSTACK_DVA_BANK: z.string().optional(),
    /** Naira per credit. Conversion floors, so this is also the minimum fundable amount. */
    NAIRA_PER_CREDIT: intFromString(100, 1),
    // What a vendor pays to be shown to one customer, immediately or by accepting a fanned-out
    // request. One fee, one price, two ways to earn a lead (TDR §25.2).
    VISIBILITY_FEE_CREDITS: intFromString(100, 1),
    // Given once to every successfully onboarded vendor, so a new profile is solvent on day one.
    ONBOARDING_GRANT_CREDITS: intFromString(2000, 1),

    CONVERSATION_LOCK_TTL_MS: intFromString(30_000, 1_000),
    CONVERSATION_LOCK_WAIT_MS: intFromString(5_000, 0),
    WORKFLOW_IDLE_EXPIRY_MS: intFromString(86_400_000, 1_000),
    MAX_SUSPENDED_WORKFLOWS: intFromString(10, 1),

    GS1_GPC_FILE: z.string().default('data/gs1_gpc.json'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    // Production has stricter requirements than development: a signature-verified
    // webhook and at least one working LLM provider are not optional there.
    const requiredInProduction: Array<[keyof typeof env, string]> = [
      ['WHATSAPP_ACCESS_TOKEN', 'outbound WhatsApp delivery'],
      ['WHATSAPP_PHONE_NUMBER_ID', 'outbound WhatsApp delivery'],
      ['WHATSAPP_VERIFY_TOKEN', 'Meta webhook subscription'],
      ['WHATSAPP_APP_SECRET', 'webhook signature verification'],
    ];

    for (const [key, why] of requiredInProduction) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required in production (${why}).`,
        });
      }
    }

    if (!env.PAYSTACK_SECRET_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYSTACK_SECRET_KEY'],
        message:
          'PAYSTACK_SECRET_KEY is required in production (credits funding and webhook signature verification).',
      });
    }

    if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENAI_API_KEY'],
        message:
          'At least one LLM provider key is required in production. Set OPENAI_API_KEY (primary) and optionally GEMINI_API_KEY / ANTHROPIC_API_KEY as fallbacks.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Validates raw `process.env` and returns the typed configuration.
 * Throws with every problem listed at once so a misconfigured deploy is fixed in one pass.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  // Treat empty strings as absent: an unset key in a .env file usually reads as ''.
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== '' && value !== undefined),
  );

  const result = envSchema.safeParse(cleaned);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid MetaMarket configuration:\n${problems}\n\nSee .env.example for the full contract.`,
    );
  }

  return result.data;
}
