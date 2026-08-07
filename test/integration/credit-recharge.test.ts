import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as express from 'express';
import request from 'supertest';
import { PrismaService } from '../../src/adapters/outbound/persistence/prisma.service';
import { PaymentProcessor } from '../../src/application/wallet/payment-processor.service';
import { WalletService } from '../../src/application/wallet/wallet.service';
import { AppModule } from '../../src/app.module';
import type { Channel } from '../../src/domain/models/channel';
import type { Response } from '../../src/domain/models/response';
import {
  CHANNEL_NOTIFIER_REGISTRY,
  type ChannelNotifierPort,
  type ChannelNotifierRegistryPort,
  type DeliveryResult,
  type DeliveryTarget,
} from '../../src/domain/ports/outbound/channel-notifier.port';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../../src/domain/ports/outbound/embedding-provider.port';
import {
  LLM_PROVIDER_SERVICE,
  type LlmService,
  type StructuredRequest,
  type StructuredResult,
} from '../../src/domain/ports/outbound/llm-provider.port';
import {
  PAYMENT_PROVIDER,
  type PaymentProviderPort,
  type ProvisioningResult,
} from '../../src/domain/ports/outbound/payment-provider.port';

/**
 * The credits funding path end to end against real Postgres (Konnet Credits Recharge TDR §21.2):
 * a "Recharge" turn provisions and shows the account, and a signed webhook credits the wallet
 * exactly once.
 *
 * Paystack, the LLM and the outbound channel are faked; everything from the HTTP request to the
 * database is production code.
 */

const APP_SECRET = 'test-app-secret';
const PAYSTACK_SECRET = 'sk_test_secret';
const USER_PHONE = '2348044556677';
const ACCOUNT_NUMBER = '8134567892';

class CapturingNotifier implements ChannelNotifierPort {
  readonly sent: Response[] = [];
  readonly channel: Channel = 'whatsapp';

  async send(_target: DeliveryTarget, response: Response): Promise<DeliveryResult> {
    this.sent.push(response);
    return { delivered: true, providerMessageId: `wamid.${this.sent.length}`, messageCount: 1 };
  }

  lastText(): string {
    return this.sent[this.sent.length - 1]?.text ?? '';
  }
}

class CapturingRegistry implements ChannelNotifierRegistryPort {
  constructor(private readonly notifier: CapturingNotifier) {}
  forChannel(): ChannelNotifierPort {
    return this.notifier;
  }
  supports(): boolean {
    return true;
  }
  registeredChannels(): readonly Channel[] {
    return ['whatsapp'];
  }
}

/** Stands in for Paystack; counts calls so "provision once" is verifiable. */
class FakePaystack implements PaymentProviderPort {
  calls = 0;
  failWith: Error | null = null;

  async provisionDedicatedAccount(): Promise<ProvisioningResult> {
    this.calls += 1;
    if (this.failWith !== null) throw this.failWith;

    return {
      providerAccountId: '77',
      accountNumber: ACCOUNT_NUMBER,
      accountName: 'konnet - Collins',
      bankName: 'Paystack-Titan',
      providerReference: randomUUID(),
      customerCode: 'CUS_test',
    };
  }
}

class ScriptedLlm implements LlmService {
  intent = 'wallet_funding';

  async complete<T>(req: StructuredRequest, validate: (value: unknown) => T): Promise<StructuredResult<T>> {
    const payload =
      req.operation === 'continuity_analysis'
        ? { relationship: 'new', confidence: 0.9, candidateWorkflowIds: [], reasoning: 'scripted' }
        : { intent: this.intent, confidence: 0.95, entities: [], language: 'en', command: '' };

    return {
      data: validate(payload),
      provider: 'openai',
      model: 'scripted',
      latencyMs: 1,
      failedProviders: [],
    };
  }
}

class StubEmbeddings implements EmbeddingProviderPort {
  readonly model = 'stub';
  readonly dimension = 1536;
  async embed(): Promise<readonly number[]> {
    return Array.from({ length: this.dimension }, () => 0.01);
  }
  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.all(texts.map(() => this.embed()));
  }
}

describe('Credits recharge integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let processor: PaymentProcessor;
  let wallets: WalletService;
  let notifier: CapturingNotifier;
  let paystack: FakePaystack;

  let messageCounter = 0;

  const sendWhatsApp = async (body: string) => {
    messageCounter += 1;

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                contacts: [{ wa_id: USER_PHONE, profile: { name: 'Collins' } }],
                messages: [
                  {
                    from: USER_PHONE,
                    id: `wamid.rc.${messageCounter}`,
                    timestamp: '1785412800',
                    type: 'text',
                    text: { body },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const raw = Buffer.from(JSON.stringify(payload));
    const before = notifier.sent.length;

    await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`)
      .send(raw.toString('utf8'))
      .expect(200);

    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (notifier.sent.length > before) return notifier.lastText();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`No reply to "${body}"`);
  };

  const postPayment = (options: { reference?: string; amountKobo?: number; sign?: boolean } = {}) => {
    const payload = {
      event: 'dedicated_account.credit',
      data: {
        id: Math.floor(Math.random() * 1_000_000),
        reference: options.reference ?? `trf_${randomUUID()}`,
        amount: options.amountKobo ?? 500_000,
        currency: 'NGN',
        dedicated_account: { account_number: ACCOUNT_NUMBER },
      },
    };

    const raw = Buffer.from(JSON.stringify(payload));
    const signature =
      options.sign === false ? 'deadbeef' : createHmac('sha512', PAYSTACK_SECRET).update(raw).digest('hex');

    return request(app.getHttpServer())
      .post('/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', signature)
      .send(raw.toString('utf8'));
  };

  /**
   * Waits until `expected` notifications have reached a terminal state.
   *
   * The processor credits on its own the moment intake completes, so the test must observe that
   * rather than drive it: calling `processPending()` directly races the service's own inline
   * dispatch and can claim nothing. `processPending` is still nudged each round — it is
   * idempotent — so a slow sweep never makes the suite hang.
   */
  const settle = async (expected: number) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const settled = await prisma.paymentNotification.count({
        where: { status: { in: ['credited', 'failed'] } },
      });

      if (settled >= expected) return;

      await processor.processPending();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Expected ${expected} notification(s) to settle`);
  };

  beforeAll(async () => {
    // The suite drives the real signature path, so the app must run with this secret.
    process.env.PAYSTACK_SECRET_KEY = PAYSTACK_SECRET;

    notifier = new CapturingNotifier();
    paystack = new FakePaystack();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER_SERVICE)
      .useValue(new ScriptedLlm())
      .overrideProvider(CHANNEL_NOTIFIER_REGISTRY)
      .useValue(new CapturingRegistry(notifier))
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(new StubEmbeddings())
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(paystack)
      .compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    app.use(
      express.json({
        verify: (req: express.Request & { rawBody?: Buffer }, _res, buffer: Buffer) => {
          req.rawBody = Buffer.from(buffer);
        },
      }),
    );

    await app.init();

    prisma = app.get(PrismaService);
    processor = app.get(PaymentProcessor);
    wallets = app.get(WalletService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.paymentNotification.deleteMany();
    await prisma.creditTransaction.deleteMany();
    await prisma.virtualAccount.deleteMany();
    await prisma.creditWallet.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.outboxEvent.deleteMany();
    notifier.sent.length = 0;
    paystack.calls = 0;
    paystack.failWith = null;
  });

  it('shows the balance and funding account when the user says "Recharge"', async () => {
    const reply = await sendWhatsApp('Recharge');

    expect(reply).toContain('Current Balance');
    expect(reply).toContain('0 Credits');
    expect(reply).toContain('Transfer money to your konnet Funding Account');
    expect(reply).toContain(ACCOUNT_NUMBER);
    expect(reply).toContain('Paystack-Titan');

    const workflow = await prisma.workflowInstance.findFirst();
    expect(workflow?.workflowType).toBe('CreditRecharge');
    // Deterministic and single-turn: no waiting state.
    expect(workflow?.status).toBe('completed');
  });

  it('provisions the account once and reuses it on a second request', async () => {
    await sendWhatsApp('Recharge');
    await sendWhatsApp('Recharge');

    // One user, one permanent account — the business invariant.
    expect(paystack.calls).toBe(1);
    expect(await prisma.virtualAccount.count()).toBe(1);
  });

  it('degrades gracefully when Paystack is unavailable', async () => {
    paystack.failWith = new Error('paystack down');

    const reply = await sendWhatsApp('Recharge');

    // Never the generic fallback envelope: the user still sees their balance.
    expect(reply).toContain('Current Balance');
    expect(reply).toContain('being set up');
    expect(reply).not.toContain("didn't quite get that");
  });

  it('credits the wallet when a signed payment webhook arrives', async () => {
    await sendWhatsApp('Recharge');

    await postPayment({ amountKobo: 500_000 }).expect(200);
    await settle(1);

    // ₦5,000 at ₦100/credit.
    expect(await wallets.getBalance(`+${USER_PHONE}`)).toBe(50);

    const events = await prisma.outboxEvent.findMany({ where: { eventType: 'wallet.credited' } });
    expect(events).toHaveLength(1);

    // The confirmation is the last thing the user was sent.
    expect(notifier.lastText()).toContain('Payment Received');
    expect(notifier.lastText()).toContain('50 Credits have been added');
  });

  it('rejects an unsigned webhook and credits nothing', async () => {
    await sendWhatsApp('Recharge');

    await postPayment({ sign: false }).expect(403);
    await processor.processPending();

    expect(await wallets.getBalance(`+${USER_PHONE}`)).toBe(0);
    expect(await prisma.paymentNotification.count()).toBe(0);
  });

  it('credits exactly once when the same payment is delivered twice', async () => {
    await sendWhatsApp('Recharge');

    const reference = `trf_${randomUUID()}`;
    await postPayment({ reference }).expect(200);
    await postPayment({ reference }).expect(200);
    await settle(1);

    expect(await wallets.getBalance(`+${USER_PHONE}`)).toBe(50);
    expect(await prisma.creditTransaction.count()).toBe(1);
  });

  it('credits exactly once under concurrent duplicate delivery', async () => {
    await sendWhatsApp('Recharge');

    const reference = `trf_${randomUUID()}`;

    // The real hazard: two deliveries racing, neither seeing the other's write.
    await Promise.all([postPayment({ reference }), postPayment({ reference })]);
    // Two workers claiming concurrently must not both credit the same payment.
    await Promise.all([processor.processPending(), processor.processPending()]);
    await settle(1);

    expect(await wallets.getBalance(`+${USER_PHONE}`)).toBe(50);
    expect(await prisma.creditTransaction.count()).toBe(1);
  });

  it('accumulates separate payments', async () => {
    await sendWhatsApp('Recharge');

    await postPayment({ amountKobo: 500_000 }).expect(200);
    await settle(1);

    await postPayment({ amountKobo: 300_000 }).expect(200);
    await settle(2);

    expect(await wallets.getBalance(`+${USER_PHONE}`)).toBe(80);
    expect(await prisma.creditTransaction.count()).toBe(2);
  });

  it('records a payment below one credit without crediting or losing it', async () => {
    await sendWhatsApp('Recharge');

    await postPayment({ amountKobo: 5_000 }).expect(200); // ₦50
    await settle(1);

    expect(await wallets.getBalance(`+${USER_PHONE}`)).toBe(0);

    const notification = await prisma.paymentNotification.findFirst();
    expect(notification?.status).toBe('failed');
    expect(notification?.lastError).toBe('below_minimum');

    // The money is visible for reconciliation rather than silently gone.
    const failed = await prisma.outboxEvent.findFirst({ where: { eventType: 'wallet.credit.failed' } });
    expect((failed?.payload as Record<string, unknown>).remnantKobo).toBe(5_000);
  });

  it('records a payment to an unknown account for reconciliation', async () => {
    // No "Recharge" first, so no account exists for this number.
    const payload = {
      event: 'dedicated_account.credit',
      data: {
        id: 12345,
        reference: `trf_${randomUUID()}`,
        amount: 500_000,
        currency: 'NGN',
        dedicated_account: { account_number: '0000000000' },
      },
    };

    const raw = Buffer.from(JSON.stringify(payload));

    await request(app.getHttpServer())
      .post('/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', createHmac('sha512', PAYSTACK_SECRET).update(raw).digest('hex'))
      .send(raw.toString('utf8'))
      .expect(200);

    await settle(1);

    const notification = await prisma.paymentNotification.findFirst();
    expect(notification?.status).toBe('failed');
    expect(notification?.lastError).toBe('unmatched_account');
  });

  it('acknowledges an unrelated Paystack event without crediting', async () => {
    const payload = { event: 'charge.success', data: { id: 1, reference: 'x', amount: 100 } };
    const raw = Buffer.from(JSON.stringify(payload));

    await request(app.getHttpServer())
      .post('/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', createHmac('sha512', PAYSTACK_SECRET).update(raw).digest('hex'))
      .send(raw.toString('utf8'))
      .expect(200);

    expect(await prisma.paymentNotification.count()).toBe(0);
  });

  it('keeps the raw notification after crediting, for audit', async () => {
    await sendWhatsApp('Recharge');
    await postPayment().expect(200);
    await settle(1);

    const notification = await prisma.paymentNotification.findFirst();
    expect(notification?.status).toBe('credited');
    expect(notification?.processedAt).not.toBeNull();
  });

  it('shows the updated balance on the next recharge turn', async () => {
    await sendWhatsApp('Recharge');
    await postPayment({ amountKobo: 500_000 }).expect(200);
    await settle(1);

    const reply = await sendWhatsApp('Recharge');

    expect(reply).toContain('50 Credits');
  });
});
