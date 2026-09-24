# Rebuild Phase 6 — GPC Resolver v4.4 (Sovereign GPC Classification)

**Date:** 2026-09-24 · **Spec:** GPC Resolver TDR v4.4 (§1–§5, §11–§24, §45–§52, §61–§64, §75–§76, §93–§95), Overarching §12, MCOS §38, §63.4 · **Gap analysis:** §7 Phase 6

## What changed and why

| Requirement | Delivered | Where |
|---|---|---|
| The resolver answers only "where does this already-resolved MarketConcept belong in GS1 GPC?" (§75.1) | New component `src/taxonomy/` (domain / ports / application / adapters). It consumes CSRE objects plus Enrichment profiles, never re-resolves identity, never invents codes, never touches commercial relationships | `src/taxonomy/**` |
| Executable contracts (§93.3, §93A, §76.1) | `gpc-resolver-request-v4.json`, `gpc-resolver-response-v4.json` (with the §93.3 conditional: MAPPED ⇒ code/level/title present, otherwise null), `gpc-candidate-v4.json`. `resolver_version` is validated against the deployed component version 4.4 (the schema `const 4.1` is historical per §76.1); `gpc_candidates` is an optional hint (§76.2) | `schemas/*` |
| Master prompt (§49–§50, §94.4) | §49 verbatim plus the §94.4 invariants and field rules; `gpc.runtime.resolve@4.4.1` (4.4.1 adds the category-never-brick rule found live) | `prompts/gpc.master.md` |
| Candidate retrieval ownership (§11–§12, §76.2–§76.3) | `GpcCandidateRetrievalPort` over the installed sovereign index: the existing hybrid pgvector + full-text + head-noun search on the concept, alias/Enrichment-vocabulary lexical arms, prior validated codes from the knowledge port; fused score, retrieval sources, full lineage and dataset version on every candidate | `adapters/retrieval/taxonomy-candidate-retrieval.adapter.ts` |
| Sovereignty enforced in code (§5, §93.4, §94.4, §95.5) | Invariants inside the single bounded repair: one result per object; `semantic_origin` and `source_trace` copied through with `csre_request_id == semantic_origin.request_id`; a MAPPED code must be a supplied candidate for that object with the dataset's level and title (the runtime re-stamps level/title from the dataset); diagnostics name supplied candidates only; AMBIGUOUS needs competitors; cited evidence was supplied; categories never map to a BRICK (§14.4, §15, §17) | `domain/gpc-invariants.ts` |
| Non-product referents (§14.1, §17; Overarching §12.3) | SERVICE, CAPABILITY, PERSON, ORGANIZATION, PLACE, ACTIVITY, CONCEPT, SOFTWARE and NON_COMMERCIAL objects are NOT_APPLICABLE deterministically — no retrieval, no model call | `domain/gpc-mapping.ts`, service |
| Dataset version (§93.5, §63) | `gpc_version` from the last completed taxonomy import, else the configured file plus node count (`gs1-gpc:gs1_gpc.json:unversioned:6463-nodes` today) | retrieval adapter |
| Mapping facts (§47, §62, §75.2) | `gpc_resolutions` + `gpc_mappings` (one per object: state, code/level/title, confidence, reason codes, candidate provenance, links to the durable semantic object and enrichment profile). One `GPCMapped` event per object for Evidence/MKG. Idempotency `gpc:{conversation}:{turn}:{csre request}:{enrichment request}` | `adapters/persistence/*`, migration `20260924150000_phase6_gpc_resolver` |
| Knowledge context (§23, §76.6) | `GpcKnowledgePort` (prior validated MarketConcept → GPC mappings, read-only), Noop until Phase 9 | `ports/gpc-candidate-retrieval.port.ts` |
| Orchestrator integration (MCOS §38, §63.4; §76.4) | `GpcResolverAdapter` builds the request from the byte-exact persisted CSRE objects plus the Enrichment profiles of the same `object_id`s with a machine-enforced `source_trace`; the graph chains GPC after enrichment in the background (`enrichment → gpc`), the `taxonomyPolicy` gate waits for the whole chain only when REQUIRED, and `commit` records both slots | `application/gpc-resolver.adapter.ts`, `orchestration/application/conversation-graph.nodes.ts` |
| Component Mode API (Overarching §24.1) | `POST /v1/gpc/resolve` | `adapters/http/gpc-resolver.controller.ts` |
| Dev inspection | `/dev/requests/{id}/trace` includes `gpcResolution` with mappings; the commit step lists `object=STATE(code)` per object | `platform/observability/trace-query.service.ts` |
| Chaos harness | Oracle scripts `gpc.runtime.resolve` sovereignly (first supplied candidate or INSUFFICIENT) | `test/harness/conversation-harness.ts` |

## Validation

- `tsc`, ESLint, `nest build` clean. Unit: 56 suites / 450 tests (new: invariants incl. false-precision, service stamps/deterministic NOT_APPLICABLE/version guard/idempotency/typed failure). Integration: chaos replay (20 calls per transcript, both channels) plus the Phase 1–5 suites.
- **Live gate — Component Mode** (§64 tests, `POST /v1/csre/resolve` → `/v1/enrichment/resolve` → `/v1/gpc/resolve`, `gpt-4o-2024-11-20`, 0 repairs, 4–11 s for the GPC call, 10 candidates per object):

| Input | Mapping |
|---|---|
| "wall socket" | MAPPED BRICK 10005567 *Sockets/Receptacles/Outlets* 0.95 |
| "I sell iron sponge" → steel wool scouring pad | MAPPED BRICK 10003157 *Abrasive Pads/Steel Wool* 0.95 |
| "hammer, nails and electrical materials" | hammer → BRICK 10003500 *Hammers (DIY) (Non Powered)*; nails → BRICK 10003182 *Nails/Pins (Fixings/Fasteners)*; electrical materials (category) → 4.4.0 gave BRICK *Electrical Wires* (false precision) → invariant + prompt rule → FAMILY 78040000 *Electrical Cabling/Wiring* |
| "building materials, wall sockets and conduit pipes" | FAMILY 83010000 *Building Products*; BRICK *Sockets/Receptacles/Outlets*; BRICK 10005647 *Cable/Wire Conduit/Ducting/Raceways* — category and products kept at their own levels |
| "I sell phones and repair them" | phones → BRICK 10008506 *Mobile Phones*; phone repair service → NOT_APPLICABLE (deterministic, no model call for that object) |
| "Bosch GWS 750" → angle grinder | BRICK 10003644 *Angle Grinders (Powered)*; brand/model untouched |
| "power tools" | FAMILY 80010000 *Tools/Equipment* 0.9 — broad input, no forced precision |
| "Where is God when it hurts?" → BOOK | CLASS 60010200 *Books* (CSRE read it as the published book, DIRECT_PRODUCT) |
| "I want okrika" → second-hand clothing | FAMILY 67010000 *Clothing* |
| "I need a generator" | BRICK 10005211 *Generators* |

- **Live gate — Pipeline Mode**: "I need Peak milk and a hammer" → CSRE (2 objects) → Enrichment (13 s) → GPC (13 s) chained in the background while BuyerSearch ran; commit recorded `enrichment: SUCCESS, gpc: SUCCESS, object_1=MAPPED(10000025) Milk (Perishable), object_2=MAPPED(10003500) Hammers (DIY)`; two `gpc_mappings` rows linked to their semantic objects and enrichment profiles; two `GPCMapped` events.

## Known limitations carried forward

- No prior validated mappings or market knowledge feed retrieval until MKG (Phase 9); every mapping is model-decided from the sovereign index alone.
- WRS evidence for obscure concepts (§24) is not wired into the resolver yet (Phase 7 binds it for CSRE and Enrichment; the resolver consumes `evidence` from the request).
- The taxonomy import table is empty in this environment, so `gpc_version` is the unversioned file identity; re-seeding through the seeder will record a real import and version.
- Mapping facts are emitted but not yet consumed: Evidence (Phase 8) turns them into beliefs and MKG (Phase 9) anchors MarketConcepts to GPC nodes.
