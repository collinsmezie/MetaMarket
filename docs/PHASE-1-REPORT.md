# Phase 1 Report — Multi-Channel Conversation OS

**Date:** 2026-08-06
**Scope:** Execution.md Phase 1, "Platform Core Foundation"
**Status:** Implemented and tested. **The live-WhatsApp phase gate has not been run** — it needs
credentials and a public tunnel that only you can supply (see *Gate* below).

---

## 1. What was built

### Conversation OS core

| Deliverable (Execution.md §5, Phase 1) | Where | Notes |
|---|---|---|
| Canonical Message & Response interfaces | `src/domain/models/` | Text, image, audio, video, document, contact, location, button, list |
| WhatsApp Channel Adapter | `src/adapters/inbound/whatsapp/` | HMAC verification, always-200, batch handling |
| Conversation Context Manager | `src/application/conversation/` | Postgres persistence + Redis locking |
| Workflow Manager + Workflow Engine | `src/domain/workflows/` | 6-layer discovery, deterministic FSM |
| Terminal logging middleware | `src/shared/logging/` | Execution.md §3 format exactly |

### Beyond the minimum

These were needed to make the above actually correct, so they are in Phase 1 rather than deferred:

- **Multi-provider LLM service** (Execution.md §2.4) — OpenAI primary, Gemini and Anthropic
  fallbacks, per-provider circuit breakers, exponential backoff, uniform Zod validation, and a
  `FALLBACK_ENVELOPE` when everything fails.
- **Media pipeline** — BullMQ queue, Whisper transcription, vision OCR, S3/MinIO archival, and
  an atomic multi-part completion tracker.
- **Transactional outbox** — events are committed with the state change that caused them, then
  relayed; a crash cannot lose marketplace evidence.
- **Workflow expiry sweeper** — prevents the hung sessions Execution.md §2.5 prohibits.
- **SMS adapter (Twilio)** — a second real channel, proving the abstraction rather than asserting it.
- **GS1 GPC taxonomy + hybrid retrieval** — brought forward because you supplied the dataset
  mid-phase (§4 below).

---

## 2. Verification

```
Unit:        72 passed, 8 suites      (no network, no database)
Integration: 36 passed, 3 suites      (real Postgres + Redis)
Lint:        clean, including architecture-boundary rules
Typecheck:   clean, strict mode, zero `any`
Boot:        clean, /health reports all green
```

What the integration tests actually prove, rather than merely exercise:

- Two concurrent first messages from one user create **one** conversation, not two.
- A duplicated Meta webhook does **not** run the workflow twice — it would otherwise duplicate
  a workflow and, in later phases, double-bill a vendor's credit.
- A stale lock holder cannot release a lock another worker now owns (fencing token).
- pgvector cosine ranking returns the right neighbour and rejects dimension mismatches.
- A workflow state change and its audit record commit atomically.
- An unsigned webhook is rejected; a correctly signed one is accepted and processed.
- A voice note is queued rather than transcribed inline, so the webhook returns immediately.
- Total LLM failure produces the fallback envelope, not a greeting loop.

### Bugs found and fixed during verification

1. **`rawBody` never captured.** Nest's built-in body parser consumed the stream before the
   raw-body middleware, so *every* Meta signature check would have failed in production. Fixed
   with `bodyParser: false` in `main.ts`.
2. **Empty env vars read as `''`.** `ConfigService` reads `process.env` ahead of validated
   config, so `OPENAI_API_KEY=` looked configured. Every optional credential appeared present
   and the LLM fallback chain was silently wrong. Fixed in `AppConfigService`.
3. **Conversation id assigned too late.** The channel adapter cannot know it; the message was
   persisted with an empty UUID and every turn died. Now resolved before persistence.
4. **Premature turn resumption.** A message with two voice notes resumed after the first
   finished, answering on half the input. Fixed with an atomic Redis settled-parts tracker.

---

## 3. Deliberate gaps

Stated explicitly rather than left to be discovered:

| Gap | Why | Where |
|---|---|---|
| **Voice and USSD adapters** | Phase 1 required WhatsApp; SMS was added to prove channel-agnosticism. The registry reports an unsupported channel explicitly rather than dropping a reply silently. | `channel-notifier.registry.ts` |
| **Document parsing, video analysis** | Declared MCOS §5.2 capabilities, not Phase 1 deliverables. Captions are used when present; nothing is invented. | `media-processing.service.ts` |
| **GS1 codes on `SemanticRequest`** | Semantic Resolution normalises products but leaves `category.gpc` unset. Wiring the resolver to the now-seeded taxonomy is Phase 2/4 work; a fabricated code would be trusted downstream. | `semantic-resolution.service.ts` |
| **Live Gemini/Anthropic failover** | The chain is built and unit-tested with fakes. Only `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are set, so real OpenAI→Gemini failover is unverified. | — |
| **Triage is a placeholder workflow** | Phase 1 delivers the OS; the marketplace capabilities arrive in Phases 2–5. Triage exercises the whole platform and tells users honestly what exists today. It has the lowest priority, so later workflows claim its intents automatically. | `triage.workflow.ts` |

---

## 4. GS1 GPC taxonomy

Supplied mid-phase, so the import and semantic index were built ahead of schedule.

**File fixed:** 233 bytes of a stray comment banner had been appended after the JSON. Removed;
content verified byte-identical otherwise.

**Structure found — and a corrected assumption.** The published export is *not* a uniform tree:

| Level | Concept | Occurrences | Distinct codes |
|---|---|---|---|
| 1–4 | Segment → Family → Class → Brick | 6,463 | 6,463 (unique) |
| 5 | Attribute Type | 10,188 | **2,085** |
| 6 | Attribute Value | 184,323 | **13,733** |

Attribute types and values are *shared vocabulary* reused across bricks — the value `YES`
(30002654) appears under 500 bricks. My first schema modelled `code` as a primary key across all
levels and the import failed outright. Remodelled: hierarchy in `taxonomy_nodes`, shared
vocabulary in `taxonomy_attributes`, and two link tables. 194,511 links imported.

**Embedding scope:** levels 1–4 only (6,463 nodes). Attributes describe *variants* of a product,
not what a business supplies; embedding them would multiply cost roughly thirtyfold and add
noise to capability retrieval. They remain queryable by code.

### Retrieval quality

Dense-only retrieval was measurably wrong on the queries this marketplace depends on — "hammer"
ranked *Anvils*, then *Hammer Drills*, above *Hammers*. Embeddings are strong on paraphrase and
weak on bare nouns; full-text is the inverse. Retrieval is now **hybrid**: dense similarity and
lexical full-text fused with Reciprocal Rank Fusion, plus a head-noun bonus for titles whose
whole subject is the query.

Measured against the real 6,463-node index (top result):

| Query | Result | |
|---|---|---|
| `hammer` | Hammers (DIY) (Non Powered) | ✓ |
| `spanner` | Wrenches/Spanners (Non Powered) | ✓ |
| `wrench` | Wrenches/Spanners (Non Powered) | ✓ |
| `wire` | Electrical Wires | ✓ |
| `cement` | Cement | ✓ |
| `generator` | Generators | ✓ |
| `artist brush` | Artists Brushes/Applicators | ✓ |
| `roofing sheet` | Roll Roofing | ✓ |

**Known limitation.** Raw descriptive phrases still rank imperfectly — *"the thing used to
tighten bolts"* puts Wrenches/Spanners third behind Turnbuckles and Nuts. This is acceptable
because it is not how the pipeline queries: CME §23 specifies that Descriptive Search infers a
concrete item *first*, and the inferred term (`wrench`) retrieves correctly at 0.606. It is
recorded here rather than papered over.

`vacuum flask` finds no good match — GPC appears to have no such brick. That is a vocabulary
gap for Semantic Resolution's alias expansion to cover, not a retrieval defect.

---

## 5. Configuration note

Your `.env` contains a block pasted from another project (`konnet`). It is functional — the
duplicate `DATABASE_URL` is commented out — but two things are worth knowing:

- **Duplicate keys**: `dotenv` keeps the *last* occurrence within a file. `OPENAI_MODEL` appears
  twice, so **`o3` is the model actually in use**, not `gpt-4o-2024-11-20`.

  > **Corrected 2026-08-06.** An earlier version of this report said the first occurrence wins
  > and that `gpt-4o` was active. That was wrong, and it mattered: `o3` rejects the
  > `temperature` parameter, so *every* OpenAI call was returning HTTP 400 and silently failing
  > over to Anthropic. Found by the Phase 2 live probe; the adapter now omits `temperature` for
  > reasoning models. See `docs/PHASE-2-REPORT.md` §5.
- **Unused keys**: `WEAVIATE_URL`, `WHATSAPP_PROVIDER`, `TWILIO_WHATSAPP_FROM` and
  `BACKEND_PORT` belong to the other project. `TWILIO_MESSAGING_FROM` (which this code reads)
  is empty, so SMS delivery is not configured.

---

## 6. The phase gate

You chose **live WhatsApp against the Meta sandbox** as the definition of "phase complete".
That has not been run. It needs, from you:

1. A public tunnel to `localhost:3000` (`ngrok http 3000` or similar).
2. The webhook registered in the Meta dashboard at `https://<tunnel>/webhooks/whatsapp` with
   your `WHATSAPP_VERIFY_TOKEN` — the GET handshake is implemented and unit-tested.
3. Your test number added as a recipient in the WhatsApp sandbox.

Then: send a text and a voice note, and confirm the stage logs and the reply on the device.
Everything else in Phase 1 is verified.
