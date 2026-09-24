# Rebuild Phase 5 — GPC-Oriented Semantic Enrichment Engine v4.4

**Date:** 2026-09-24 · **Spec:** Enrichment TDR v4.4 (§1–§29; contract lock §26, §28, §29), Overarching §11, MCOS §38, §63.4 · **Gap analysis:** §7 Phase 5

## What changed and why

| Requirement | Delivered | Where |
|---|---|---|
| Enrichment as a derived-semantic producer downstream of CSRE (§1–§3, §23) | New component `src/enrichment/` (domain / ports / application / adapters). Consumes CSRE objects, never re-resolves them, never assigns GPC, never writes the graph | `src/enrichment/**` |
| Executable contracts (§26.2, §28.2, §29.1) | `enrichment-resolution-v4.json` (response 4.0; §16 layers made explicit, compatible with §26.2 verbatim) and `enrichment-service-request-v4.1.json` (`source_resolution.component_version` accepts the deployed CSRE 5.4 per the contract lock) | `schemas/*` |
| Master + runtime prompt (§13–§14, §25, §26.3) | §13 verbatim, §25 market-semantic rules, §26.3 output discipline and field rules; `enrichment.runtime.enrich@4.4.0`; runtime sections per §14 (resolver output, context, available evidence, knowledge context, downstream purpose, target level) | `prompts/enrichment.master.md`, `application/enrichment.service.ts` |
| Identity preservation and no unsupported specificity (§10, §22, §24.1, §29.2) | Input-aware invariants inside the runtime's single repair: one profile per input object, `semantic_origin` byte-for-byte, `canonical_form`/`entity_type` unchanged, brand/model only from input, evidence flags consistent, cited evidence ids must have been supplied, status agrees with objects | `domain/enrichment-invariants.ts` |
| §26.1 rejection | Objects whose origin is not `CSRE`/`EXPRESSES` are rejected before any model call | service |
| Embedding representations (§11; Overarching Phase 6 list) | Three purpose-built vectors per object (canonical, functional, taxonomy) via the shared embedding provider, plus search/semantic/negative terms; HNSW indexes on all three | repository + migration `20260924120000_phase5_enrichment` |
| Persistence and lineage (Overarching §11.2, §18.4; §28.3) | `enrichment_resolutions` (wire payload, versions, purpose, model, status, error) + `enrichment_profiles` (one per object, linked to the durable `semantic_objects.id`, indexed projection, vectors). Idempotency key `enrichment:{conversation}:{turn}:{csre request}:{purpose}`. `EnrichmentCompleted` event. Trace step `ENRICHMENT/enrich` | `adapters/persistence/*` |
| Knowledge and evidence ports (§8–§9, §26.5, §29.3) | `MKGReadPort` (read-only; stored vs inferred provenance) and `EnrichmentEvidenceRetrievalPort` (consumer-aware WRS request, WRS ids preserved). Bound to Noop/Disabled until Phases 7 and 9; the evidence path (second pass with retrieved evidence) is implemented and unit-tested | `ports/mkg-read.port.ts`, `adapters/knowledge/*` |
| Orchestrator integration (MCOS §38, §63.4; Enrichment §29.6; contract lock `TaxonomyBlockingPolicy`) | `EnrichmentAdapter` loads the byte-exact persisted CSRE wire objects of the turn's CSRE request and builds the 4.1 request. The graph starts enrichment right after the understanding join, in parallel with planning/execution; capabilities declare `taxonomyPolicy` (all `BACKGROUND` today — MarketConcept-first discovery never waits); `commit` records the settled result in state and trace (20 s bounded wait, otherwise it finishes detached) | `application/enrichment.adapter.ts`, `orchestration/domain/capability-catalogue.ts`, `conversation-graph.nodes.ts` |
| Component Mode API (Overarching §24.1) | `POST /v1/enrichment/resolve` | `adapters/http/enrichment.controller.ts` |
| Dev inspection | `/dev/requests/{id}/trace` includes `enrichmentResolution` with its profiles; the commit step reports the enrichment status and request id | `platform/observability/trace-query.service.ts` |
| Chaos harness | Oracle scripts `enrichment.runtime.enrich` faithfully (identity copied, no evidence) | `test/harness/conversation-harness.ts` |

## Validation

- `tsc`, ESLint, `nest build` clean. Unit: 54 suites / 442 tests (new: invariants, service stamps/idempotency/§26.1 rejection/embedding outage/typed failure). Integration (real Postgres + pgvector): `enrichment.test.ts` (per-object rows, three vectors, nearest-neighbour query, idempotency key, latest profile per durable object) plus chaos replay (18 calls per transcript, both channels) and the Phase 1–4 suites.
- **Live gate — Component Mode** (`POST /v1/csre/resolve` → `POST /v1/enrichment/resolve`, `gpt-4o-2024-11-20`, 0 repairs, 5–18 s):

| CSRE input | Enrichment |
|---|---|
| "I need a hammer, nails and electrical materials for roofing" (3 objects) | 3 profiles, identities intact; hammer → Tools & Hardware / Hand Tools / Hammers, confusables mallet/sledgehammer; nails → Fasteners; electrical materials stays a category (fn null) |
| "that machine wey dey seal nylon" → plastic bag heat sealer | packaging equipment / heat sealing machines; local term "nylon sealing machine" kept as regional; confusables vacuum sealer, impulse sealer |
| "I want okrika" → second-hand clothing | fashion/retail → clothing → used/thrift; "okrika (Nigeria)" recorded as regional term; negative terms new/unworn |
| "I sell phones, chargers and electrical stuff" (CAPABILITY_MATCHING) | 3 profiles at their own specificity levels (category, product, category) |
| "Bosch GWS 750" → angle grinder | power tools / grinders; brand and model preserved, none invented |

  Every case: `evidence_required=false`, no resolution concern, 3 vectors embedded per object, one `EnrichmentCompleted` event.
- **Live gate — Pipeline Mode**: "I need a plastic bag heat sealer and nylon bags for my shop" → CSRE (2 objects) → enrichment started 16 ms after the join and finished in 12 s while BuyerSearch ran ~90 s; commit recorded `enrichment: SUCCESS`; both profiles linked to their durable semantic-object ids with `text-embedding-3-small` vectors; run metrics show the extra model call.

## Known limitations carried forward

- Knowledge context is empty and every concept remains `PROPOSED` until the Market Knowledge Graph (Phase 9); the WRS evidence path is wired but disabled until Phase 7, so `EVIDENCE_REQUIRED` outcomes are recorded honestly rather than resolved.
- Nothing consumes the profiles yet: the GPC Resolver (Phase 6) reads `taxonomy_embedding` and vocabulary; Matching (Phase 11) reads `canonical_embedding`/`functional_embedding` and search terms.
- Enrichment is invoked per CSRE request; re-using a recent profile for the same durable object across turns (Overarching §11.2 "current enrichment") is a Phase 9 concern once MarketConcept identity exists.
