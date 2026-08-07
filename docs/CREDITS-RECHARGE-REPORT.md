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
| **Spending credits** | Out of scope per TDR §24. Note the gap it leaves: `vendor.credit.deducted` (Phase 5) is published but nothing debits a balance, so fan-out billing and this wallet are not yet connected. |
| **Reconciliation UI** | `failed` notifications are queryable but have no operator surface. |
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
