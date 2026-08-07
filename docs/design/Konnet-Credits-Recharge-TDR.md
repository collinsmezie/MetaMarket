# TDR: Konnet Credits Recharge — Dedicated Virtual Account (Paystack)

**Status:** Draft — ready for implementation by an autonomous engineer.

**Source requirement:** [`Konnet Platform Credits Recharge Procedure .md`](./Konnet%20Platform%20Credits%20Recharge%20Procedure%20.md)

**Master engineering directive:** `Execution.md` (root of repo)

**Platform architecture:** Hexagonal (ADR-001) — see `docs/architecture/ADR-001-Hexagonal-Architecture.md`.

---

## 1. Objective

Give every Konnet user a permanent Dedicated Virtual Account (DVA) funded exclusively
from normal bank transfers, and convert incoming payments into platform credits on their
wallet automatically. No payment links, no checkout pages, no QR codes, no manual
confirmation.

**Business invariant (from the requirement):**

> One User → One Konnet Account → One Permanent Virtual Account → One Credit Wallet

---

## 2. Scope

In scope:

1. Persistence for wallets, virtual accounts, credit transactions and raw payment
   notifications (Prisma schema + migration).
2. A `CreditRecharge` conversation workflow so a user asking "Recharge" on WhatsApp gets
   their current balance and their permanent funding-account details, without AI guessing
   (a deterministic workflow).
3. A Paystack webhook adapter that receives `dedicated_account.credit` notifications,
   verifies their HMAC signature, credits the owning wallet exactly once, and sends the
   user a WhatsApp confirmation.
4. Lazy, idempotent provisioning of the DVA via the Paystack API the first time a user's
   recharge view is requested.
5. Configuration, events, tests, and the wiring changes needed to integrate with the
   existing Conversation OS.
6. **Balance spend** — atomic, exactly-once credit debits when a vendor's profile becomes
   visible to a customer (a paid lead), billing-aware vendor selection, the missed-lead
   recharge notification, and the connected notification to a debited vendor (§25).
7. **Onboarding grant** — every successfully onboarded vendor receives
   `ONBOARDING_GRANT_CREDITS` (2,000) free credits, seeding the visibility-fee economy so
   a new profile can pay for its first leads without recharging (§25.12).

Out of scope (see §24): admin/reconciliation UI, Paystack split-payment accounting,
refunds, and payment-status polling via Paystack's transaction verify endpoint.

---

## 3. How this feature fits the platform

MetaMarket is a NestJS hexagonal system. The boundary is enforced by ESLint
(`.eslintrc.js`): `src/domain/**` must not import frameworks, drivers or adapters.

- **`src/domain/`** — pure business logic, canonical models, ports, workflow definitions.
- **`src/application/`** — use-case services that orchestrate domain + ports.
- **`src/adapters/`** — inbound (webhooks) and outbound (Prisma, Redis, WhatsApp, Paystack).
- **`src/config/`** — Nest modules; the only place ports meet adapters (composition root).

This feature adds one new business capability ("credits wallet") exactly like the CDE/CME
and Evidence features were added: pure domain, an application service, repository
adapters, a workflow definition registered at boot, and an inbound webhook adapter.

Key integration facts the engineer must rely on (verified in the codebase):

- `src/config/conversation.module.ts` builds the `WorkflowDefinitionRegistry` at boot and
  registers `vendorOnboardingWorkflow`, `buyerSearchWorkflow`, `triageWorkflow`. Adding
  `creditRechargeWorkflow` there is the ONLY wiring the workflow needs to start routing.
- The `IntentResolutionService` prompt is derived automatically from
  `definitions.all().flatMap((d) => d.startingIntents)` (conversation.module.ts:98-107).
  Registering the workflow with `startingIntents: ['wallet_funding', 'wallet_balance']`
  is sufficient for the intent model to emit those labels.
- `Triage` currently claims `wallet_funding` at `priority: -100`. The
  `WorkflowDefinitionRegistry.resolveByIntent` sorts candidates by descending policy
  priority (workflow-registry.ts:18-35). Registering `CreditRecharge` with
  `priority: 50` makes it win `wallet_funding` with no change to Triage. This mirrors how
  `VendorOnboarding` took over `vendor_onboarding`.
- The transactional outbox (`OutboxEventPublisher`) persists every event before dispatch;
  `EvidenceProcessor` wildcard-subscribes to `'**'` and stores everything raw, so wallet
  events are captured for free and need no evidence mapping.
- `main.ts` already captures `rawBody` on every request (`express.json` `verify`
  hook, main.ts:27-35), which is exactly what HMAC webhook signature verification needs.
- `TurnProcessor.shouldResolveSemantics` only resolves semantics for `search`/`product`
  intents (turn-processor.service.ts:182-184) — `wallet_funding` is untouched, so the
  recharge workflow never pays for taxonomy/embedding work it does not need.

---

## 4. Terminology

| Term | Meaning |
|---|---|
| DVA | Dedicated Virtual Account — a real Nigerian bank account owned by the platform, permanently assigned to one user. |
| Wallet | The user's credit balance (`balanceCredits`), one per `userId` (normalised E.164). |
| Credit | One whole unit of platform credit. Conversion is deterministic: `credits = floor(amountKobo / koboPerCredit)`. |
| kobo | Nigeria's minor unit; ₦1 = 100 kobo. Paystack reports amounts in kobo. |
| Provider reference | Paystack transaction reference; the idempotency key for a credit. |
| Provisioning | Creating the Paystack customer + DVA and persisting the account details locally. |
| Minimum recharge | The smallest amount a user may pay into the funding account, `MIN_RECHARGE_NAIRA` (default ₦1,000). A hard floor: amounts below it are never credited — they are parked as `below_minimum` for reconciliation (§17 E8). |

---

## 5. Business flows

### 5.1 Conversation flow — user requests recharge

```
User: "Recharge"
  → WhatsApp webhook → MessageIngestion → TurnProcessor
  → IntentResolution emits `wallet_funding`
  → WorkflowManager.route → { action: 'start', workflowType: 'CreditRecharge' }
  → WorkflowEngine executes CreditRecharge/ShowAccount
  → WalletService.getRechargeView(userId, conversationId)
       - ensure wallet (idempotent create)
       - ensure DVA (provision via Paystack once)
       - return { balanceCredits, bankName, accountNumber, accountName }
  → workflow returns one Response:
        Current Balance
        18 Credits
        ━━━━━━━━━━━━━━━━━━
        Transfer money to your konnet Funding Account
        Bank: Paystack Bank
        Account Number: 8134567892
        Account Name: konnet - Collins
        Minimum recharge: ₦1,000
        ━━━━━━━━━━━━━━━━━━
        Your credits will be added automatically once payment is received.
  → workflow → Complete (terminal, same turn)
```

The workflow is deterministic: no LLM call happens inside it (intent resolution already
ran in the pipeline). It completes in a single turn and never waits for input.

### 5.2 Payment flow — Paystack webhook credits the wallet

```
User transfers money via any bank channel
  → funds land on the user's DVA
  → Paystack POSTs `dedicated_account.credit` to /webhooks/paystack
  → PaystackWebhookController:
       1. verifies x-paystack-signature (HMAC-SHA512 of raw body, secret key)
       2. maps payload → canonical PaymentNotification
       3. persists the notification (idempotent on eventId + providerReference)
       4. returns 200 immediately
  → PaymentProcessor (background, plus a 10s safety-net sweep):
       claim notification row atomically
       resolve wallet by accountNumber (via VirtualAccount → wallet)
       if amountKobo < minRechargeKobo (₦1,000 default) → fail `below_minimum`, never credited
       credits = floor(amountKobo / koboPerCredit)
       DB transaction: insert CreditTransaction (unique providerReference) THEN increment balance
       publish `wallet.credited` event
       send WhatsApp confirmation (best-effort, non-blocking)
       mark notification `credited`
```

---

## 6. Component placement map

New files (create):

```
src/domain/
  models/credit.ts                                  ← pure credit-conversion math + types
  models/wallet.ts                                  ← Wallet model
  models/virtual-account.ts                         ← VirtualAccount model
  models/credit-transaction.ts                      ← CreditTransaction model
  models/payment-notification.ts                    ← canonical PaymentNotification model
  ports/inbound/handle-payment-notification.port.ts
  ports/outbound/wallet-repository.port.ts
  ports/outbound/virtual-account-repository.port.ts
  ports/outbound/credit-transaction-repository.port.ts
  ports/outbound/payment-notification-repository.port.ts
  ports/outbound/payment-provider.port.ts
  workflows/definitions/credit-recharge.workflow.ts

src/application/wallet/
  wallet.service.ts                                 ← ensure wallet, ensure DVA, recharge view
  payment-processor.service.ts                      ← idempotent crediting + sweep
  wallet-notifier.service.ts                        ← outbound WhatsApp confirmation

src/adapters/inbound/paystack/
  paystack-webhook.controller.ts
  paystack-signature.ts
  paystack-payload.mapper.ts

src/adapters/outbound/paystack/
  paystack-client.adapter.ts                        ← implements PaymentProviderPort

src/adapters/outbound/persistence/
  prisma-credit-wallet.repository.ts
  prisma-virtual-account.repository.ts
  prisma-credit-transaction.repository.ts
  prisma-payment-notification.repository.ts

src/config/wallet.module.ts                          ← feature module (controllers + services)

src/cli/payment-webhook-simulator.ts                ← local testing tool (mirrors send-test-webhook.js)

test/credit-recharge.integration.test.ts            ← integration tests
```

Existing files to modify:

```
prisma/schema.prisma                                ← +4 models
src/config/env.schema.ts                            ← +PAYSTACK_*, +NAIRA_PER_CREDIT
src/config/app-config.service.ts                    ← +paystack, +credits getters
src/config/infrastructure.module.ts                 ← bind PAYMENT_PROVIDER + wallet repos to adapters
src/config/conversation.module.ts                   ← register workflow + add wallet service to WORKFLOW_SERVICES
src/config/app.module.ts                            ← import WalletModule
.env.example                                        ← document new vars
```

Unit tests (mirror existing `*.spec.ts` co-location):

```
src/domain/models/credit.spec.ts
src/domain/workflows/definitions/credit-recharge.workflow.spec.ts
src/adapters/inbound/paystack/paystack-signature.spec.ts
src/adapters/inbound/paystack/paystack-payload.mapper.spec.ts
src/application/wallet/wallet.service.spec.ts
src/application/wallet/payment-processor.service.spec.ts
```

---

## 7. Data model (Prisma)

Add to `prisma/schema.prisma`. Migration: `npx prisma migrate dev --name wallet_credits`
(author the SQL so a reviewer can read it; verify with `migrate dev`).

```prisma
// ─────────────────────────────────────────────────────────────────────────────
// Credits wallet & funding (Konnet Credits Recharge TDR §7)
// ─────────────────────────────────────────────────────────────────────────────

/// One credit wallet per user (normalised E.164). The root of the credit aggregate.
/// "One User → One Konnet Account → One Virtual Account → One Wallet."
model CreditWallet {
  id              String  @id @default(uuid()) @db.Uuid
  /// Platform identity — the normalised E.164 number, same key the Conversation uses.
  userId          String  @unique @map("user_id")
  /// The conversation that first provisioned the wallet, used for outbound pushes.
  conversationId  String  @map("conversation_id") @db.Uuid
  currency        String  @default("NGN")
  /// Whole credits only; conversion is `floor` (see NAIRA_PER_CREDIT). Never negative.
  balanceCredits  Int     @default(0) @map("balance_credits")
  /// Paystack customer code, cached after first provisioning (POST /customer).
  providerCustomerCode String? @map("provider_customer_code")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  virtualAccounts  VirtualAccount[]
  transactions     CreditTransaction[]

  @@map("credit_wallets")
}

/// The user's permanent dedicated virtual account.
model VirtualAccount {
  id              String @id @default(uuid()) @db.Uuid
  walletId        String @map("wallet_id") @db.Uuid
  provider        String @default("paystack")
  /// Paystack DVA id from the provisioning response.
  providerAccountId String? @map("provider_account_id")
  accountNumber   String @unique @map("account_number")
  accountName     String @map("account_name")
  bankName        String @map("bank_name")
  /// Idempotency key: one provisioning call, one DVA. Prevents double-provisioning.
  providerReference String? @unique @map("provider_reference")
  /// active | failed | deactivated
  status          String @default("active")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  wallet CreditWallet @relation(fields: [walletId], references: [id], onDelete: Cascade)

  @@index([walletId, status])
  @@map("virtual_accounts")
}

/// Immutable ledger of every credit (and future debit). Source of truth for a balance
/// statement; balanceCredits is the materialised total.
model CreditTransaction {
  id         String @id @default(uuid()) @db.Uuid
  walletId   String @map("wallet_id") @db.Uuid
  /// credit | debit | adjustment
  type       String @default("credit")
  amountCredits Int @map("amount_credits")
  /// Exact amount received, in minor units (kobo). Stored so nothing is ever guessed.
  amountKobo Int    @map("amount_kobo")
  /// Paystack transaction reference. UNIQUE = the exactly-once guarantee.
  providerReference String? @unique @map("provider_reference")
  /// Paystack event id, also unique as a second idempotency net.
  eventId    String? @unique @map("event_id")
  /// Reason string, e.g. "dedicated_account.credit".
  reason     String  @default("")
  /// Free-form audit detail (remnant kobo, currency, provider payload digest).
  metadata   Json    @default("{}")

  createdAt DateTime @default(now()) @map("created_at")

  wallet CreditWallet @relation(fields: [walletId], references: [id], onDelete: Cascade)

  @@index([walletId, createdAt])
  @@map("credit_transactions")
}

/// Raw, idempotent record of every payment notification received. Distinct from
/// CreditTransaction: this is the durable intake log; the transaction is the money.
///
/// Mirrors the Evidence Service split — persist the raw fact first, interpret on a
/// sweep — so a processing bug can be fixed and the backlog replayed without losing a
/// single notification.
model PaymentNotification {
  id       String @id @default(uuid()) @db.Uuid
  provider String @default("paystack")
  /// e.g. dedicated_account.credit
  eventType String @map("event_type")
  /// Paystack event id. UNIQUE → duplicate webhook deliveries are dropped at the door.
  eventId  String @unique @map("event_id")
  /// Paystack transaction reference. UNIQUE → second idempotency net.
  providerReference String @unique @map("provider_reference")
  accountNumber String @map("account_number")
  amountKobo    Int    @map("amount_kobo")
  currency      String @default("NGN")
  /// received | processing | credited | failed
  status   String @default("received")
  attempts Int    @default(0)
  lastError String? @map("last_error")

  receivedAt  DateTime @default(now()) @map("received_at")
  processedAt DateTime? @map("processed_at")

  @@index([status, receivedAt])
  @@map("payment_notifications")
}
```

Notes:

- **Unique constraints are the correctness mechanism**, not an afterthought. The
  ordering in §18 is what makes them safe against concurrent delivery.
- `balanceCredits` is `Int`. Conversion is `floor` (see §9.1) so fractional credits
  cannot silently appear; the remnant kobo is recorded in the transaction `metadata`
  and surfaced in logs for reconciliation.
- All new tables are indexed the way the existing tables are: composite, business-shaped,
  snake_case mapped columns.

---

## 8. Domain model and ports

### 8.1 `src/domain/models/credit.ts` — pure conversion

```ts
export interface CreditConversionResult {
  readonly credits: number;
  readonly remnantKobo: number; // amountKobo % koboPerCredit — must never be lost silently
}

/** Deterministic, total function: no exception paths, always floors. */
export function toCredits(amountKobo: number, koboPerCredit: number): CreditConversionResult {
  // invariants enforced by callers via validation, but guard here so the math is total
  const safeKobo = Number.isFinite(amountKobo) && amountKobo > 0 ? Math.floor(amountKobo) : 0;
  const safeRate = Number.isFinite(koboPerCredit) && koboPerCredit > 0 ? Math.floor(koboPerCredit) : 0;
  if (safeKobo === 0 || safeRate === 0) return { credits: 0, remnantKobo: 0 };
  return { credits: Math.floor(safeKobo / safeRate), remnantKobo: safeKobo % safeRate };
}

export const nairaToKobo = (naira: number): number => Math.round(naira * 100);
export const koboToNairaLabel = (kobo: number): string =>
  `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
```

### 8.2 `src/domain/models/wallet.ts`, `virtual-account.ts`, `credit-transaction.ts`, `payment-notification.ts`

Mirror the existing model style: plain `interface` types, a few pure helper predicates,
no framework imports. Example:

```ts
export interface Wallet {
  readonly id: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly currency: string;
  readonly balanceCredits: number;
  readonly providerCustomerCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type VirtualAccountStatus = 'active' | 'failed' | 'deactivated';

export interface VirtualAccount {
  readonly id: string;
  readonly walletId: string;
  readonly provider: string;
  readonly providerAccountId: string | null;
  readonly accountNumber: string;
  readonly accountName: string;
  readonly bankName: string;
  readonly providerReference: string | null;
  readonly status: VirtualAccountStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PaymentNotification {
  readonly id: string;
  readonly provider: string;
  readonly eventType: string;
  readonly eventId: string;
  readonly providerReference: string;
  readonly accountNumber: string;
  readonly amountKobo: number;
  readonly currency: string;
  readonly status: 'received' | 'processing' | 'credited' | 'failed';
  readonly attempts: number;
  readonly lastError: string | null;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}
```

### 8.3 Outbound ports (all `Symbol(...)`-token style, like the existing ports)

`src/domain/ports/outbound/wallet-repository.port.ts`:

```ts
export const WALLET_REPOSITORY = Symbol('WalletRepository');

export interface WalletRepositoryPort {
  findById(id: string): Promise<Wallet | null>;
  findByUserId(userId: string): Promise<Wallet | null>;
  /** Creates the wallet. Must tolerate a concurrent create for the same userId
   *  (return the existing row) rather than throwing. */
  create(params: { id: string; userId: string; conversationId: string }): Promise<Wallet>;
  updateProviderCustomerCode(walletId: string, customerCode: string): Promise<Wallet>;
}
```

`virtual-account-repository.port.ts`:

```ts
export const VIRTUAL_ACCOUNT_REPOSITORY = Symbol('VirtualAccountRepository');

export interface VirtualAccountRepositoryPort {
  findActiveByWalletId(walletId: string): Promise<VirtualAccount | null>;
  findByAccountNumber(accountNumber: string): Promise<VirtualAccount | null>;
  /** Must tolerate a concurrent provision for the same wallet (unique constraints on
   *  accountNumber and providerReference): return the persisted row on conflict. */
  create(params: {
    id: string; walletId: string; providerAccountId: string | null;
    accountNumber: string; accountName: string; bankName: string;
    providerReference: string | null;
  }): Promise<VirtualAccount>;
}
```

`credit-transaction-repository.port.ts`:

```ts
export const CREDIT_TRANSACTION_REPOSITORY = Symbol('CreditTransactionRepository');

export interface CreditTransactionRepositoryPort {
  create(params: {
    id: string; walletId: string; amountCredits: number; amountKobo: number;
    providerReference: string | null; eventId: string | null; reason: string;
    metadata: Readonly<Record<string, unknown>>;
  }): Promise<void>; // throws UniqueConstraintError (P2002) on duplicate — see §18
}
```

`payment-notification-repository.port.ts`:

```ts
export const PAYMENT_NOTIFICATION_REPOSITORY = Symbol('PaymentNotificationRepository');

export type NotificationMutation = {
  status?: 'received' | 'processing' | 'credited' | 'failed';
  lastError?: string | null;
  processedAt?: Date | null;
};

export interface PaymentNotificationRepositoryPort {
  /** Idempotent intake: returns false when the eventId already exists (duplicate webhook). */
  record(input: {
    id: string; eventType: string; eventId: string; providerReference: string;
    accountNumber: string; amountKobo: number; currency: string;
  }): Promise<{ recorded: boolean; notification: PaymentNotification | null }>;
  /** Atomic claim: flips status received→processing and returns true for exactly one worker. */
  claimNext(batchSize: number): Promise<readonly PaymentNotification[]>;
  markProcessed(id: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  /** Straight through to Prisma for the atomic credit transaction (§18). */
  markCreditedInTransaction(tx: unknown, id: string, processedAt: Date): Promise<void>;
}
```

`payment-provider.port.ts`:

```ts
export const PAYMENT_PROVIDER = Symbol('PaymentProvider');

export interface ProvisioningResult {
  readonly providerAccountId: string;
  readonly accountNumber: string;
  readonly accountName: string;
  readonly bankName: string;
  readonly providerReference: string;
}

export interface PaymentProviderPort {
  /** Idempotent at the Paystack level via reference: a retried call with the same
   *  reference returns the same account. */
  provisionDedicatedAccount(params: {
    customerReference: string; // deterministic per wallet: synthetic email or customer code
  }): Promise<ProvisioningResult>;
}
```

### 8.4 Inbound port

`src/domain/ports/inbound/handle-payment-notification.port.ts`:

```ts
export const HANDLE_PAYMENT_NOTIFICATION = Symbol('HandlePaymentNotification');

export interface PaymentNotificationInput {
  readonly provider: 'paystack';
  readonly eventType: string;
  readonly eventId: string;
  readonly providerReference: string;
  readonly accountNumber: string;
  readonly amountKobo: number;
  readonly currency: string;
}

export interface HandlePaymentNotificationResult {
  /** True when this delivery was a duplicate of an already-known event. */
  readonly duplicate: boolean;
}

export interface HandlePaymentNotificationPort {
  handle(notification: PaymentNotificationInput): Promise<HandlePaymentNotificationResult>;
}
```

---

## 9. Application layer

### 9.1 `src/application/wallet/wallet.service.ts`

`@Injectable()`, constructor-injects `WALLET_REPOSITORY`, `VIRTUAL_ACCOUNT_REPOSITORY`,
`PAYMENT_PROVIDER`, `EVENT_PUBLISHER`, `STAGE_LOGGER`, `CLOCK`, `ID_GENERATOR`.

```ts
export type RechargeView =
  | {
      readonly status: 'ready';
      readonly balanceCredits: number;
      readonly bankName: string;
      readonly accountNumber: string;
      readonly accountName: string;
      /** The configured minimum recharge amount, so the workflow renders it from
       *  configuration (`config.credits.minKobo`) rather than a hardcoded string. */
      readonly minRechargeKobo: number;
    }
  | {
      readonly status: 'unavailable';
      readonly balanceCredits: number;
      readonly reason: 'provisioning_failed';
    };
```

- `ensureWallet(userId, conversationId): Promise<Wallet>` — idempotent. `findByUserId`,
  else `create`. Catch the unique-violation race (`P2002`) and re-read. Log with the
  StageLogger (`[Wallet] [WalletService]`).
- `getRechargeView(userId, conversationId): Promise<RechargeView>` —
  1. `ensureWallet`.
  2. `findActiveByWalletId`. If present → return `ready` view.
  3. Else provision: build the deterministic customer reference
     `customerRef = userId` (documented in §19); call
     `paymentProvider.provisionDedicatedAccount({ customerReference })`.
  4. Persist the returned `VirtualAccount` (tolerate `P2002` — a concurrent provision
     already landed; re-read and use that one).
  5. Publish `wallet.funding_account.provisioned`.
  6. Return `ready`.
  - Every `ready` view carries `minRechargeKobo` sourced from `config.credits.minKobo`
    (`MIN_RECHARGE_NAIRA`, default ₦1,000) — never a hardcoded literal. The workflow
    renders the minimum line (§13.3) from this field, and the PaymentProcessor uses the
    same config value as the crediting floor, so the copy and the rule cannot drift.
  - **Any Paystack/network failure is caught and downgraded** to
    `{ status: 'unavailable', reason: 'provisioning_failed' }`. Never throw out of the
    workflow. Log `stageFailed`.
- `getBalance(userId): Promise<number>`.
- `creditWallet(walletId, credits, ...)` — used by the PaymentProcessor; implemented as
  the atomic transaction in §18.

Stage logging is mandatory at every step per `Execution.md §3` (Input/Action/Output).

### 9.2 `src/application/wallet/payment-processor.service.ts`

Implements `HANDLE_PAYMENT_NOTIFICATION`. Steps:

1. **Intake (synchronous, fast):** `paymentNotifications.record(...)` with a fresh uuid.
   If `recorded === false` → return `{ duplicate: true }`. This is the only DB write on
   the webhook hot path.
2. **Background credit** (fire-and-forget `void this.processPending()`, plus a
   `@Interval(10_000)` safety-net sweep that calls the same method — exactly the
   EvidenceProcessor pattern).
3. `processPending()`:
   - `claimNext(batchSize)` atomically moves `received → processing` for up to N rows
     (`updateMany where { id, status: 'received' }` returning matched rows; N=20).
   - For each claimed notification → `credit(notification)`.
   - `credit()` logic:
     a. Resolve wallet: `virtualAccounts.findByAccountNumber` → `walletId` →
        `wallets.findById`.
        - No account → `markFailed(notification.id, 'unmatched_account')`, publish
          `wallet.credit.failed` (payload: accountNumber, reference), log `stageFailed`,
          return. **A 200 is still returned to Paystack** — acknowledging prevents
          retry storms; reconciliation is handled by the failed record + event.
     b. **Hard floor check — BEFORE conversion, on the amount, so it stays correct
        whatever the rate:** `amountKobo < config.credits.minKobo` (₦1,000 by default,
        `MIN_RECHARGE_NAIRA`) → `markFailed(..., 'below_minimum')`, publish
        `wallet.credit.failed` (payload includes `amountKobo`, `minRechargeNaira` and
        the remnant), return. This deliberately covers the whole ₦100–₦999 band, not
        just sub-credit amounts: the minimum is an amount rule, independent of
        `NAIRA_PER_CREDIT`. `toCredits` is only reached once the floor passes.
     c. `toCredits(amountKobo, koboPerCredit)`; then the atomic credit (§18):
        insert `CreditTransaction` → on `P2002` treat as duplicate
        (`markProcessed` the notification, return `duplicate: true`); then increment
        `balanceCredits`; then `markCreditedInTransaction`.
     d. Publish `wallet.credited` (payload: walletId, userId, credits, amountKobo,
        balanceAfter, providerReference).
     e. **Fire the WhatsApp confirmation** via `WalletNotifier` (§12) — best-effort,
        wrapped in try/catch, never rethrows.
   - Attempts cap: `claimNext` increments `attempts`; if `attempts > 5` on a row that
     fails, `markFailed` (dead-letter, `Execution.md §2.5`). A `failed` row is never
     auto-retried — it is the reconciliation surface for ops.

### 9.3 `src/application/wallet/wallet-notifier.service.ts`

- Constructor-injects `CHANNEL_NOTIFIER_REGISTRY` and `STAGE_LOGGER`.
- `notifyCredited(target: { address, conversationId }, view: { credits, amountKobo, balanceAfter }): Promise<void>`.
- Composes the confirmation `Response` (§12) and calls
  `notifiers.forChannel('whatsapp').send(...)`. If the channel is unsupported or the
  send fails, log `stageFailed` with the DeliveryResult error. Never throws to callers.
- This is the only direct use of the notifier outside the pipeline, and it is justified:
  the confirmation is a system-initiated push, not a turn response. Record the assistant
  turn in history via `ConversationContextManager.recordAssistantTurn` when a
  `conversationId` is available (best-effort).

---

## 10. Paystack inbound adapter

### 10.1 `src/adapters/inbound/paystack/paystack-signature.ts`

Pure function, same shape as `whatsapp-signature.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Paystack signs webhooks with HMAC-SHA512 over the exact raw body, hex-encoded,
 *  using the secret key. Verify BEFORE parsing: JSON round-tripping can hide tampering. */
export function verifyPaystackSignature(params: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  secretKey: string;
}): boolean {
  if (params.signatureHeader === undefined) return false;
  const provided = Buffer.from(params.signatureHeader, 'hex');
  const expected = createHmac('sha512', params.secretKey).update(params.rawBody).digest();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
```

### 10.2 `src/adapters/inbound/paystack/paystack-payload.mapper.ts`

Pure function `mapWebhookToNotification(body: unknown): PaymentNotificationInput | null`.
Rules:

- Accept `dedicated_account.credit` (and tolerate `dedicated_account.assignment`, which
  is logged and ignored for crediting — it is handled by our own provisioning response).
- Extract: `data.reference` → `providerReference`; `data.id` → `eventId`;
  `data.amount` (kobo) → `amountKobo`; `data.currency` → `currency`;
  `data.dedicated_account.account_number` → `accountNumber`; `event` → `eventType`.
- Return `null` for unknown events, malformed payloads, or missing fields. The
  controller treats `null` as "acknowledge and ignore" (with a log).
- Validate with `zod` (the repo standard, `src/application/understanding/schemas.ts`) so
  the contract is explicit and enforced before any business logic sees it.

### 10.3 `src/adapters/inbound/paystack/paystack-webhook.controller.ts`

Mirror `whatsapp-webhook.controller.ts`:

```ts
@Controller('webhooks/paystack')
export class PaystackWebhookController {
  constructor(
    @Inject(HANDLE_PAYMENT_NOTIFICATION) private readonly handler: HandlePaymentNotificationPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly config: AppConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() request: RequestWithRawBody, @Body() body: unknown): Promise<{ received: true }> {
    // Unauthenticated requests are the ONE case not answered 200: acknowledging them
    // would invite forgery (Execution.md §2.5, WhatsApp controller precedent).
    if (!this.isAuthentic(request)) throw new ForbiddenException('Invalid Paystack signature.');

    void this.process(body);   // detached, like the WhatsApp controller

    return { received: true };
  }
}
```

- `isAuthentic`: reads `PAYSTACK_WEBHOOK_SIGNATURE_VERIFY` (default true, false only for
  fixture replay), requires `PAYSTACK_SECRET_KEY` configured, requires `rawBody`, then
  `verifyPaystackSignature`.
- `process`: `mapWebhookToNotification` → `null` means log + return → else
  `await this.handler.handle(...)` wrapped in try/catch so one bad notification cannot
  crash the process.
- Processing is not awaited so a slow DB never becomes a Paystack retry storm; the
  sweep is the durability backstop.

---

## 11. Paystack outbound adapter

### 11.1 `src/adapters/outbound/paystack/paystack-client.adapter.ts`

Implements `PaymentProviderPort`. Constructor-injects `AppConfigService` (for
`paystack.secretKey`, `paystack.apiBase`) and `STAGE_LOGGER`.

- `provisionDedicatedAccount({ customerReference })`:
  1. Ensure the Paystack customer:
     - `POST {apiBase}/customer` with `{ email: <synthetic email>, first_name?, last_name? }`.
     - Synthetic email is deterministic per user: `${customerReference.replace(/[^0-9]/g,'')}@konnet.ng`
       (documented decision, §19). Cache `customer_code` on the wallet via
       `WalletService.updateProviderCustomerCode` (or pass it through the result).
  2. `POST {apiBase}/dedicated_account` with
     `{ customer: <customer_code>, preferred_bank: 'wema-bank', metadata: { userId } }`.
  3. Map `data.dedicated_account.bank.name → bankName`,
     `data.dedicated_account.account_name → accountName`,
     `data.dedicated_account.account_number → accountNumber`,
     `data.id → providerAccountId`, plus a generated `providerReference` (uuid) echoed in
     the request body so a retried call does not create two DVAs.
- **Resilience (`Execution.md §2.5`):** HTTP timeout (15s, `AbortSignal.timeout`),
  exponential backoff, max 3 attempts, JSON error surfaced in `lastError`/logs. On
  exhaustion, throw a typed `ProvisioningError` that `WalletService` catches and
  downgrades to `unavailable`.
- Authorization header: `Authorization: Bearer {secretKey}`.
- Never log the secret. Log only statuses and non-sensitive ids.

---

## 12. Outbound WhatsApp confirmation

Compose the canonical `Response` (channel-neutral — the notifier renders it):

```text
✅ Payment Received

{₦5,000} has been received.

{50} Credits have been added.

Current Balance:
{68} Credits
```

- `Response.text` exactly as above (emoji kept — it is part of the requirement's copy).
- Sent through `WalletNotifier.notifyCredited` using `CHANNEL_NOTIFIER_REGISTRY` so the
  WhatsApp rendering rules (splitText, 4096 limit) come from the existing adapter, and
  SMS gets the same message for free when a Twilio notifier is wired.
- Failure is non-fatal: the credit is already committed; a failed push is logged as
  `[Wallet] [WalletNotifier] stageFailed` and the next recharge turn shows the balance.

---

## 13. CreditRecharge workflow

`src/domain/workflows/definitions/credit-recharge.workflow.ts`. Follow the structure and
style of `vendor-onboarding.workflow.ts` (typed `WorkflowServices` sub-interface,
`dataOf`/`servicesOf` helpers, `fingerprintFor`, `summaryFor`).

```ts
export const CREDIT_RECHARGE_WORKFLOW_TYPE = 'CreditRecharge';

const STATE_SHOW_ACCOUNT = 'ShowAccount';
const STATE_COMPLETE = 'Complete';

export interface CreditRechargeServices extends WorkflowServices {
  readonly wallet: {
    getRechargeView(params: { userId: string; conversationId: string }): Promise<RechargeView>;
  };
}
```

### 13.1 State machine

| State | waitsForInput | allowedTransitions | isFinal |
|---|---|---|---|
| `ShowAccount` | false | `Complete` | — |
| `Complete` | false | — | true |

### 13.2 `ShowAccount.execute(context)`

```ts
const services = servicesOf(context);   // throws if services.wallet missing (boot-fast)
const view = await services.wallet.getRechargeView({
  userId: context.trigger.conversation.userId,
  conversationId: context.trigger.conversation.id,
});

return {
  transitionTo: STATE_COMPLETE,
  status: 'completed',
  response: { text: renderRechargeView(view) },   // §13.3
  summary: summaryFor(view),                       // e.g. "Recharge view shown; balance 18 credits."
  semanticFingerprint: fingerprintFor(context.trigger, view),
  dataPatch: { balanceAtView: view.balanceCredits },
};
```

### 13.3 Rendering

`ready` →

```text
Current Balance
{18} Credits

━━━━━━━━━━━━━━━━━━

Transfer money to your konnet Funding Account

Bank:
{bankName}

Account Number:
{accountNumber}

Account Name:
{accountName}

Minimum recharge:
{koboToNairaLabel(view.minRechargeKobo)}

━━━━━━━━━━━━━━━━━━

Your credits will be added automatically once payment is received.
```

The `Minimum recharge` line is rendered from `view.minRechargeKobo`
(→ `koboToNairaLabel`, e.g. "₦1,000"), never hardcoded — the copy stays consistent
with the PaymentProcessor's crediting floor (§9.2, §15.2).

`unavailable` → never a generic loop, never silence (`Execution.md §2.5`):

```text
Current Balance
{18} Credits

━━━━━━━━━━━━━━━━━━

Your funding account is being set up and should be ready soon. Please ask again in a few minutes.
```

### 13.4 Definition

```ts
policy: {
  ...DEFAULT_WORKFLOW_POLICY,
  priority: 50,                    // beats Triage (-100) for wallet_funding / wallet_balance
  idleExpiryMs: 24 * 60 * 60 * 1_000,
  resumable: true,
  allowConcurrentInstances: false, // one funding view per user
},
startingIntents: ['wallet_funding', 'wallet_balance'],
initialData: (trigger) => ({ triggerText: trigger.text }),
initialSummary: () => 'Credits recharge started.',
initialFingerprint: (trigger) => ({
  intent: 'wallet_funding',
  entities: ['recharge', 'credits', 'wallet', 'balance'],
  keywords: [...new Set(['recharge', 'credits', 'wallet', 'balance', ...trigger.text.split(/\s+/).filter(w => w.length > 2)])],
}),
```

The workflow never calls the LLM. Intent detection already happened in the pipeline; the
state machine only reads the wallet service. This keeps the funding flow deterministic and
free.

---

## 14. Events

New event types (string constants, producer `WalletService` / `PaymentProcessor`):

| Event | Payload (minimum) | Purpose |
|---|---|---|
| `wallet.created` | `{ userId, walletId }` | Analytics; future funding onboarding |
| `wallet.funding_account.provisioned` | `{ walletId, userId, accountNumber, bankName }` | Audit; reconciles `dedicated_account.assignment` webhooks |
| `wallet.credited` | `{ walletId, userId, credits, amountKobo, balanceAfter, providerReference }` | Source of truth for spend flows, notifications, analytics |
| `wallet.credit.failed` | `{ accountNumber, providerReference, reason, amountKobo, minRechargeNaira? }` | Reconciliation surface (unmatched account, below minimum) |
| `wallet.debited` | `{ walletId, userId, credits, balanceAfter, reason, deliveryId, requestId, vendorId }` | Source of truth for spend; links every debit to the delivery that caused it (§25) |
| `wallet.debit.insufficient` | `{ walletId, userId, credits, balance, requestId, vendorId }` | Detects a missed paid lead; drives the missed-lead recharge push (§25.7) |
| `wallet.debit.failed` | `{ walletId, userId, credits, requestId, vendorId, error }` | Reconciliation surface for the debit path (§25.6) |
| `wallet.onboarding_credited` | `{ walletId, userId, credits, balanceAfter, providerReference }` | The one-time grant given on successful onboarding; kept distinct from `wallet.credited` so a payment landing is never confused with a grant (§25.12) |

Publish via `EVENT_PUBLISHER` (transactional outbox). `EvidenceProcessor` will store them
raw via its `'**'` subscription; they carry no vendorId so they correctly produce no
evidence records — no `evidence-interpretation.ts` change is needed.

The wallet feature also *consumes* an existing event: it subscribes to `seller.onboarded`
(in-process, dispatched by the outbox relay after commit) to grant the onboarding credit.
The producer (CapabilityDiscoveryEngine) does not change — the consumer resolves the
vendor's `userId` via `VENDOR_REPOSITORY.findById` (§25.12).

The marketplace-facing `vendor.credit.deducted` event (producer
`RequestDistributionService`, §5.2) is unchanged and now has real wallet backing: each
emission corresponds to a committed `wallet.debited` row, from either billing path — an
immediate profile delivery (`reason: profile_delivered_to_customer`) or a responding
vendor becoming visible (`reason: responded_to_customer_request`) (§25.6).

---

## 15. Configuration

### 15.1 `src/config/env.schema.ts`

```ts
PAYSTACK_SECRET_KEY: z.string().optional(),
PAYSTACK_PUBLIC_KEY: z.string().optional(),
PAYSTACK_API_BASE: z.string().url().default('https://api.paystack.co'),
PAYSTACK_WEBHOOK_SIGNATURE_VERIFY: booleanFromString(true),
NAIRA_PER_CREDIT: intFromString(100, 1),
MIN_RECHARGE_NAIRA: intFromString(1000, 1),
```

Production refinement (inside the existing `superRefine`): require `PAYSTACK_SECRET_KEY`
in production.

### 15.2 `src/config/app-config.service.ts`

```ts
get paystack() {
  return {
    secretKey: this.get('PAYSTACK_SECRET_KEY'),
    publicKey: this.get('PAYSTACK_PUBLIC_KEY'),
    apiBase: this.get('PAYSTACK_API_BASE'),
    verifySignature: this.get('PAYSTACK_WEBHOOK_SIGNATURE_VERIFY'),
  };
}

get credits() {
  const nairaPerCredit = this.get('NAIRA_PER_CREDIT');
  const minNaira = this.get('MIN_RECHARGE_NAIRA');
  return {
    nairaPerCredit,
    koboPerCredit: nairaPerCredit * 100,
    minNaira,
    minKobo: minNaira * 100,
  };
}
```

### 15.3 `.env.example`

Document all four `PAYSTACK_*` vars, `NAIRA_PER_CREDIT` and `MIN_RECHARGE_NAIRA`
(default 1000) in a new `# ── Paystack (credits funding) ───` section, matching the
file's existing style.

---

## 16. Module wiring

### 16.1 `src/config/infrastructure.module.ts` (Global — composition root for outbound ports)

Add providers + exports:

```ts
{ provide: WALLET_REPOSITORY, useClass: PrismaCreditWalletRepository },
{ provide: VIRTUAL_ACCOUNT_REPOSITORY, useClass: PrismaVirtualAccountRepository },
{ provide: CREDIT_TRANSACTION_REPOSITORY, useClass: PrismaCreditTransactionRepository },
{ provide: PAYMENT_NOTIFICATION_REPOSITORY, useClass: PrismaPaymentNotificationRepository },
{ provide: PAYMENT_PROVIDER, useClass: PaystackClientAdapter },
```

### 16.2 `src/config/wallet.module.ts` (new)

```ts
@Module({
  controllers: [PaystackWebhookController],
  providers: [
    WalletService,
    PaymentProcessor,
    WalletNotifier,
    { provide: HANDLE_PAYMENT_NOTIFICATION, useExisting: PaymentProcessor },
  ],
  exports: [WalletService, HANDLE_PAYMENT_NOTIFICATION],
})
export class WalletModule {}
```

### 16.3 `src/config/conversation.module.ts`

- `imports: [WalletModule]`.
- Register the workflow in the `WorkflowDefinitionRegistry` factory:
  `registry.register(creditRechargeWorkflow);` after the other workflows.
- Add `WalletService` to the `WORKFLOW_SERVICES` factory inject list and registry:

```ts
provide: WORKFLOW_SERVICES,
inject: [..., WalletService],
useFactory: (..., wallet: WalletService) => ({ extraction, discovery, vendors, matching, distribution, wallet }),
```

### 16.4 `src/config/app.module.ts`

Add `WalletModule` to `imports` after `ConversationModule`.

---

## 17. Error handling & graceful degradation

Every path below MUST be covered by a unit test. Summary table:

| # | Failure | Behaviour | Never |
|---|---|---|---|
| E1 | Paystack provisioning times out / errors | `getRechargeView` returns `unavailable`; user gets friendly copy with balance; `stageFailed` logged; provisioning retried on next request | Throw into the turn / fallback envelope / infinite retry loop |
| E2 | Webhook signature invalid | `403 Forbidden` (the one non-200) | Silently accept |
| E3 | Signature disabled in config | Log warning, accept (fixture replay only) | Silent |
| E4 | Unknown/malformed webhook event | Log, `200` ack, no credit | Crash, retry storm |
| E5 | Duplicate webhook delivery (same `eventId`) | `record()` returns `duplicate`, `200` ack, no second credit | Double credit |
| E6 | Duplicate credit attempt (same `providerReference`) | `P2002` on `CreditTransaction` → treated as duplicate, notification marked processed, no second increment | Double credit |
| E7 | Webhook for unknown account number | Notification → `failed` (`unmatched_account`), `wallet.credit.failed` event, `stageFailed` log, `200` ack | Crash |
| E8 | Amount below the minimum recharge (`MIN_RECHARGE_NAIRA`, default ₦1,000) | Notification → `failed` (`below_minimum`), `amountKobo` + `minRechargeNaira` + remnant recorded in `metadata`, reconciliation event | Crediting a payment below the published minimum |
| E9 | Notification processing crash between persist and credit | `received` row stays; sweep re-claims; idempotency keys make replay safe | Lost notification |
| E10 | DB outage on webhook path | HTTP handler catches, logs, Paystack retries (rows idempotent) | 500 → user double-send risk |
| E11 | WhatsApp confirmation push fails | Credit already committed; `stageFailed` logged; balance visible next turn | Rolling back a committed credit |
| E12 | Attempts exceed cap | Row dead-letters to `failed` for ops reconciliation (`Execution.md §2.5`) | Infinite retry |
| E13 | Wallet missing during crediting (DVA exists, wallet deleted) | Treat as `unmatched_account` failure path; reconcilable | Phantom credit |
| E14 | Immediate-delivery vendor has insufficient balance (or no wallet) | Not delivered as a paid lead; `wallet.debit.insufficient` + `vendor.credit.insufficient`; missed-lead push with recharge action (§25.7); next ranked vendor tried; unpaid top-ranked fallback if none can pay | Negative balance / presenting an unbilled paid lead |
| E15 | Debit retried / duplicate (same delivery) | Ledger unique `providerReference` → `duplicate`; `creditDeducted` set once; no second debit (§25.6) | Double debit |
| E16 | Debit fails mid-distribution (DB error) | `distribute` fails the turn; a retry is safe (ledger key + `InboundMessage.processedAt`); orphaned `wallet.debited` rows surfaced via `wallet.debit.failed` for reconciliation | Presenting a profile without a committed debit |
| E17 | Responder accepts but has insufficient balance (or no wallet) | Vendor is **not** revealed to the customer; `request.accepted` recorded honestly + `wallet.debit.insufficient` + `vendor.credit.insufficient`; missed-lead push with recharge action, responder variant (§25.7); the customer simply keeps waiting for other responders | Revealing an unbilled responder / negative balance |
| E18 | Connected notification push fails after a successful debit | Debit already committed; `stageFailed` logged; the vendor learns of the lead on their next turn — never roll back a committed debit over a push | Rolling back a committed debit |
| E19 | Free-trial notification push fails (unpaid fallback) | `stageFailed` logged; no debit to protect, so nothing to roll back; the vendor simply doesn't learn the trial is temporary — next turn's view still shows their balance (§25.7) | Blocking distribution over a best-effort push |
| E20 | Onboarding-grant push fails | Grant already committed; `stageFailed` logged; balance visible next turn (§25.12) | Rolling back a committed grant / blocking onboarding |

**Webhook contract:** the controller always answers `200 OK` once authenticated
(`Execution.md §2.5`). All real failures are recorded in `payment_notifications.status`
and surfaced via `wallet.credit.failed` events.

---

## 18. Idempotency & exactly-once crediting

Crediting must be **exactly once** even under concurrent duplicate deliveries. This is a
database property, enforced with ordering, not a code flag.

Within one `prisma.$transaction` (interactive):

1. `creditTransactionRepository.create(...)` — **first**.
   - Two concurrent workers both try to insert the same unique `providerReference`/
     `eventId`; Postgres serializes them and the second gets a `P2002` unique violation.
   - On `P2002` → this delivery is a duplicate: commit nothing, `markProcessed` the
     notification, return `duplicate: true`. (The first worker is guaranteed to have
     completed its increment before the second's insert could succeed.)
2. Increment the balance: `creditWallet.update({ where: { id }, data: { balanceCredits: { increment: credits } } })`.
   - Belt-and-braces: `SELECT ... FOR UPDATE` the wallet row first (`$queryRaw`) so two
     *different* references for the same wallet also serialize, keeping the balance
     mathematically consistent under all interleavings.
3. `paymentNotificationRepository.markCreditedInTransaction(tx, id, now)`.

Because the unique constraint is on the money row (not the notification row), a crash
after step 2 can be replayed by the sweep and still cannot double-credit — the replay's
step 1 fails with `P2002`.

**Provisioning idempotency:** the Paystack request carries a deterministic
`providerReference` and `VirtualAccount` has `accountNumber` and `providerReference`
unique. A concurrent double-provision is resolved by whichever `create` wins; the loser
hits `P2002`, re-reads, and uses the persisted account (E6 pattern).

**The onboarding grant is the same discipline without a payment.** `grantAtomically`
(§25.12) inserts the ledger row first (`providerReference = 'onboarding:' + vendorId`),
`SELECT ... FOR UPDATE`s the wallet, increments the balance, and never settles a
`PaymentNotification` — there is none. A replayed `seller.onboarded` fails its first step
with `P2002` and is treated as a `duplicate`, exactly as E6/E15.

---

## 19. Security

- **Signature verification** — `x-paystack-signature` is HMAC-SHA512 of the raw body
  with the secret key; `timingSafeEqual`; length check first; raw body from `main.ts`
  capture. Same discipline as the WhatsApp adapter.
- **Never log secrets** — only statuses and non-sensitive ids. Sanitise any provider
  error body before logging.
- **No secret in responses** — the user sees only their own balance and account details.
- **Synthetic customer email** — `${digitsOf(userId)}@konnet.ng`. Rationale: Paystack
  customers require an email; we have an E.164. Deterministic per user (idempotent
  customer creation). No real PII is sent to Paystack that we do not already hold.
- **Recipient validation** — the credit path resolves wallets ONLY from
  `accountNumber` → `VirtualAccount` → `walletId`. An attacker cannot name a wallet.
- **Production hardening (document, not necessarily implement now):** rate-limit the
  webhook endpoint, add a `PAYSTACK_PUBLIC_KEY`-based webhook IP allow-list option,
  enable `WHATSAPP_VERIFY_SIGNATURE`.

---

## 20. Clean code & boundary compliance

- `src/domain/**` imports only types/ports (ESLint-enforced). The workflow, models,
  conversion math, and ports live there; no `@nestjs`, `@prisma`, `fetch`, or SDK.
- Adapters translate; `paystack-client.adapter.ts` owns HTTP; `payment-processor` owns
  orchestration; the workflow owns the conversation copy; `wallet.service` owns the
  provisioning decision. No layer leaks into another.
- No `any`. All webhook mapping and config validated with `zod`.
- Every public method has an explicit return type; symbols for ports (injection tokens);
  domain classes are plain constructors (no Nest decorators in `domain/`).
- Stage logging (`Execution.md §3`) at every stage: `[Wallet]`, `[PaymentProcessor]`,
  `[PaystackAdapter]`, `[MCOS] CreditRechargeWorkflow`.
- Deterministic workflows: the LLM never decides a state transition. The recharge
  workflow does not even call the LLM.

---

## 21. Testing plan

### 21.1 Unit (`src/**/*.spec.ts`, no network)

- `credit.spec.ts` — floor conversion, remnant, zero/negative/invalid inputs are total.
- `credit-recharge.workflow.spec.ts` — `ShowAccount` returns the composed view and
  completes; degrades to `unavailable` copy when the wallet service says so; the ready
  copy includes the `Minimum recharge` line rendered from `view.minRechargeKobo`;
  fingerprint, summary and dataPatch correctness; transition legality.
- `paystack-signature.spec.ts` — valid signature passes; tampered body fails; wrong
  header, truncated hex, missing header fail; constant-time path exercised.
- `paystack-payload.mapper.spec.ts` — `dedicated_account.credit` maps fully; unknown
  events / malformed payloads → null; zod rejection paths.
- `wallet.service.spec.ts` — ensureWallet idempotent; view returns cached DVA without
  calling provider; provisions once when absent; `P2002` race tolerated; provider failure
  → `unavailable`, no throw; `provisioned` event published; every `ready` view carries
  `minRechargeKobo` from config (not hardcoded).
- `payment-processor.service.spec.ts` (fakes for repos + notifier) — duplicate eventId
  no-op; duplicate providerReference no-op; unknown account → failed + event; amount
  below the ₦1,000 minimum (and the exact-boundary case `amountKobo === minKobo`, which
  must credit) → failed/credited respectively; successful credit publishes
  `wallet.credited` and triggers notifier; attempts cap dead-letters.

### 21.2 Integration (`test/**/*.test.ts`, real Postgres/Redis, per README)

- `credit-recharge.integration.test.ts` —
  1. **Recharge turn:** drive the pipeline (`HANDLE_INCOMING_MESSAGE`) with a
     "Recharge" message → a `CreditRecharge` workflow completes and the composed
     response contains the balance and the funding account block. (Real `Vendor`-style
     fakes for the Paystack provider, real DB.)
  2. **Webhook → credit:** POST a signed `dedicated_account.credit` to
     `/webhooks/paystack` → wallet `balanceCredits` increases exactly once; a
     `wallet.credited` outbox event exists; a WhatsApp confirmation was attempted.
  3. **Concurrency:** fire the same webhook twice concurrently → balance incremented
     once, one `CreditTransaction` row.
  4. **Signature:** unsigned / tampered payload → 403 and no balance change.
  5. **Below minimum:** POST a signed `dedicated_account.credit` for an amount under
     `MIN_RECHARGE_NAIRA` (e.g. ₦500) → `balanceCredits` unchanged, the notification is
     `failed` (`below_minimum`), and a `wallet.credit.failed` outbox event exists.
- Integration tests must refuse to run on a non-`_test` DB (existing `setup-integration.ts`
  behaviour) and truncate tables between tests.

### 21.3 CLI tooling

`src/cli/payment-webhook-simulator.ts` (mirror `send-test-webhook.js`): builds a signed
`dedicated_account.credit` payload for a given account number + amount and POSTs it to
`/webhooks/paystack`, so the whole path can be exercised without a live Paystack event.
Because the amount is a CLI argument, the tool doubles as the quickest way to drive the
`below_minimum` path (E8) with an amount under `MIN_RECHARGE_NAIRA`.

### 21.4 Commands the engineer must run green

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:int          # needs `npm run infra:up` and a *_test database
npm run build
```

---

## 22. Implementation checklist (ordered)

1. Prisma schema (§7) → `npx prisma migrate dev --name wallet_credits` → `npx prisma generate`.
2. Domain: `credit.ts` + models + ports (§8).
3. Repositories: 4 Prisma adapters (§8.3, pattern: `prisma-vendor.repository.ts`).
4. Paystack outbound adapter (§11).
5. Application: `wallet.service.ts`, `payment-processor.service.ts`, `wallet-notifier.service.ts` (§9, §12).
6. Paystack inbound adapter: signature, mapper, controller (§10).
7. Workflow `credit-recharge.workflow.ts` (§13).
8. Config: `env.schema.ts`, `app-config.service.ts`, `.env.example`, `infrastructure.module.ts`, `wallet.module.ts`, `conversation.module.ts`, `app.module.ts` (§15, §16).
9. CLI simulator (§21.3).
10. Unit tests (§21.1) — co-located with sources.
11. Integration tests (§21.2).
12. Full verification pass (§21.4).
13. Balance spend schema: `wallet_debits` migration (§25.4) → `npx prisma migrate dev`.
14. Balance spend domain: `WalletDebitResult`, `WALLET_DEBIT_REASONS`, debit events (§25.3).
15. `PrismaWalletRepository.debitAtomically` (§25.5).
16. `WalletService.debit` + `WalletNotifier.notifyInsufficient` +
    `WalletNotifier.notifyConnected` + `WalletNotifier.notifyFreeTrial` (§25.6, §25.7);
    export `WalletNotifier` from `WalletModule` (§25.9).
17. Billing-aware `RequestDistributionService.distribute` + responder billing in
    `recordVendorResponse` + triage `recharge` action routing (§25.6, §25.7).
18. Config: `VISIBILITY_FEE_CREDITS` (default 100) (§25.8).
19. Balance spend unit + integration tests (§25.10) and verification pass (§21.4).
20. Onboarding grant: `grantAtomically` port + `PrismaWalletRepository` implementation;
    `WalletService.grantOnboardingCredits`; `WalletOnboardingGrantListener` +
    `WalletNotifier.notifyOnboardingCredit`; config `ONBOARDING_GRANT_CREDITS`
    (default 2000) (§25.12).
21. Onboarding-grant unit + integration tests (§25.12) and verification pass (§21.4).

---

## 23. Acceptance criteria

- A user saying "Recharge" receives the balance + funding-account block exactly as in
  §13.3, from a completed `CreditRecharge` workflow, with no LLM call inside the
  workflow.
- The recharge message states the minimum recharge amount (₦1,000 by default, sourced
  from `MIN_RECHARGE_NAIRA`), not a hardcoded string.
- The DVA is provisioned via Paystack at most once per user; a second "Recharge" reuses
  the persisted account.
- A signed `dedicated_account.credit` webhook credits the wallet; concurrent and repeated
  deliveries credit exactly once.
- A webhook for an amount below `MIN_RECHARGE_NAIRA` is never credited and lands as a
  `failed` (`below_minimum`) notification for reconciliation (§17 E8).
- The WhatsApp confirmation is sent after crediting.
- An immediate delivery debits exactly `VISIBILITY_FEE_CREDITS` (100) credit(s), exactly
  once, and the vendor is shown to the customer only after the debit succeeds (§25).
- A vendor without a sufficient balance is never presented as a paid lead, never goes
  negative, and receives the missed-lead notification with the recharge action (§25.7).
- A fanned-out vendor who accepts the request is debited `VISIBILITY_FEE_CREDITS` before
  being revealed; an insolvent responder is never revealed and receives the responder
  variant of the missed-lead notification (§25.6, §25.7).
- A debited vendor (immediate or responder) receives the connected notification telling
  them their profile was shared, so the charge is never a surprise (§25.7).
- Tapping "Recharge Now" routes the vendor into `CreditRecharge` without any new payment
  code.
- If no ranked vendor can pay, the top-ranked vendor is still delivered unpaid, so the
  customer always gets an answer.
- A vendor delivered through the unpaid fallback receives the free-trial notification
  telling them the lead was on the house and the trial mode is temporary (§25.7).
- A successfully onboarded vendor immediately holds `ONBOARDING_GRANT_CREDITS` (2,000)
  free credits and can pay the visibility fee without recharging; the grant is given
  exactly once no matter how many times `seller.onboarded` is redelivered (§25.12).
- Every failure path in §17 is handled without crashing, without a generic fallback loop,
  and without double-crediting.
- `lint`, `typecheck`, unit and integration suites are green.

---

## 24. Out of scope / decisions to confirm with product

- **Conversion rounding** (flagged): `floor` + remnant tracked. Alternative policies
  (round-to-nearest, credit remnant to next top-up) change `toCredits` only.
- Paystack transaction-verify reconciliation sweep (polling) — future hardening.
- Refunds, including refunding orphaned debits (the §25.6 reconciliation query supports
  it; the sweep is future work). DVA deactivation/replacement on `deactivated` status —
  future.
- Admin/reconciliation UI for `failed` notifications and debit anomalies.

---

## 25. Balance spend — debit credits when a vendor's profile is delivered

> **Status:** in scope. §1–§24 fund wallets; this section wires the other half — spending.
> Visibility is the product: a vendor's profile is shown to a customer only after the
> vendor pays the visibility fee (`VISIBILITY_FEE_CREDITS`, **100 credits** by default) —
> whether the profile is delivered immediately to the customer or the vendor earned it by
> responding to a fanned-out request. Today the platform only *publishes the intent* to
> bill — `request_deliveries.creditDeducted` is set and `vendor.credit.deducted` is
> emitted, but no balance moves (PHASE-3-4-5-REPORT §6, CREDITS-RECHARGE-REPORT §5). This
> section connects that billing to the wallet built in §7–§18, using the same architecture:
> pure domain, an application service, one atomic adapter transaction, and events.

### 25.1 Scope

In scope:

1. An **atomic, exactly-once debit** of a vendor's credit wallet when their profile is
   delivered immediately (§25.4–§25.5).
2. **Billing-aware immediate selection**: the ranked list is walked in order and only
   vendors with a sufficient balance fill an immediate slot; a vendor who cannot pay is
   skipped (§25.6).
3. A **missed-lead notification with a quick recharge action**, sent to every skipped
   vendor — and to every insolvent responder (§25.7).
4. A **connected notification** to the debited vendor, telling them their profile went to a
   customer so they expect the contact (§25.7).
5. A **free-trial notification** to the unpaid fallback vendor, telling them the lead was
   on the house and the trial mode is temporary (§25.7).
6. **Billing accepted responders.** A fanned-out vendor who responds "Yes, I have it now"
   / "I can get it" pays the same visibility fee before becoming visible to the customer.
   Insolvent responders are never revealed (§25.6).
7. Ledger, events, configuration, wiring, and tests.
8. An **onboarding grant** — `ONBOARDING_GRANT_CREDITS` (2,000) free credits given once to
   every successfully onboarded vendor, so a new profile is solvent from day one
   (§25.12).

Out of scope:

- **Refunds.** Orphaned or disputed debits are surfaced for reconciliation (§25.6) but not
  auto-refunded.
- **Negative balances.** `balanceCredits` never goes below zero — by construction (§25.5).
- **Admin UI** for debits — same future work as `failed` notifications (§24).

### 25.2 Business rules

- **Paid visibility is the product.** Any time a vendor's profile becomes visible to a
  customer — whether via immediate delivery or by responding to a fanned-out request — the
  vendor pays the visibility fee (`VISIBILITY_FEE_CREDITS`, **100 credits** by default).
  One fee, one price, two ways to earn a lead.
- **An immediate paid lead is one immediate delivery of a vendor profile to a customer.**
  `IMMEDIATE_DELIVERY_COUNT` (currently 1) slots are filled from the ranked list.
- **A responding vendor pays on accept.** `recordVendorResponse(accepted: true)` first
  debits the fee, and reveals the vendor only when the debit succeeds. The rule from
  MCOS §6 — "visible only after they explicitly respond" — becomes "visible only after
  they respond **and** the debit succeeds."
- **Only solvent vendors may become visible.** "Solvent" means
  `balanceCredits >= VISIBILITY_FEE_CREDITS`. A vendor with no wallet at all (never
  recharged) has balance 0 and is insolvent.
- **A skipped vendor is never silently ignored.** They get the missed-lead push (§25.7),
  so the cost of not recharging is visible and actionable.
- **The customer always gets an answer.** If no ranked vendor can pay, the top-ranked
  vendor is delivered **unpaid** (`creditDeducted: false`, no debit) rather than the
  customer getting an empty result. The fallback degrades the billing model, never the
  customer experience. The unpaid vendor is told this is a **free trial** (§25.7) — the
  lead was on the house, but the mode is temporary.
- **Never negative.** A debit that would take the balance below zero does not happen; it is
  reported as `insufficient`.
- **A debited vendor is told.** The vendor whose profile went to a customer receives the
  connected notification (§25.7), so the charge is never a surprise and they know to
  expect contact.
- **New vendors are seeded.** `seller.onboarded` triggers a one-time grant of
  `ONBOARDING_GRANT_CREDITS` (2,000) — a fresh vendor is solvent (`2,000 ≥ 100`) and can
  pay for their first leads without recharging (§25.12).

### 25.3 Domain model

`src/domain/models/credit.ts`:

```ts
/** Reasons a credit can be spent (TDR §25). */
export const WALLET_DEBIT_REASONS = {
  /** Immediate delivery — top-ranked vendor profile sent straight to the customer. */
  profileDelivery: 'profile_delivered_to_customer',
  /** Responder becoming visible — a fanned-out vendor accepted the request. */
  responseAccepted: 'responded_to_customer_request',
} as const;

export type WalletDebitResult =
  | { readonly outcome: 'debited'; readonly balanceAfter: number }
  | { readonly outcome: 'insufficient'; readonly balance: number }
  | { readonly outcome: 'duplicate' };
```

`WalletEvents` additions (full table in §14):

```ts
export const WalletEvents = {
  // ...existing...
  Debited: 'wallet.debited',
  DebitInsufficient: 'wallet.debit.insufficient',
  DebitFailed: 'wallet.debit.failed',
} as const;
```

### 25.4 Persistence

Migration: `npx prisma migrate dev --name wallet_debits` (author the SQL; verify with
`migrate dev`, as in §7).

- **`CreditTransaction.amountKobo` → nullable (`Int?`).** A credit records the exact money
  received; a debit records *consumption of credits*, where no naira moved. Store `null`,
  not 0 — 0 would read as "received nothing". The kobo-equivalent of a debit is recoverable
  from `metadata.nairaPerCredit × amountCredits` when a money view is ever needed.
- **New composite index** on `CreditTransaction` for balance statements:
  `@@index([walletId, type, createdAt])`.
- **`RequestDelivery` is unchanged.** `creditDeducted` is already the per-delivery
  billable flag — set for an immediate delivery *or* for a responder who accepted — and
  the unique `(requestId, vendorId)` pair makes a delivery the idempotency root (§25.6).
  No schema change: a responder is a `RequestDelivery` row like any other, and the flag
  already exists for exactly this.

### 25.5 The debit port

`src/domain/ports/outbound/wallet-repository.port.ts` — the exact mirror of
`creditAtomically` (§8.3, §18):

```ts
/** Atomic, exactly-once debit (TDR §25.5). Same discipline as creditAtomically: the
 *  transaction is owned entirely by the adapter and the ledger's unique
 *  providerReference is what makes a retried debit a no-op. Never writes a negative
 *  balance. */
debitAtomically(params: {
  transactionId: string;
  walletId: string;
  amountCredits: number;
  /** Deterministic per billable event → exactly-once. */
  providerReference: string;
  reason: string;
  metadata: Readonly<Record<string, unknown>>;
  at: Date;
}): Promise<WalletDebitResult>;
```

`PrismaWalletRepository` implementation, inside one `prisma.$transaction`:

1. `SELECT ... FOR UPDATE` the wallet row — same serialisation argument as §18.
2. If `balanceCredits < amountCredits` → return `{ outcome: 'insufficient', balance }`,
   commit nothing.
3. Insert the ledger row **first** — `type: 'debit'`, `amountKobo: null`,
   `providerReference`, `reason`, `metadata`, `eventId: null`.
4. Decrement `balanceCredits`; return `{ outcome: 'debited', balanceAfter }`.
5. On `P2002` for `providerReference` → `{ outcome: 'duplicate' }`.

Because the check and the decrement share a transaction with a row lock, the never-negative
invariant is a database property, not an application check (the same argument as §18).

### 25.6 Application layer

`WalletService.debit(params: { userId, amountCredits, reason, providerReference, metadata, at })`:

- `wallets.findByUserId(userId)`; `null` (never recharged) → `{ outcome: 'insufficient', balance: 0 }`.
- Else `wallets.debitAtomically(...)`.
- On `debited`, publish `wallet.debited` (payload §14) and log
  `[Wallet] [WalletService]` with Input/Action/Output per `Execution.md §3`.
- Return the raw result so the caller can branch on `insufficient` / `duplicate`.

`RequestDistributionService.distribute` — the immediate-delivery loop becomes
billing-aware. The strategy lives here and nowhere else (MCOS §4: "the Conversation OS
SHALL remain independent of the distribution strategy"; it already decides `creditDeducted`
today):

1. After creating the `CustomerRequest`, fill each immediate slot by walking the ranked list
   in order — one candidate at a time, resolving the vendor record for each:
   a. **Resolve the vendor**: `prisma.vendor.findUnique({ where: { id: vendorId } })`.
      `vendor.userId` is the wallet key; `vendor.conversationId` is the push target.
   b. **Pre-check** with `walletService.getBalance(vendor.userId)` — cheap, and it avoids a
      debit attempt for a vendor who plainly cannot pay. No wallet or
      `balanceCredits < VISIBILITY_FEE_CREDITS` → add to the skip list (step 4) and continue.
   c. **Debit**:
      `walletService.debit({ userId: vendor.userId, amountCredits: VISIBILITY_FEE_CREDITS,
      providerReference: 'delivery:' + request.id + ':' + vendorId,
      reason: WALLET_DEBIT_REASONS.profileDelivery,
      metadata: { requestId, vendorId, capabilityId, nairaPerCredit }, at })`.
      - `debited` → create the `RequestDelivery` row (`immediate: true`,
        `revealedToCustomer: true`, `creditDeducted: true`), present to the customer,
        publish `request.delivered`, `vendor.profile.delivered` and
        `vendor.credit.deducted` (the unchanged marketplace signal — `wallet.debited` is
        already emitted by `WalletService.debit`), and fire
        `WalletNotifier.notifyConnected(...)` best-effort (§25.7). Fill the slot and stop
        walking.
      - `insufficient` (a race: the balance moved between the pre-check and the debit) →
        add to the skip list (step 4) and continue.
      - `duplicate` → this (request, vendor) was already billed by a retried attempt →
        reconcile: the delivery row exists (or is created now), present it, and fire
        `notifyConnected` **without** a second debit.
2. **Unpaid fallback.** If the walk is exhausted before the slots are filled, deliver the
   top-ranked vendor **unpaid** (`creditDeducted: false`, no debit, no
   `vendor.credit.deducted`) so the customer still gets an answer, and log the degradation
   as a `[RequestDistribution]` stage entry. Remove that vendor from the skip list — they
   *did* receive the lead, so the missed-lead message (step 4) must not contradict it.
   Instead they get the **free-trial notification** (§25.7): this lead was on the house,
   and recharging keeps the opportunities coming.
3. **Fan-out is unchanged** (request-distribution.service.ts:150-170), with one rule: the
   fan-out set is the ranked vendors **not selected** as immediate — this includes every
   skipped vendor. A vendor's delivery row is created either in the immediate selection or
   the fan-out, never both, so the unique `(requestId, vendorId)` pair is never violated.
   **Fanned-out vendors are not billed at distribution time.** They pay the visibility fee
   later, only if they respond (§25.6 responder flow).
4. **Missed-lead path** — for every vendor on the skip list (after the step 2 removal):
   - publish `vendor.credit.insufficient` (producer `RequestDistributionService`, payload
     `{ vendorId, requestId, requiredCredits: VISIBILITY_FEE_CREDITS, balance, capabilityId }`);
   - fire `WalletNotifier.notifyInsufficient(...)` best-effort, **lead variant** (§25.7).
     Never blocks distribution — the same fire-and-forget discipline as the credit
     confirmation (§9.2e).

**Responder billing — `RequestDistributionService.recordVendorResponse`.** Accepting a
fanned-out request is a second paid-visibility path (§25.2). The method's current body
(request-distribution.service.ts:205-254) becomes billing-aware:

1. Resolve the `RequestDelivery` row as today (`delivery === null || status !== 'pending'`
   → no-op). **Nothing below applies to `accepted: false`** — a decline is free, the vendor
   stays hidden, and `request.rejected` is published exactly as today.
2. For `accepted: true`, **debit before revealing**:
   `walletService.debit({ userId, amountCredits: VISIBILITY_FEE_CREDITS,
   providerReference: 'response:' + requestId + ':' + vendorId,
   reason: WALLET_DEBIT_REASONS.responseAccepted,
   metadata: { requestId, deliveryId, capabilityId, product }, at })`.
   - `debited` → set `status: 'accepted'`, `revealedToCustomer: true`,
     `creditDeducted: true`; publish `request.accepted` and
     `vendor.credit.deducted` (`reason: responded_to_customer_request`); fire
     `WalletNotifier.notifyConnected(...)` best-effort (§25.7) so the vendor knows their
     profile is now visible. Return `{ revealed: true }`.
   - `insufficient` → the vendor stays **hidden**, but their acceptance is recorded
     honestly: set `status: 'accepted'`, `revealedToCustomer: false`,
     `creditDeducted: false`; publish `request.accepted` (they did say "Yes, I have it" —
     a positive capability signal, evidence-interpretation.ts:36-39) **plus**
     `vendor.credit.insufficient`; fire `notifyInsufficient(...)` **responder variant**
     (§25.7). Return `{ revealed: false }`. `revealedVendors()` filters on
     `revealedToCustomer`, so an unpaid acceptance never reaches the customer.
   - `duplicate` → a retried response already billed this (request, vendor) → reveal and
     publish `request.accepted` **without** a second debit, mirroring the immediate path.

The fan-out row is the idempotency root: `providerReference = 'response:' + requestId + ':'
+ vendorId` matches the delivery row's unique `(requestId, vendorId)`, so a retried
response never double-charges (E15 applies to this path too). `revealedToCustomer` is set
only after `debited`, so the "shown but unbilled" inverse is impossible here as well.

**Idempotency & safety (read alongside §18):**

- Exactly-once per (request, vendor) on *either* billing path: the immediate ledger key
  `'delivery:' + requestId + ':' + vendorId` and the response key
  `'response:' + requestId + ':' + vendorId` each match the delivery row's unique
  `(requestId, vendorId)`. A retried debit returns `duplicate`, never a second debit, and a
  delivery is billed at most once.
- A turn is processed once (`InboundMessage.processedAt`), so one logical turn produces at
  most one delivery row and one debit per vendor.
- The customer sees only billed deliveries: `revealedToCustomer` is set only after
  `debited` or `duplicate`, on either path. The inverse — shown but unbilled — is
  impossible.
- Residual crash window: a debit commits, then the process dies before the delivery row is
  created (immediate path) or the response is marked revealed (responder path). That leaves
  an orphaned `wallet.debited` row whose delivery was never shown. It is not silently
  lost — `metadata.requestId`/`vendorId` make it queryable and `wallet.debit.failed` (E16)
  surfaces it for ops. **Do not ship the debit path without this reconciliation query**
  (`wallet.debited` rows with no matching `request_deliveries` row); refunding them is
  §25.1 future work.

### 25.7 Notifications — missed lead, connected, and quick recharge

**Responsibility boundary (deliberate):** the *detection* — a vendor could not pay for a
lead — and the *push* are the wallet feature's job, exactly as `WalletNotifier` owns the
credit confirmation (§12). The *recharge conversation itself* is NOT payment code: it is
the `CreditRecharge` workflow (§13). The notification hands off; the workflow answers.

`WalletNotifier.notifyInsufficient(params: { userId, conversationId, businessName,
capabilityName, requiredCredits, balance, variant: 'lead' | 'responder' })` — best-effort,
never throws, same discipline as `notifyCredited`. Two variants, because the situation the
vendor is in differs:

**Lead variant** — a vendor was skipped at immediate-selection time; they never saw the
request:

```text
⚠️ You missed a lead

A customer asked about "{capabilityName}" and your profile was a strong match — but your
credit balance ({balance} credits) was below the {requiredCredits}-credit visibility fee,
so it was not shared.

Recharge now to keep receiving leads.
```

**Responder variant** — a vendor explicitly accepted a fanned-out request but could not pay,
so they were not revealed; the customer never saw them:

```text
⚠️ You said yes — but your profile wasn't shared

You accepted a request for "{capabilityName}", but your credit balance ({balance} credits)
was below the {requiredCredits}-credit visibility fee, so your profile was not sent to the
customer.

Recharge now so your next "Yes" reaches them.
```

both with one action:

```ts
actions: [
  {
    type: 'quick_reply',
    title: '⚡ Recharge Now',
    payload: encodeActionPayload({ workflowId: 'system', action: 'recharge' }),
  },
],
```

**Connected notification** — the mirror image, for the vendor who *did* pay. After a
successful debit on either path the vendor is told their profile went to a customer, so
the charge is not a surprise and they know to expect contact (E18):

`WalletNotifier.notifyConnected(params: { userId, conversationId, businessName,
capabilityName, credits, balanceAfter })`:

```text
🎉 You've been connected

A customer asked about "{capabilityName}" and your profile has been shared with them.
Get ready — they may call or message you shortly.

The {credits}-credit visibility fee has been deducted.
Current Balance:
{balanceAfter} Credits
```

This is the positive counterpart to `notifyInsufficient`, and it carries the same
fire-and-forget guarantee: a failed push is logged via `stageFailed` and never rolls back
the committed debit (§17 E18).

**Free-trial notification** — the unpaid fallback vendor (step 2 of §25.6) got the lead
without paying, so the missed-lead message would contradict what happened. They are instead
told the trial is temporary, so the degradation does not silently become the new normal:

`WalletNotifier.notifyFreeTrial(params: { userId, conversationId, businessName,
capabilityName, credits })`:

```text
🎁 Free trial — this one's on us

A customer asked about "{capabilityName}" and your profile was shared with them — free of
charge this time.

You're in free trial mode, which may end soon. Recharge to keep getting opportunities like
this one.
```

with the same one action:

```ts
actions: [
  {
    type: 'quick_reply',
    title: '⚡ Recharge Now',
    payload: encodeActionPayload({ workflowId: 'system', action: 'recharge' }),
  },
],
```

Same best-effort discipline: a failed push is logged via `stageFailed` and never blocks
distribution (E19).

**Routing the button:** action payloads are the platform's deterministic action channel
(action-payload.ts). `Triage` already maps action suffixes to intents — `|buy` → 
`buyer_product_search`, `|sell` → `vendor_onboarding` (triage.workflow.ts:158-160). Extend
that same branch so a `recharge` action resolves to the `wallet_funding` intent, which
`CreditRecharge` claims by `priority: 50` (§3). `system` is a reserved, non-instance
workflowId: no workflow is resumed — the intent starts a fresh `CreditRecharge`. The tap
therefore needs no new payment logic; it is an ordinary conversation turn.

### 25.8 Configuration

`src/config/env.schema.ts`:

```ts
VISIBILITY_FEE_CREDITS: intFromString(100, 1),
```

`src/config/app-config.service.ts` — extend the `credits` getter (§15.2):

```ts
visibilityFee: this.get('VISIBILITY_FEE_CREDITS'),
```

Document `VISIBILITY_FEE_CREDITS` in the `# ── Paystack (credits funding) ───` section of
`.env.example` (§15.3). The default is **100** — the single visibility fee for both
immediate delivery and responder reveals (§25.2).

### 25.9 Module wiring

- `PrismaWalletRepository` implements `debitAtomically` — no new binding: `WALLET_REPOSITORY`
  already resolves to it (§16.1).
- `WalletService.debit`, `WalletNotifier.notifyInsufficient`,
  `WalletNotifier.notifyConnected` and `WalletNotifier.notifyFreeTrial` live in `WalletModule`
  (§16.2). **Export `WalletNotifier`** (currently module-private, wallet.module.ts:26) so
  the distribution service can reach it.
- `RequestDistributionService` (ConversationModule provider, conversation.module.ts:77)
  injects `WalletService` and `WalletNotifier` — both available because `ConversationModule`
  already imports `WalletModule` (conversation.module.ts:62). No new module is needed.
- `Triage` gains the `recharge` action → `wallet_funding` intent branch (§25.7).

### 25.10 Tests

Unit (`src/**/*.spec.ts`):

- `credit.spec.ts` — unchanged (`toCredits` is untouched); `WalletDebitResult` union shapes;
  both `WALLET_DEBIT_REASONS` values.
- `wallet.service.spec.ts` — `debit` success publishes `wallet.debited`; no wallet →
  `insufficient`; balance below fee → `insufficient`; duplicate `providerReference` → no
  second debit; balance never negative.
- `wallet-notifier.service.spec.ts` — missed-lead copy for both variants; the action payload
  is exactly `mm|system|recharge`; connected-notification copy; free-trial copy; unsupported
  channel → `stageFailed` logged, no throw.
- `request-distribution.service.spec.ts` — billing-aware selection: a solvent vendor fills
  the slot; an insolvent vendor is skipped and notified; the top-ranked vendor is delivered
  unpaid when nobody can pay and receives the free-trial notification; a debit `duplicate`
  still presents the delivery exactly once.
- `request-distribution.service.spec.ts` (responder path) — an accepting solvent responder
  is debited once and revealed; an accepting insolvent responder is **not** revealed
  (`revealedToCustomer: false`), gets the responder-variant push, and `request.accepted` +
  `vendor.credit.insufficient` are published; a decline is never billed; a retried accept
  debits once.

Integration (`test/integration/marketplace-loop.test.ts`, real Postgres):

- A vendor with `VISIBILITY_FEE_CREDITS` (100) credit(s): `distribute` → exactly one
  `wallet.debited` and one `vendor.credit.deducted`, `balanceCredits` decremented once,
  delivery `creditDeducted: true`, vendor revealed, connected notification attempted.
- An insolvent top-ranked vendor: skipped, `vendor.credit.insufficient` published, missed-
  lead push attempted, and the next solvent vendor is delivered instead.
- Nobody can pay: top-ranked vendor delivered `creditDeducted: false`, balance untouched,
  free-trial push attempted.
- Concurrent duplicate distribute for the same delivery: balance debited once.
- A solvent responder accepts: debited once, revealed, `creditDeducted: true`.
- An insolvent responder accepts: never revealed, `vendor.credit.insufficient` published,
  responder-variant push attempted.

### 25.11 Acceptance criteria (addition to §23)

- An immediate delivery debits exactly `VISIBILITY_FEE_CREDITS` (100) credit(s), exactly
  once, and the vendor is shown only after the debit succeeds.
- A vendor without a sufficient balance is never presented as a paid lead, never goes
  negative, and receives the missed-lead notification with the recharge action.
- A fanned-out vendor who accepts is debited `VISIBILITY_FEE_CREDITS` exactly once before
  being revealed; an insolvent responder is never revealed and receives the responder
  variant of the missed-lead notification.
- Both debited paths (immediate and responder) fire the connected notification.
- Tapping "Recharge Now" routes the vendor into `CreditRecharge` without new payment code.
- If no ranked vendor can pay, the top-ranked vendor is still delivered unpaid, so the
  customer always gets an answer — and the unpaid vendor receives the free-trial
  notification rather than the missed-lead one.

### 25.12 Onboarding grant — 2,000 free credits for new vendors

The spend chapter seeds itself: every vendor who completes onboarding is given
`ONBOARDING_GRANT_CREDITS` (**2,000 credits** by default) so a brand-new profile can pay
the visibility fee immediately — the grant funds the first 20 paid leads.

**Trigger.** The wallet feature subscribes to the existing `seller.onboarded` event
(`@OnEvent('seller.onboarded', { async: true })` — the same in-process subscription
pattern `EvidenceProcessor` uses; the transactional outbox relay dispatches it after
commit). `finalizeProfile` already publishes it once, and only on successful onboarding
(status → `active`, vendor-onboarding.service.ts:100-119), so the grant inherits
"successfully onboarded" for free. The producer (CapabilityDiscoveryEngine) does not
change.

`WalletOnboardingGrantListener` (a `WalletModule` provider) resolves the vendor's
`userId` via `VENDOR_REPOSITORY.findById(event.vendorId)` (globally bound,
infrastructure.module.ts) — the event carries `vendorId` and `conversationId` but not the
E.164, and the listener must not depend on a new event contract:

```ts
@OnEvent('seller.onboarded', { async: true })
async onSellerOnboarded(event: DomainEvent): Promise<void> {
  const vendor = await this.vendors.findById(event.vendorId);
  if (!vendor) {
    this.logger.stageFailed({
      component: 'Wallet', stage: 'OnboardingGrant',
      input: { vendorId: event.vendorId },
      action: 'Could not resolve the vendor; no grant given',
      error: new Error('vendor not found'),
    });
    return;
  }
  await this.wallets.grantOnboardingCredits({
    userId: vendor.userId,
    conversationId: vendor.conversationId,
    businessName: event.payload.businessName as string,
    at: this.clock.now(),
  });
}
```

**The grant is the wallet's first materialization.** A brand-new vendor has never
recharged, so `findByUserId` returns null. `WalletService.grantOnboardingCredits`
therefore `create`s the wallet first (create-if-absent — returns the persisted row if a
concurrent create won, wallet-repository.port.ts:22) and then grants. The lazy
provisioning rule gains a second creation point: the onboarding grant, alongside the
first "Recharge" request.

**Exactly-once.** New port method on `WalletRepositoryPort`, the credit twin of
`debitAtomically` — same create-first ledger insert, `SELECT ... FOR UPDATE`, balance
increment discipline as §18, minus the PaymentNotification settle (a grant has no payment
to settle):

```ts
grantAtomically(params: {
  transactionId: string;
  walletId: string;
  amountCredits: number;
  providerReference: string;
  reason: string;
  metadata: Readonly<Record<string, unknown>>;
  at: Date;
}): Promise<{ outcome: 'credited'; balanceAfter: number } | { outcome: 'duplicate' }>;
```

`providerReference = 'onboarding:' + vendorId` (deterministic, mirrors the
`'delivery:...'` / `'response:...'` schemes of §25.6). A redelivered or replayed
`seller.onboarded` hits the ledger's unique constraint → `P2002` → `duplicate` → no second
grant (§18). Ledger row: `type: 'credit'`, `amountKobo: null` (no naira moved — nullable
per §25.4), `reason: 'onboarding_grant'`, `metadata: { grant: 'onboarding',
triggeredBy: 'seller.onboarded' }`.

**Event.** `wallet.onboarding_credited` — `{ walletId, userId, credits, balanceAfter,
providerReference }` — the audit/analytics surface for grants, kept distinct from
`wallet.credited` so a payment landing and a grant are never confused (§14).

**Notification.** `WalletNotifier.notifyOnboardingCredit(params: { userId, conversationId,
businessName, credits, balanceAfter })`, best-effort like every wallet push (E20):

```text
🎉 Welcome to Konnet!

{credits} free credits have been added to your account to get you started.

Current Balance:
{balanceAfter} Credits
```

No action button — the vendor is funded; a recharge action would be noise. A failed push
is logged via `stageFailed` and never rolls back the committed grant (E20).

**Configuration** — `src/config/env.schema.ts`:
`ONBOARDING_GRANT_CREDITS: intFromString(2000, 1)`; `app-config.service.ts`: add
`onboardingGrant: this.get('ONBOARDING_GRANT_CREDITS')` to the `credits` getter (§15.2);
document the var in `.env.example` (§15.3).

**Module wiring** — `WalletOnboardingGrantListener` is a `WalletModule` provider
(wallet.module.ts, §16.2) injecting `WALLET_REPOSITORY`, `VENDOR_REPOSITORY` (global),
`WalletNotifier`, `EVENT_PUBLISHER`, `CLOCK` and the stage logger. No new module.

**Tests** — unit `wallet-onboarding-grant.spec.ts`: grant credits `ONBOARDING_GRANT_CREDITS`
exactly once; a replayed `seller.onboarded` → `duplicate`, balance unchanged; a brand-new
vendor (no wallet) gets a wallet created and 2,000 credits; `wallet.onboarding_credited`
published with the grant `providerReference`; push failure → `stageFailed`, grant stays
committed (E20). Integration (`test/integration/marketplace-loop.test.ts`): onboarding →
balance 2000 → a paid lead debits `VISIBILITY_FEE_CREDITS` → balance 1900.

**Acceptance** — a successfully onboarded vendor immediately holds
`ONBOARDING_GRANT_CREDITS` and can pay the visibility fee without recharging; the grant is
given exactly once no matter how many times `seller.onboarded` is redelivered.

---

*End of TDR.*
