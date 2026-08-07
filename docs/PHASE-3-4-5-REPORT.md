# Phases 3–5 Report — Evidence, Matching, Fulfilment

**Date:** 2026-08-07
**Scope:** Execution.md Phases 3, 4 and 5
**Status:** Implemented and tested. The implementation is now feature-complete against the five
phases; open issues are listed in §6.

---

## 1. What was built

### Phase 3 — Evidence Service

| Deliverable | Where |
|---|---|
| Event bus architecture | Existing outbox + wildcard subscription in `evidence-processor.service.ts` |
| Raw Event Store (immutable) | `MarketplaceEvent` model |
| Evidence Processor & Aggregator | `evidence-processor.service.ts` |
| Internal evidence APIs | `evidence-query.service.ts` |

Producers publish events and stop there; nothing outside the service writes evidence. Storage
happens on the event, interpretation on a sweep — so a bug in interpretation can be fixed and the
backlog reprocessed, because the raw facts were never lost.

### Phase 4 — Capability Matching Engine

Search Mode Classifier (Item/Descriptive/Business/Vibe), Demand Understanding, Ambiguity Manager,
three-graph Semantic Expansion, canonical resolution to GPC, broad candidate retrieval, evidence
lookup and explainable ranking — `src/application/matching/`.

### Phase 5 — Demand-driven fulfilment

Buyer Search workflow, immediate top-vendor delivery, vendor notification and credit deduction,
request creation, async fan-out, response collection, customer visibility rules and a timeout
sweeper — `buyer-search.workflow.ts`, `request-distribution.service.ts`.

---

## 2. Design decisions worth knowing

**Small-sample correction is the heart of fair ranking.** A vendor who accepted 1 of 1 requests
has a raw rate of 100%; one who accepted 45 of 50 has 90%. Ranking on the raw rate puts the
newcomer first on the strength of a single event. Every rate goes through a **Wilson lower
bound** first (20.7% versus 78.9%), so vendors earn their position and one unlucky rejection
cannot destroy an established one.

**Cold start is not a life sentence.** A vendor with no history scores exactly *neutral*, not
zero, and their evidence weight is faded in by its own confidence — the unused weight is
redistributed to capability match. A brand-new vendor who genuinely matches the request therefore
outranks a proven-poor one, instead of being permanently mid-table.

**Rejecting is good behaviour and bad inventory.** `request.rejected` records `responded` as
positive and `rejected` as negative. Collapsing them would punish honest vendors for replying.

**Silence has to be recorded.** Without an explicit `request.timeout` event, a vendor who ignores
everything would look like one with *no history* rather than a poor record, and ignoring requests
would carry no cost at all.

**Only the delivered vendor is billed.** The top-ranked vendor is revealed and charged; fan-out
recipients are asked but hidden until they respond. Charging speculative recipients would bill
vendors for introductions that never happened.

**Ambiguity blocks retrieval rather than filtering it.** When "printer" could mean four different
trades, no retrieval runs at all — showing a list assembled from the wrong reading is worse than
one question (CME Test 2).

---

## 3. Verification

```
Unit:        161 passed, 13 suites
Integration:  65 passed,  6 suites   (real Postgres + Redis)
Lint + typecheck: clean
Boot: clean, all five phases together, health ok
```

New suites: 25 evidence-scoring specs, 16 ranking specs, 12 Evidence Service integration tests
and 11 marketplace-loop tests.

### The loop actually closes

`marketplace-loop.test.ts` runs ten rounds of a real marketplace against real Postgres: one vendor
performs (accepts, is selected, completes), the other ignores every request. Afterwards the
Evidence Service ranks the reliable vendor above the unreliable one with confidence > 0.4, and the
explanation reads *"Completed 10 transactions."*

That is the thesis of the whole architecture — *the marketplace itself becomes the teacher* —
demonstrated rather than asserted.

---

## 4. Defect found during integration

The Phase 1 pipeline test began failing the moment `BuyerSearch` registered. That was correct
behaviour, not a regression: `BuyerSearch` outranks `Triage` on `buyer_product_search` by policy
priority, so buyer messages now reach the CME. The test was asserting superseded behaviour and has
been updated. Worth noting because it is the mechanism the platform was designed around — a new
workflow takes over an intent by registering, with no change to the conversation platform.

---

## 5. What the phases now do end to end

```
Vendor: "I sell electrical materials in Aba"
  → VendorOnboarding → CDE → Capability DNA → vendor searchable

Buyer: "I need a hammer"
  → BuyerSearch → CME (mode → ambiguity → expansion → GPC → retrieve → evidence → rank)
  → top vendor delivered immediately, notified, billed
  → request fanned out to the rest
  → responders revealed as they accept; silence recorded as no-response
  → selection and completion published

  → Evidence Service consumes all of it → next search ranks better
```

---

## 6. Open issues and deliberate gaps

| Issue | Status |
|---|---|
| **"Features not working" in your local WhatsApp testing** | Unresolved — I still need the specifics. Messaging works; I do not know which feature misbehaved. |
| **Discovery and matching run inside the conversation turn** | Measured at 13–18s for the CDE. The CME adds its own calls. The queue infrastructure is already in place; moving both off the turn path is the single biggest UX improvement left. |
| **Post-interaction micro-polling** | Not built. Phase 5 lists it; the entropy machinery it needs (`highestEntropyCapabilities`) exists and is unused. |
| **Cognitive Load-Aware Discovery** | Not built. Requires a per-user model of patience, literacy and fatigue that nothing yet collects. |
| **Vendor credit balances** | Deduction is published as an event; no ledger holds a balance. Billing is a separate service in the TDR. |
| **Proximity is city-equality, not distance** | No geocoding. `proximityScore` handles real distances, but nothing supplies them; unknown distance is scored neutral rather than guessed. |
| **Learning-to-Rank** | CME §18 future work. Ranking components are stored separately specifically so a model has features to learn on. |
| **Voice and USSD channels** | Adapters not written. WhatsApp and SMS only. |

---

## 7. Recommended next step

Not another phase — **the deferred latency work and your bug report**. The system is
feature-complete but every conversational turn currently waits on several sequential model calls.
Moving discovery and matching onto the existing BullMQ queue, and fixing whatever you saw locally,
would do more for it than new features.
