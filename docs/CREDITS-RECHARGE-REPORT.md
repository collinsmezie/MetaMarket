# Konnet Credits Recharge — Implementation Report

**Date:** 2026-08-07
**Spec:** [`docs/design/Konnet-Credits-Recharge-TDR.md`](design/Konnet-Credits-Recharge-TDR.md)
**Status:** Implemented and tested. Live Paystack calls are unverified — no key is configured.

---

## 1. Architecture fit — verified, not assumed

You asked me to check the TDR integrates cleanly before building. Every integration claim it
makes was checked against the code:

| TDR claim | Verified |
|---|---|
| `conversation.module.ts` builds the workflow registry at boot | ✓ |
| Intent prompt derived from `definitions.all().flatMap(startingIntents)` | ✓ line 102 |
| `Triage` claims `wallet_funding` at `priority: -100` | ✓ line 194/207 |
| `resolveByIntent` sorts by descending priority | ✓ line 33 |
| Outbox persists before dispatch; `EvidenceProcessor` wildcard-subscribes | ✓ `@OnEvent('**')` |
| `main.ts` captures `rawBody` | ✓ lines 30–32 |
| `shouldResolveSemantics` skips non-search intents | ✓ lines 182–184 |

Two corrections:

- **`app.module.ts` is at `src/`, not `src/config/`.** Trivial path slip in the TDR.
- **One deliberate deviation, §8.3.** The TDR proposes
  `markCreditedInTransaction(tx: unknown, ...)` on a domain port — that passes a Prisma
  transaction handle across the hexagonal boundary, which ADR-001 exists to prevent, and it
  would let a caller perform half of an atomic operation. Instead the whole credit is one port
  method, `WalletRepositoryPort.creditAtomically(...)`, with the transaction owned entirely by
  the adapter. Same guarantee, no leak, and `CREDIT_TRANSACTION_REPOSITORY` is not needed.

---

## 2. Exactly-once crediting

Money correctness comes from database constraints, not application checks. Inside one
transaction:

1. `SELECT … FOR UPDATE` the wallet — two *different* payments to the same wallet serialise, so
   the balance is consistent under any interleaving.
2. Insert the ledger row **first**. Its unique `providerReference`/`eventId` is the guarantee: a
   concurrent duplicate loses here and commits nothing.
3. Only then increment the balance and settle the notification.

Because the constraint guards the money row rather than the notification row, a crash anywhere
after step 2 is safe to replay — the replay's insert fails and the balance never moves twice.

**A real flaw found while testing:** the first `claimNext` used read → `updateMany` → re-read.
Between the update and the re-read *both* workers see the row as `processing` and both proceed.
The ledger constraint would still have prevented a double credit, but two workers would duplicate
the work and race on the notification's status. Replaced with a single
`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *` — the standard Postgres
work-queue claim, where concurrent workers take disjoint rows and each is handed only what it
actually transitioned.

---

## 3. Verification

```
Unit:        224 passed, 19 suites   (was 166)
Integration:  79 passed,  7 suites   (was 66)
Lint + typecheck: clean
Boot: clean, /webhooks/paystack registered, health ok
```

Every row of the TDR's E1–E13 failure table has a test. The ones that matter most:

- **Concurrent duplicate delivery** — two signed webhooks with the same reference posted
  simultaneously, two workers claiming simultaneously: balance credited once, one ledger row.
- **Below minimum** (₦50 at ₦100/credit) — not credited, recorded as `below_minimum`, and the
  ₦50 preserved as `remnantKobo` on a `wallet.credit.failed` event. The user's money is
  reconcilable, never silently gone.
- **Unknown account** — recorded as `unmatched_account`, still answered 200 so Paystack does not
  retry-storm.
- **Paystack unavailable** — the recharge turn still shows the real balance with "being set up",
  never the generic fallback envelope.
- **Unsigned webhook** — 403, nothing recorded, nothing credited.

Money math is pinned by a conservation property: `credits × rate + remnant === amount` for every
tested input, and `toCredits` never throws on any input including NaN and Infinity — it sits on
the webhook path, where a throw becomes a retry storm.

---

## 4. Trying it locally

```bash
npm run build
# 1. Provision and view the funding account
node dist/cli/send-test-webhook.js "Recharge"
# 2. Simulate a bank transfer to the account number shown
npm run webhook:payment -- --account <accountNumber> --naira 5000
# 3. Re-run step 2 with the same --reference to prove it credits exactly once
```

Both CLIs sign their payloads exactly as the real providers do, so they exercise verification
rather than bypassing it.

---

## 5. Not done

| Gap | Why |
|---|---|
| **Live Paystack verified** | No `PAYSTACK_SECRET_KEY` configured. The adapter is written and unit-tested against fakes; the real two-step customer→DVA exchange is unproven. Add a test key and run the CLI to close this. |
| ~~**Spending credits**~~ | **Closed by §7 below.** |
| **Reconciliation UI** | `failed` notifications and orphaned debits are queryable — `npm run wallet:reconcile` covers the second — but neither has an operator surface. |
| **Refunds, DVA deactivation, Paystack verify-polling** | TDR §24 future work. |

---

## 6. Also in this change: the clarification bug

Separately from the credits feature, the behaviour you reported from local testing is fixed.
"I sell sport materials" was answered with "what kind of sport materials do you sell?".

Two causes. The clarification gate keyed on ambiguity and ignored information density; and more
importantly the understanding prompt was not expanding unlisted domains at all — it returned an
empty archetype and echoed the whole sentence back as one product term.

Measured against the real model after the fix:

| | Before | After |
|---|---|---|
| Density | `low` | `medium` |
| Archetype | *(empty)* | sports goods shop (0.90) |
| Implied products | none | footballs, jerseys, boots, tracksuits, gym equipment… |
| Clarification | asked | none |

A spec conflict was resolved in your favour and is worth recording: Vendor-Onboarding.md §2 uses
"I sell electrical things" as its worked clarification example, but the CDE rates that same
phrase as medium density and calls broad statements "seeds from which the system grows
understanding". Density now decides, so that example no longer triggers a question.

---

## 7. Balance spend — TDR §25

**Date:** 2026-08-07 · **Spec:** TDR §25 (§25.1–§25.12)

This closes the gap §5 flagged: credits could be added but never spent. A vendor's profile now
reaches a customer only after the vendor pays `VISIBILITY_FEE_CREDITS` (100), on either of the
two paths that make a vendor visible — immediate delivery, or accepting a fanned-out request.

### 7.1 Architecture fit — three adjustments before implementing

You asked me to check the approach before building. Most of §25 slots in unchanged: the debit is
the exact mirror of `creditAtomically`, the delivery row is already the idempotency root, and
`ConversationModule` already imports `WalletModule`. Three things in the TDR would not have
worked as written.

**① The "Recharge Now" button would not have reached the recharge workflow.** §25.7 says to
extend Triage's action branch (`|buy` → `buyer_product_search`) so `recharge` → `wallet_funding`.
That branch is inside Triage's `AwaitDetail` state, which is only reached when a Triage instance
is already parked waiting for an answer — not the situation a vendor is in when a missed-lead
push arrives. Worse, the tap never gets that far: `ConversationContinuityAnalyzer` treats *any*
decodable payload as a `continuation` (continuity-analyzer.service.ts:133), which makes
`TurnProcessor` skip intent resolution entirely (turn-processor.service.ts:136), after which the
Workflow Manager looks for an instance called `system`, finds none, and either resumes an
unrelated open workflow or returns the generic fallback envelope.

Fixed by making `system` a first-class reserved id instead of a convention:
`src/domain/workflows/system-actions.ts` maps `mm|system|<action>` to a starting intent; the
continuity analyzer reads it as `new` rather than a continuation, and the turn processor
synthesises the `IntentResult` directly. Triage is untouched. The tap costs zero LLM calls,
which is the right property for a money flow — there is an integration test asserting the model
is never consulted, and another asserting a user *typing* "system recharge" gets no such
shortcut.

**② The balance pre-check before the debit (§25.6.1b) is a liability, not an optimisation.**
The TDR proposes `getBalance` first, "cheap, and it avoids a debit attempt". It is not cheaper —
`debitAtomically` is one transaction either way — and its answer is formed outside the row lock,
so a concurrent recharge or debit can invalidate it before it is acted on. The TDR then has to
add a second `insufficient` branch to catch exactly that race. Dropped: `debit` is called
directly and `insufficient` carries the balance the refusal was actually based on, which is also
the number the vendor is shown. One query fewer, one race fewer, one source of truth.

**③ The `duplicate` branch on the immediate path needed a delivery-row story.** §25.6 says to
"present it — the delivery row exists (or is created now)", but `requestDelivery.create` would
throw on the unique `(requestId, vendorId)` pair when the row does exist. `recordDelivery` takes
a `tolerateExisting` flag and upserts on that branch only, so the normal path still fails loudly
on an unexpected duplicate.

Two smaller deviations: `RequestDistributionService` resolves vendors through
`VENDOR_REPOSITORY.findById` rather than `prisma.vendor.findUnique` (§25.6.1a) — the port exists
and returns exactly `userId`/`conversationId`; and the immediate walk is bounded to the top
`IMMEDIATE_DELIVERY_COUNT + FANOUT_LIMIT` candidates, so an insolvent marketplace cannot turn one
search into a wallet lookup per ranked vendor.

### 7.2 What ships

| Piece | Where |
|---|---|
| `debitAtomically`, `grantAtomically` | `wallet-repository.port.ts`, `prisma-wallet.repository.ts` |
| `WalletService.debit`, `.grantOnboardingCredits` | `wallet.service.ts` |
| Billing-aware selection + responder billing | `request-distribution.service.ts` |
| Missed-lead, connected, free-trial, welcome pushes | `wallet-notifier.service.ts` |
| Onboarding grant on `seller.onboarded` | `wallet-onboarding-grant.listener.ts` |
| Reserved `system` action routing | `system-actions.ts` + continuity analyzer + turn processor |
| Orphaned-debit reconciliation | `src/cli/wallet-reconcile.ts` (`npm run wallet:reconcile`) |
| `amountKobo` nullable, `(walletId, type, createdAt)` index | `20260807140000_wallet_debits` |
| `VISIBILITY_FEE_CREDITS=100`, `ONBOARDING_GRANT_CREDITS=2000` | `env.schema.ts`, `.env.example` |

### 7.3 Why a vendor can never be shown without paying, or charged without being shown

The first half is structural: `revealedToCustomer` is set only after the debit returns `debited`
or `duplicate`, on both paths. There is no ordering of the code that produces the inverse.

The second half is not fully closable without putting a Prisma transaction across the hexagonal
boundary, which ADR-001 exists to prevent. A debit can commit and the process can die before the
delivery row is written. §25.6 is explicit that the debit path must not ship without a query for
that state, so `npm run wallet:reconcile` ships with it: it reads the request and vendor back out
of the ledger reference (`delivery:<req>:<vendor>`), left-joins `request_deliveries`, and reports
every debit with no delivery, an unrevealed delivery, or an unbilled one — exiting non-zero so a
scheduled run can alert. Verified against a hand-planted orphan. Refunding is still manual
(§25.1).

Never-negative is a database property rather than a caller's discipline: the balance check and
the decrement share one transaction with the wallet row locked `FOR UPDATE`. A caller cannot get
it wrong by forgetting to check, because checking is not what makes it safe.

### 7.4 Verification

```
Unit:        251 passed, 22 suites   (was 224/19)
Integration:  92 passed,  7 suites   (was 79/7)
Lint + typecheck + build: clean
Boot: clean — /webhooks/whatsapp, /health, /webhooks/paystack
npm run wallet:reconcile: clean on a real database, and detects a planted orphan
```

The billing tests run against real Postgres and the real `PrismaWalletRepository`, not a mocked
one — the guarantees are database guarantees, so a fake database would test nothing. The ones
that matter:

- **Exactly one debit per lead**, `amountKobo` null, connected push attempted, fanned-out vendors
  untouched.
- **Insolvent top-ranked vendor** — skipped, `vendor.credit.insufficient` published, lead-variant
  push, and the next solvent vendor delivered instead. They are still fanned out, so they can
  earn the lead by answering.
- **Nobody can pay** — top-ranked vendor delivered `creditDeducted: false`, no
  `vendor.credit.deducted`, free-trial push instead of the missed-lead one.
- **Never negative** — three leads against a one-lead balance leaves exactly 0.
- **Insolvent responder** — `status: accepted` (they do have the product; that is real evidence)
  but `revealedToCustomer: false`, responder-variant push, and `revealedVendors` never returns
  them.
- **A decline is never billed.**
- **Grant once** — a replayed `seller.onboarded` returns `duplicate`, balance stays 2,000, and the
  first lead takes it to 1,900.

Two existing suites needed updating for reasons worth recording rather than hiding. The
marketplace-loop helper now funds vendors by default, because after §25.12 that *is* production —
an unfunded vendor is the exception. And vendor-onboarding's `send()` helper now returns the
turn's own reply instead of "the last message sent", since onboarding legitimately produces a
second, system-initiated message now.

One environmental fix, unrelated to §25 but it was breaking the suite: your `.env` now holds a
real `PAYSTACK_SECRET_KEY`, and integration tests fell through to it, so every self-signed test
webhook looked forged (403). `.env.test` now pins `sk_test_secret`, which is what that file is
for.

### 7.5 Flags for you

- **The economics are the TDR's, not mine.** At `NAIRA_PER_CREDIT=100`, a lead costs the vendor
  ₦10,000 and the onboarding grant is ₦200,000 of free value per vendor — enough for 20 leads.
  Both are single env vars; no code changes if you want different numbers.
- **A skipped vendor is both told "you missed a lead" and fanned out the same request.** §25.6
  steps 3 and 4 both say so and I implemented it as written. Today it reads fine because nothing
  actually pushes a fan-out message to vendors — that is still unimplemented from Phase 5. When
  it lands, the same vendor would receive "you missed a lead" and "here is a lead" for one
  request, and the copy will need reconciling.
- **No `request-distribution.service.spec.ts`.** §25.10 asks for unit tests there. The service
  talks to Prisma directly and has never had a unit spec; mocking Prisma to assert billing order
  would test the mock. The behaviour is covered by ten integration tests against real Postgres
  instead, which is stronger evidence for the same claims.
- **`MIN_RECHARGE_NAIRA` still does not exist** (pre-existing, §23). The effective minimum is one
  credit's worth, and anything below it is recorded as `below_minimum` rather than credited.
