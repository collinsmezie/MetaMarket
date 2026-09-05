import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/**
 * Typed accessor over validated configuration.
 *
 * Services depend on this rather than on `process.env` or raw `ConfigService`, so
 * configuration shape is checked by the compiler and grouped by concern.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    const value = this.config.get(key, { infer: true });

    // ConfigService reads process.env ahead of the validated object, so a key present but
    // blank in .env (`OPENAI_API_KEY=`) arrives as '' rather than undefined. Without this,
    // every optional credential looks configured and adapters fail at call time instead of
    // being cleanly excluded — which would silently break the LLM fallback chain.
    return (typeof value === 'string' && value.length === 0 ? undefined : value) as Env[K];
  }

  get nodeEnv() {
    return this.get('NODE_ENV');
  }

  get isProduction() {
    return this.nodeEnv === 'production';
  }

  get isTest() {
    return this.nodeEnv === 'test';
  }

  get port() {
    return this.get('PORT');
  }

  /**
   * Origins permitted to reach the web channel endpoints.
   *
   * Empty means no browser may call them. That is the safe default for a deployment that only
   * serves WhatsApp — these routes start workflows and spend Konnet credits, so opening them
   * to '*' to save a config line would be a real hole.
   */
  get webClientOrigins(): readonly string[] {
    // `get` maps an empty string to undefined, so the schema default lands here as absent.
    const raw = this.get('WEB_CLIENT_ORIGINS') ?? '';

    return raw
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  get logging() {
    return {
      level: this.get('LOG_LEVEL'),
      pretty: this.get('LOG_PRETTY'),
    };
  }

  get databaseUrl() {
    return this.get('DATABASE_URL');
  }

  get redisUrl() {
    return this.get('REDIS_URL');
  }

  get objectStorage() {
    return {
      endpoint: this.get('S3_ENDPOINT'),
      region: this.get('S3_REGION'),
      bucket: this.get('S3_BUCKET'),
      accessKeyId: this.get('S3_ACCESS_KEY_ID'),
      secretAccessKey: this.get('S3_SECRET_ACCESS_KEY'),
      forcePathStyle: this.get('S3_FORCE_PATH_STYLE'),
    };
  }

  get openai() {
    return {
      apiKey: this.get('OPENAI_API_KEY'),
      model: this.get('OPENAI_MODEL'),
      embeddingModel: this.get('OPENAI_EMBEDDING_MODEL'),
    };
  }

  get gemini() {
    return {
      apiKey: this.get('GEMINI_API_KEY'),
      model: this.get('GEMINI_MODEL'),
    };
  }

  get anthropic() {
    return {
      apiKey: this.get('ANTHROPIC_API_KEY'),
      model: this.get('ANTHROPIC_MODEL'),
    };
  }

  get embeddingDimension() {
    return this.get('EMBEDDING_DIMENSION');
  }

  get llmResilience() {
    return {
      maxAttempts: this.get('LLM_MAX_ATTEMPTS'),
      timeoutMs: this.get('LLM_TIMEOUT_MS'),
      circuitBreakerThreshold: this.get('LLM_CIRCUIT_BREAKER_THRESHOLD'),
      circuitBreakerResetMs: this.get('LLM_CIRCUIT_BREAKER_RESET_MS'),
    };
  }

  get speechToText() {
    return {
      provider: this.get('STT_PROVIDER'),
      model: this.get('STT_MODEL'),
      minConfidence: this.get('STT_MIN_CONFIDENCE'),
    };
  }

  get whatsapp() {
    return {
      verifyToken: this.get('WHATSAPP_VERIFY_TOKEN'),
      accessToken: this.get('WHATSAPP_ACCESS_TOKEN'),
      phoneNumberId: this.get('WHATSAPP_PHONE_NUMBER_ID'),
      businessAccountId: this.get('WHATSAPP_BUSINESS_ACCOUNT_ID'),
      appSecret: this.get('WHATSAPP_APP_SECRET'),
      graphApiVersion: this.get('WHATSAPP_GRAPH_API_VERSION'),
      verifySignature: this.get('WHATSAPP_VERIFY_SIGNATURE'),
    };
  }

  get twilio() {
    return {
      accountSid: this.get('TWILIO_ACCOUNT_SID'),
      authToken: this.get('TWILIO_AUTH_TOKEN'),
      messagingFrom: this.get('TWILIO_MESSAGING_FROM'),
    };
  }

  /** Node's A/AAAA ordering for outbound calls. See DNS_RESULT_ORDER in env.schema.ts. */
  get dnsResultOrder(): 'ipv4first' | 'verbatim' | 'ipv6first' {
    return this.get('DNS_RESULT_ORDER');
  }

  get paystack() {
    return {
      secretKey: this.get('PAYSTACK_SECRET_KEY'),
      publicKey: this.get('PAYSTACK_PUBLIC_KEY'),
      apiBase: this.get('PAYSTACK_API_BASE'),
      verifySignature: this.get('PAYSTACK_WEBHOOK_SIGNATURE_VERIFY'),
      dvaBank: this.get('PAYSTACK_DVA_BANK'),
    };
  }

  get credits() {
    const nairaPerCredit = this.get('NAIRA_PER_CREDIT');
    return {
      nairaPerCredit,
      koboPerCredit: nairaPerCredit * 100,
      visibilityFee: this.get('VISIBILITY_FEE_CREDITS'),
      onboardingGrant: this.get('ONBOARDING_GRANT_CREDITS'),
    };
  }

  get conversationPolicy() {
    return {
      lockTtlMs: this.get('CONVERSATION_LOCK_TTL_MS'),
      lockWaitMs: this.get('CONVERSATION_LOCK_WAIT_MS'),
      workflowIdleExpiryMs: this.get('WORKFLOW_IDLE_EXPIRY_MS'),
      maxSuspendedWorkflows: this.get('MAX_SUSPENDED_WORKFLOWS'),
    };
  }

  get taxonomy() {
    return {
      gs1GpcFile: this.get('GS1_GPC_FILE'),
    };
  }
}
