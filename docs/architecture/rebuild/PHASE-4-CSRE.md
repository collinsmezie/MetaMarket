# Rebuild Phase 4 — CSRE v5.4 (Commercial Semantic Resolution Engine)

**Date:** 2026-09-12 · **Spec:** CSRE TDR v5.4 (§1–§31; contract lock §27, §29, §31), MCOS §63.3, §65.2–§65.3, Overarching §10, §24.1 · **Gap analysis:** §7 Phase 4

## What changed and why

| Requirement | Delivered | Where |
|---|---|---|
| CSRE as the authority for "what is the person referring to?" (§1, §2, §30.1) | New component `src/semantics/` (domain / ports / application / adapters). Imports only the platform runtime; never IDCE, taxonomy, matching, workflows or the graph | `src/semantics/**` |
| Executable contracts (§27.2, §29.2, §31.1) | `csre-resolution-v5.json` (response 5.0) and `csre-service-request-v5.1.json` registered in the schema registry. The response schema is §27.2 with the item shapes §11/§14A/§15/§28.1 describe made explicit (venues, relationships, candidates, regional/location context, scalar attribute map); every payload valid here is valid against §27.2 verbatim | `src/semantics/schemas/*` |
| Master prompt + runtime prompt (§6, §7, §26, §27.3) | §6 verbatim, followed by the §26 semantic-origin rule, the §14A CMEE output contract, the §10 status rules and §27.3 output discipline. `csre.runtime.resolve@5.4.1` (5.4.1 hardens venue-never-object, branded-product-as-product, unfamiliar-local-term behaviour — all three found live) | `src/semantics/prompts/csre.master.md` |
| CMEE and per-object independence (§3.1A, §3.1B, §14A) | Enforced by prompt and by invariants: unique `object_id`s, exact-span `surface_form` (never a paraphrase), `semantic_origin.phrase == surface_form`, no dangling relationship endpoints, venue expressions never objects, entity-type vocabulary, KNOWN⇔`market_concept_id`, `resolution_status` consistent with object count, ambiguity⇔candidates, one clarification question | `domain/csre-invariants.ts` |
| Runtime chain (§4, §17, §27.3) | `CsreService`: pinned prompt → schema → invariants → one bounded repair → adaptive evidence path (second pass only when WRS is bound, no evidence was supplied and ambiguity is material) → authoritative correlation stamps (`schema_version`, `request_id`, `original_message`, per-object `semantic_origin.request_id/origin/relationship`, origin confidence derived from the object's semantic confidence) → persistence → events. Failures are typed `ERROR`s, never a fabricated object (§20 rule 1) | `application/csre.service.ts` |
| Semantic origin / MarketConcept-first (§25, §26, §31.5) | Every object carries Phrase → EXPRESSES → MarketConcept; with no knowledge layer yet every concept is `PROPOSED` with `market_concept_id = null`. Grounding port supplies known concepts and market-language evidence when Evidence/MKG exist (Phases 8–9); `Noop` binding now — model memory is never presented as marketplace observation (§31.4) | `ports/semantic-grounding.port.ts`, `adapters/grounding/*` |
| Evidence path seam (§9, §17, §30.1) | `ExternalEvidenceRetrievalPort` (`available()` + `retrieve()`); bound to a disabled adapter until WRS (Phase 7). Unit-tested both ways | same |
| Persistence and lineage (Overarching §18.4; CSRE §27.5, §29.3) | `semantic_resolutions` (wire payload, versions, model, prompt execution, latency, status, supersede pointer) + `semantic_objects` (one row per object: surface/canonical form, entity type, brand, model, phrase, concept, concept status, confidences, relevance, verbatim wire object). `SemanticObjectResolved` event per object with the §27.5 observation. Trace step `CSRE/resolve` | `adapters/persistence/*`, migration `20260913000000_phase4_csre_semantic_resolutions` |
| MCOS adapter (§31.2–§31.3; MCOS §63.3) | `CsreSpecialistAdapter`: `assembled_text → message`, current messages, working context → `conversation_context` (recent messages, previous turn summary, workflows, prior semantic objects, user role), `regional_context`, `commercial_context`, grounding → `lexicon_evidence`, answered pending clarification → `clarification_answers`; injects `component`/`component_version`, validates request and v5 payload, projects into `SpecialistResponseEnvelope<CSREResolution>`; never guesses missing fields | `application/csre-specialist.adapter.ts` |
| Component Mode API (Overarching §24.1) | `POST /v1/csre/resolve` (snake_case 5.1 in, service response with the validated v5 payload out) | `adapters/http/csre.controller.ts` |
| Parallel understanding (MCOS §65.3, §56 phases 1–2) | IDCE and CSRE run in parallel beside the legacy core on every logical turn; CSRE objects feed the turn summary `objectIds` (durable ids) and the next turn's `ConversationWorkingContext.semanticObjects`, which IDCE now receives as prior semantic objects | `conversation/adapters/orchestrator/legacy-core-turn-orchestrator.adapter.ts`, `conversation/application/turn-context.builder.ts` |
| Cross-turn object identity | CSRE `object_N` is stable only per request (§29.3 rule 5); across turns the context reference uses the durable `semantic_objects.id`, so IDCE can bind "How much?" to a specific earlier object | `turn-context.builder.ts` |
| Provider compatibility (found live) | Strict-output projection now encodes free-form maps (CSRE `attributes`) as `{key,value}` entry lists for the provider and decodes them back in both LLM adapters; arrays without `items` get scalar items | `platform/contracts/strict-output-schema.ts`, `adapters/outbound/llm/*` |
| Dev inspection | Component-mode steps are anchored on a run row, so `/dev/requests/{id}/trace` and `/dev/runs/{runId}` work for direct specialist calls too; request trace now includes `semanticResolution` with its objects; correlated events default their `requestId` from the active request | `platform/observability/*`, `platform/events/domain-event.ts` |

## Validation

- `tsc`, ESLint, `nest build` clean. Unit: 46 suites / 409 tests (new: CSRE invariants incl. venue guard, service stamps/idempotency/typed failure/evidence path, strict-schema map encoding round-trip). Integration (real Postgres): `semantic-resolution.test.ts` (per-object rows, idempotency key, prior-turn objects exclude the current turn) plus Phase 1–3 suites green.
- **Live gate — Component Mode** (`POST /v1/csre/resolve`, `gpt-4o-2024-11-20`, 2–13 s, 0 schema repairs on 17 of 18 cases):

| Case | Result |
|---|---|
| §24 T1 "I sell rice, vegetable oil, Indomie and detergent." | COMPOSITE, 4 objects; Indomie → `instant noodles` brand Indomie (after 5.4.1) |
| T2 "hammer, nails and electrical materials" | 3 objects, mixed granularity: TOOL, MATERIAL, PRODUCT_CATEGORY |
| T3 "building materials, plumbing, electricals, wall sockets and conduit pipes" | 5 objects, 3 categories + 2 products, none flattened |
| T4 "hammer and nails for roofing" | 2 objects; `roofing` in functional context only |
| T5 "pharmacy that sells malaria medicine and pain killers" | 2 MEDICINE objects; pharmacy → `context.venues` RETAIL_VENUE |
| T6 "I sell phones and repair them" | phones PRODUCT + `phone repair service` SERVICE with `applies_to → object_1` |
| T7 "Peak milk and Indomie" | milk/brand Peak; instant noodles/brand Indomie |
| T8 "iron sponge, bend down select and other things" | 5.4.0 kept `iron sponge` at 0.95 → prompt hardened → `steel wool scouring pad`, `second-hand clothing`, both listed as regional terms |
| T9 "stabilizer and cable" | voltage stabilizer + electrical cable, independent confidences |
| T10 "cement and a mixer for block making" | cement MATERIAL + concrete mixer EQUIPMENT; `block making` functional context |
| "I dey find wall socket" | wall socket PRODUCT; Pidgin recorded in regional terms |
| "Bosch GWS 750" | `angle grinder`, brand Bosch, model GWS 750 |
| "I want okrika" | `second-hand clothing` PRODUCT_CATEGORY |
| "Do you know a bookshop that sells Where Is God When It Hurts?" | 5.4.0 emitted `bookshop` as a PLACE object → new `venue_is_not_object` invariant + prompt rule → BOOK object only, bookshop in venues (1 repair recorded, invariant did its job) |
| "that machine wey dey seal nylon" | `plastic bag heat sealer` MACHINE |
| "Hello" | NON_REFERENTIAL, no objects |
| "red plastic bucket and a 20 litre water tank" | plastic bucket {color: red}; water tank {capacity: 20 litres} |
| "stabilizer" after "I need something for my fridge" | voltage stabilizer, functional context `refrigerator protection` |

- **Live gate — Pipeline Mode** (`POST /dev/live-tests/runs`, two turns, real queue):
  - Turn 1 "I need Peak milk and Indomie": CSRE and IDCE steps start within 16 ms of each other (parallel), CSRE COMPOSITE 6.8 s / 0 repairs, IDCE BUY 3.8 s; two `semantic_objects` rows; legacy outcome unaffected.
  - Turn 2 "How much for the milk?": context snapshot `semanticObjects` = [milk (Peak), instant noodles (Indomie)] with durable ids; IDCE `PRICE_INQUIRY` with `scope.object_ids` = the milk object's durable id and `context_used.semantic_objects = true`; CSRE resolves "the milk" → milk; turn summary `intentTypes=[PRICE_INQUIRY]`.

## Known limitations carried forward

- Every concept is `PROPOSED`; `KNOWN` concepts and market-language evidence arrive with Evidence/MKG (Phases 8–9). The evidence path is wired but disabled until WRS (Phase 7).
- "the milk" on turn 2 is a new CSRE object; linking a continuation reference to the earlier object is the graph's continuity/reference analysis (MCOS §65.3), built in Phase 4b, which also moves routing off the legacy `WorkflowManager`.
- Two CSRE objects of the same conversation can share a `canonical_form` across turns; de-duplication into one MarketConcept is MKG's job, not CSRE's (§25.2).
- Prompt behaviour is validated by a hand-run battery; the §24 cases plus the IDCE §26 cases should become a replayable eval once both specialists run inside the graph.
