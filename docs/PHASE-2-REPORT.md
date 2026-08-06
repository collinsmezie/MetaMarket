# Phase 2 Report — Vendor Onboarding & Capability Discovery

**Date:** 2026-08-06
**Scope:** Execution.md Phase 2, "Seller Intelligence & Onboarding"
**Status:** Implemented and tested, including a live-model probe against the design docs' own
test cases. The Phase 1 live-WhatsApp gate remains outstanding by your decision.

---

## 1. What was built

| Deliverable (Execution.md Phase 2) | Where |
|---|---|
| Vendor Onboarding Workflow (max 1 clarification, location parsing, business name) | `src/domain/workflows/definitions/vendor-onboarding.workflow.ts` |
| CDE seed logic — initial Capability DNA and capability graph | `src/application/capability/capability-discovery.service.ts` |
| Persistence for vendor profiles and capability confidence scores | `prisma/schema.prisma`, `prisma-vendor.repository.ts` |

Supporting components the above required:

- **Capability Resolver** (`capability-resolver.service.ts`) — the first-class component the CDE
  spec demands. Products resolve against the seeded GS1 GPC by hybrid retrieval then AI
  *ranking*; services are reasoned out and reconciled against a registry.
- **Business Understanding** (`business-understanding.service.ts`) — Conversation Understanding,
  Market Language, Semantic Compression and Prototype Generation in one call.
- **Onboarding Extraction** (`onboarding-extraction.service.ts`) — Information Before Questions.
- **Bayesian belief model** (`domain/models/capability.ts`) and **hierarchy propagation**
  (`domain/models/capability-graph.ts`).

---

## 2. Design decisions worth knowing

**Belief is derived, never mutated.** Every observation appends immutable evidence, and beliefs
are recomputed from the whole history each time. That costs more per turn and buys two things:
any capability score is explainable from its evidence, and improving the weighting rules
improves every existing vendor retroactively.

**Log-odds, not probabilities.** Evidence accumulates by addition, so no observation needs to
know about any other. Weight is the product of source reliability × information density ×
directness, decayed by age with a half-life of one year and a floor so old evidence fades but
never becomes worthless.

**Source ordering is the substance.** A vendor's explicit correction outranks a customer
confirmation, which outranks a completed match, which outranks an accepted request, which
outranks anything the vendor said about themselves — and an LLM's expansion ranks lowest of all.
This is CME §12's "marketplace evidence always overrides AI assumptions", expressed as numbers.

**Negative evidence propagates sideways but not upward.** Rejecting an MCCB request says nothing
against Electrical as a whole; propagating it would let one "no" erode a capability the vendor
genuinely has. It does propagate weakly to siblings.

**Services are the one place a model may name things** — GPC covers products only. Fragmentation
is prevented downstream instead: every proposed service capability is matched against the
registry by embedding similarity (≥0.93) before a new entry is created, so "generator repair"
and "fixing generators" converge on one identifier.

---

## 3. Verification

```
Unit:        120 passed, 11 suites
Integration:  42 passed,  4 suites  (real Postgres + Redis)
Lint + typecheck: clean
```

New coverage: 35 belief-model specs, 10 propagation specs, 13 onboarding-workflow specs, and a
6-case integration test driving complete onboarding conversations end to end.

### Live probe against the docs' own test cases

`node dist/cli/capability-probe.js "<statement>"` runs a real statement through the real model.

**CDE Test Case 1 — "I sell household items"** (the doc's stated litmus test: *"If the system
cannot intelligently handle this, it will almost certainly fail on the informal market"*).

The engine states nothing, implies everything, and resolves to real GPC bricks:

```
STATED  : (none)
IMPLIED : cookware (0.55), kitchen utensils (0.55), plates and cups (0.50),
          plastic storage (0.50), buckets and basins (0.48), brooms and mops (0.46),
          detergents (0.45), toilet tissue (0.42), soap (0.40), candles (0.35)

RESOLVED: Hob Pots/Pans/Woks, Food/Beverage Storage Containers, Laundry Detergents,
          Bleach, Soap - Body, Brooms/Brushes, Buckets, Mops, Plates, Mugs/Cups,
          Toilet Paper, Candles, Spatulas/Scoops/Ladles …
```

Nothing is asserted as fact. Every capability is a hypothesis at honest confidence, which is
precisely the behaviour the doc asks for.

**CDE Test Case 3 — "I repair generators"** resolves to `Generator Repair` (0.95), then
Maintenance (0.92), Installation (0.90), Engine Diagnostics (0.88), Motor Rewinding (0.85),
Carburetor Repair (0.82), down to Small Engine Repair (0.65) — the graded expansion the spec
describes, so a buyer whose generator will not start reaches this vendor through diagnostics
even though they never said that word.

---

## 4. Defects found and fixed

**Confidence was uselessly low.** A vendor stating "I sell electrical materials" produced 6.6%
confidence in that capability. The prior was set for "a capability drawn at random from 6,500
GPC bricks", but a belief only exists once something has pointed at it — a completely different
reference class. Recalibrated, with the target range now pinned by explicit specs so it cannot
drift silently.

**The resolver accepted its own tail.** "I repair generators" resolved to sixteen product
capabilities including *Vacuum Cleaner Filters* and *Air Purifiers*. Retrieval is deliberately
broad, so the bottom of a candidate list is mostly wrong. Now capped at three selections per
term with a 0.6 confidence floor.

**Resolution took 116 seconds.** Each term costs a retrieval plus a ranking call and a broad
statement expands to a dozen terms — sequentially that is two minutes of silence before the
vendor's next question. Parallelised: **116s → 33s**.

---

## 5. The OpenAI outage nobody would have noticed

The live probe revealed that **every OpenAI call was failing** with:

```
OpenAI API error 400: Unsupported value: 'temperature' does not support 0 with this model.
```

Your `.env` sets `OPENAI_MODEL` twice and `dotenv` keeps the **last** occurrence, so `o3` is the
active model — not `gpt-4o`, as the Phase 1 report incorrectly stated. `o3` is a reasoning model:
it rejects `temperature` and renames the output cap to `max_completion_tokens`.

Every request was silently failing over to Anthropic and succeeding, so the system looked
healthy while the primary provider was 100% unusable and every call paid a wasted round trip
first. This is the failure mode the fallback chain is *supposed* to absorb — but absorbing it
invisibly is its own hazard.

Fixed in `openai-llm.adapter.ts`: reasoning models are detected and sent the right parameters.
Confirmed by re-running the probe — **10 of 10 calls now complete via OpenAI, zero failovers**.

### Two things for you to decide

1. **Is `o3` intended for the interactive path?** It works now, but it is a reasoning model:
   understanding takes ~11s per call and a full statement resolution ~33s. On WhatsApp that is a
   long silence. `gpt-4o` would cut it to a few seconds at much lower cost. My recommendation is
   `gpt-4o` for the conversational path; keep a reasoning model for offline analysis if you want
   one. I have not changed your setting.
2. **Clean up the duplicated `.env` block?** The pasted `konnet` section also leaves
   `TWILIO_MESSAGING_FROM` empty (so SMS delivery is unconfigured) and adds unused keys.

---

## 6. Deliberate gaps

| Gap | Why |
|---|---|
| **Discovery runs inside the conversation turn** | Correct today, but the CDE is conceptually a background learner. The clean design is to answer the vendor immediately from the understanding call and offload resolution + evidence to the BullMQ queue already in place. Worth doing before scale; not needed for correctness. |
| **Curiosity Engine / post-onboarding questions** | CDE §17 and Principle 7 describe progressive questioning after onboarding ("What did you sell today?"). Phase 2's mandate is onboarding and seed DNA; the entropy machinery it needs (`highestEntropyCapabilities`) is implemented and unused. |
| **Behavioural learning loop** | `observeBehaviour` is implemented and unit-tested but nothing calls it yet — it activates in Phase 5 when requests are fanned out and vendors accept or reject them. |
| **Cognitive Load-Aware Discovery** | Explicitly a Phase 5 deliverable. |
| **Location is confirmed, never geocoded** | The workflow infers the state from the city via the model and confirms conversationally, exactly as Vendor-Onboarding.md Step 3 specifies. No lat/long is derived; the columns exist for when a vendor shares a pin. |

---

## 7. Next

Phase 3 (Evidence Service) is unblocked: `seller.onboarded` and `seller.capability.confirmed`
already publish through the transactional outbox, and the immutable evidence store is the shape
the Evidence Service consumes.

The Phase 1 live-WhatsApp gate is still outstanding and now covers Phase 2 too — a real vendor
onboarding conversation over WhatsApp would verify both phases at once.
