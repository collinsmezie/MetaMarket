# Phase 7 — Web Retrieval System (WRS 4.4)

Status: complete (2026-09-24). Spec: `Web_Retrieval_System_v4_4_Final_Integrated.md`; Overarching §13
(`SearchProviderPort`), §24.1 (`POST /v1/wrs/retrieve`); final decision lock Q5 (Tavily default,
`WRS_SEARCH_PROVIDER` / `TAVILY_API_KEY`, clear `NO_RELIABLE_EVIDENCE`).

## What was built

`src/retrieval/` (module `RetrievalModule`, component `WRS` 4.4, wire 4.0):

| Layer | Files | Notes |
| --- | --- | --- |
| schemas | `wrs-request-v4.json`, `wrs-response-v4.json` | §18.1/§18.2 verbatim shapes; consumer enum widened with `MKG`/`EVIDENCE` (§21.2/§22.2); findings/contradictions/sources item shapes made explicit and typed. |
| prompt | `prompts/wrs.master.md` → `wrs.runtime.retrieve@4.4.0` | §10 system prompt verbatim + §17 market-semantic rules + output discipline (cite only supplied sources; OBSERVED needs a quote; never ERROR). |
| domain | `wrs-evidence.ts`, `wrs-invariants.ts`, `query-plan.ts` | Types, wire↔domain mapping, provenance invariants, deterministic §6 query planning. |
| ports | `SearchProviderPort` (`SEARCH_PROVIDER`), `WebRetrievalPort` (`WEB_RETRIEVAL`), `WrsRepositoryPort` | Provider is replaceable; evidence contract never depends on it. |
| adapters | `TavilySearchProvider`, `UnavailableSearchProvider`, `PrismaWrsRepository`, `WrsController` | Tavily over global `fetch` with bounded timeout, bearer key, `country` name mapping (ISO → Tavily name) and a one-shot retry without optional filters on HTTP 400. |
| application | `WrsService` | Pipeline below. |

Consumers own their adapters onto `WEB_RETRIEVAL`:

- `src/semantics/adapters/evidence/wrs-external-evidence.adapter.ts` — CSRE `EXTERNAL_EVIDENCE_RETRIEVAL`
  (one request per uncertain expression, `request_id = <csre_request>:wrs:<n>`, candidates = remaining
  meanings, question phrased for Nigerian commercial usage, locality from `regional_context.locations`).
- `src/enrichment/adapters/evidence/wrs-enrichment-evidence.adapter.ts` — Enrichment
  `ENRICHMENT_EVIDENCE_RETRIEVAL` (the model's own `evidence_request` → one WRS request per object,
  `request_id = <enrichment_request>:wrs:<object_id>`).

The `Disabled*EvidenceRetrieval` placeholders were deleted. Both adapters degrade to "no evidence" on
any WRS failure; a first-pass resolution is never discarded.

### Pipeline (§6, §15, §20.6)

1. Idempotency: a repeated `request_id` with a persisted envelope is served from `wrs_retrievals`.
2. Provider gate: `SEARCH_PROVIDER.available()` false ⇒ typed `WRS_PROVIDER_UNAVAILABLE`
   (retryable=false), row status `PROVIDER_UNAVAILABLE`, no search, no model call.
3. Query planning (deterministic): question → `<subject> <locality>` → `<subject> <candidate> <locality>`
   → `<subject> <requested field>`, de-duplicated, bounded by `WRS_MAX_QUERIES`; country hint from
   `context.country_code`. Subject comes from `context.phrase|surface_form|concept|canonical_form|subject`.
4. Search: all queries in parallel; partial provider failure degrades, total failure ⇒
   `WRS_PROVIDER_FAILURE` (retryable per provider error), row `TEMPORARY_FAILURE`.
5. Source collection: de-dup by normalised URL (tracking params/fragments stripped), merge query
   provenance, rank by query coverage then provider score, cap 15, number `src_1…`.
6. Zero sources ⇒ deterministic `NO_RELIABLE_EVIDENCE` envelope (UNRESOLVED finding), no model call.
7. Otherwise one model evaluation bound to `wrs-response-v4` with semantic invariants:
   every `source_id` must be a collected source (URL copied from retrieval), evidence ids unique,
   `supports`/`contradicts` reference supplied candidate ids or requested fields, OBSERVED needs a
   quote, findings/contradictions reference existing evidence, status ⇔ evidence presence.
8. Runtime stamps: `request_id`, `consumer`, `task_type` (by consumer component), evidence ids
   namespaced `<request_id>#ev_n` with all references rewritten (globally unique, §18.3/§28.4),
   `source_url`/`source_title` from the retrieved source, `sources[]` completed for every cited source.
9. Persist `wrs_retrievals` (+ one immutable `wrs_evidence` row per item), publish `EvidenceRetrieved`
   (evidence ids, status, provider, source count), finish the trace step.

### Persistence

Migration `20260924180000_phase7_wrs`: enum `WrsInvocationStatus`, tables `wrs_retrievals`
(request-unique, queries, counts, lineage, envelope JSON) and `wrs_evidence` (globally unique
`evidence_id`, claim/kind/supports/contradicts/provenance columns + full item JSON). The dev-trace
`GET /dev/requests/:id/trace` now returns `wrsRetrieval` (own request) and `wrsRetrievals` (WRS calls
made on behalf of that request, i.e. ids starting `<id>:wrs:`).

### Configuration

```
WRS_SEARCH_PROVIDER=tavily        # tavily | none
TAVILY_API_KEY=                   # required for tavily; absent ⇒ WRS_PROVIDER_UNAVAILABLE
# TAVILY_API_URL=https://api.tavily.com/search   # overridable for contract tests
WRS_MAX_QUERIES=4
WRS_MAX_RESULTS_PER_QUERY=6
WRS_TIMEOUT_MS=15000
```

Providing the key is the only switch: CSRE's and Enrichment's evidence paths become active automatically.

## CSRE changes made while gating (prompt 5.4.1 → 5.4.3)

Live runs against real Tavily exposed two CSRE behaviours that defeated the evidence path:

- "20 rubber for my shop" resolved to the dictionary material at 0.8 (Nigerian English: plastic
  container/bowl/bag). Added the **REGIONAL MARKET LANGUAGE** prompt section (local commercial meaning
  outranks dictionary meaning; use quantity/venue signals; when unsure set `ambiguity.present` and
  confidence ≤ 0.6). After: `20 rubber → plastic containers [PRODUCT] 0.9`.
- "kpakpando lamps" (Igbo *star*; not a product) was echoed back as a PRODUCT at 0.85 with the definition
  "likely a local or regional product". Added the **Echoing is not resolving** rule and the code invariant
  `unfamiliar_term_false_precision` (a hedged definition ⇒ `ambiguity.present` must be true and
  `semantic_resolution ≤ 0.6`, which is exactly what routes the object to WRS). After: first pass
  AMBIGUOUS → WRS (15 Tavily sources, 2 evidence items: "kpakpando = star in Igbo") → second pass
  `decorative lamps [PRODUCT] 0.8`, both prompt executions and the WRS child step visible in the run trace.

## Other fixes

- Legacy evidence capture (`prisma-evidence.repository.ts`, `marketplace_events`) typed `request_id` /
  `conversation_id` as UUID and threw on platform ids (`req_…`, `…:wrs:n`) for **every** platform event
  (IntentResolved, SemanticObjectResolved, GPCMapped, …). It now stores only UUID-shaped values. Phase 8
  replaces this table.
- Component-mode WRS mints UUID `conversation_id`/`turn_id` when absent (outbox columns are UUIDs).
- Chaos harness overrides `SEARCH_PROVIDER` with `UnavailableSearchProvider` so replays never reach the network.

## Gates

- `tsc`/`nest build` clean; `eslint --max-warnings 0` clean.
- Unit: 62 suites / 470 tests (new: `wrs-invariants`, `query-plan`, `tavily-search-provider.adapter`,
  `wrs.service`, both consumer adapters, `csre-invariants` hedge rule).
- Integration (6 rebuild suites): platform-foundation, turn-assembly, intent-resolution,
  semantic-resolution, enrichment, chaotic-conversation — 21/21; chaos replay stays at 20 LLM calls.
  Legacy `whatsapp-pipeline` / `marketplace-loop` fail on legacy expectations exactly as on clean HEAD
  (rebuilt in Phases 10–12).
- Component mode without key: `POST /v1/wrs/retrieve` → `ERROR WRS_PROVIDER_UNAVAILABLE`, row
  `PROVIDER_UNAVAILABLE`, 0 prompt executions, trace step ERROR.
- Component mode with a local Tavily stand-in (`TAVILY_API_URL`), then with the **real Tavily key**:
  - iron sponge → SUCCESS, 3 OBSERVED items (Nairaland, cleaneat.ng, 24hoursmarket) all supporting
    "steel wool scouring pad", contradicting "metal filter sponge", finding CROSS_SOURCE, overall 0.9.
  - pure water → SUCCESS, 3 items (BBC Pidgin, ICIR, masstechx) supporting "sachet drinking water".
  - Dangote cement 25kg price → PARTIAL: 50 kg prices found, UNRESOLVED finding that 25 kg is not sold.
  - nonsense phrase → NO_RELIABLE_EVIDENCE (15 unrelated sources evaluated, 0 evidence).
  Every call: trace step SUCCESS, one `EvidenceRetrieved` event, `wrs_retrievals` + `wrs_evidence` rows.
- Pipeline (live-test API): unknown-term message exercised CSRE → WRS → CSRE second pass as above;
  confident local terms (iron sponge, pure water, okrika bales, Ghana-must-go, mudu of garri, rubbers of
  palm oil) resolve to their Nigerian market meaning without an evidence call.

## Known limits / follow-ups

- The legacy BuyerSearch workflow still re-interprets the raw text (asked "erasers or tyres?" for
  "rubber" after CSRE had resolved plastic containers). Workflows must consume CSRE objects — Phase 12.
- Enrichment's evidence path is wired and unit-tested but did not fire in live runs (the model did not
  set `evidence_required`); it will be exercised again when MKG context exists (Phase 9).
- `EvidenceRetrieved` is one event per retrieval carrying evidence ids; Phase 8 ingests `wrs_evidence` rows.
