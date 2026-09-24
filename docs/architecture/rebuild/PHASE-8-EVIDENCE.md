# Phase 8 — Evidence System (4.4)

Status: complete (2026-09-24). Spec: `Evidence_System_v4_4_Final_Integrated_Evidence_and_MKG_Integration.md`
(§1–§54), MKG TDR v1.1 §6/§11/§12 (vocabulary, state, write boundary), Overarching §14/§24.1
(`POST /v1/evidence/ingest`), final lock Q4 (polarity POSITIVE/NEGATIVE/NEUTRAL/CONTRADICTORY; MIXED→CONTRADICTORY,
UNKNOWN→NEUTRAL), gap analysis row 23 (relevance decision → GraphChangeCommand operation mapping).

## What was built — `src/evidence/` (module `EvidenceModule`, component `EVIDENCE` 4.4, wire 4.0)

Four layers, never collapsed (§2): **Observation → Evidence → Knowledge → Belief → GraphChangeDecision**.

| Layer | Files | Notes |
| --- | --- | --- |
| schemas | `evidence-observation-v4`, `evidence-request-v4` (§50.1 + §30 targets), `evidence-response-v4` (§50.2 + §52.7 items, typed knowledge/insight/contradiction shapes), `evidence-interpretation-v4` (§51.1 + `claim`/`kind`/labels/`supports`/`contradicts`), `evidence-fusion-v4` (§51.2 verbatim), `graph-relevance-v4` (§51.3 verbatim), `knowledge-extraction-v4` (§51.4 verbatim) | Every structured stage is validated against its schema before persistence (§50.8). |
| prompt | `evidence.interpret.md` → `evidence.interpret@4.4.0` | §32 Evidence Interpretation Agent verbatim + §48 MKG rules verbatim + assertion vocabulary/polarity/output discipline. Used **only** for free-text observations (vendor/buyer statements). |
| domain | `evidence-model.ts` (identity, `mkg:` vocabulary, states), `evidence-policy.ts` (`evidence-policy-1.0`: fusion, promotion, graph relevance), `observation-interpreters.ts` (deterministic CSRE/GPC/WRS/Enrichment/structured-interaction interpreters), `interpretation-invariants.ts` | Pure, unit-tested. |
| ports | `EvidenceIntakePort` (`EVIDENCE_INTAKE`), `EvidenceQueryPort` (`EVIDENCE_QUERY`), `EvidenceStorePort` (`EVIDENCE_STORE`), `GraphChangeSinkPort` (`GRAPH_CHANGE_SINK`) | Evidence never writes graph storage (§50.9, §53.1). |
| adapters | `PrismaEvidenceStore`, `RecordingGraphChangeSink` (persists decision, publishes `GraphChangeDecided`, leaves it PENDING for MKG), `EvidenceIngestionHandler` (outbox `EventHandler` `evidence.ingestion`), `EvidenceController` (`POST /v1/evidence/ingest`, `POST /v1/evidence/retrieve`) | |
| application | `EvidenceService` (intake pipeline), `EvidenceQueryService` (§30/§31 read path) | |

Consumers bound to Evidence (learning loop, §37):
- CSRE `SEMANTIC_GROUNDING` → `EvidenceSemanticGrounding` (`src/semantics/adapters/grounding/`): SUPPORTED/ESTABLISHED
  `LOCAL_TERM_MAPPING` knowledge whose surface term occurs in the message, returned as knowledge with lineage (never fresh evidence, §38).
- GPC `GPC_KNOWLEDGE` → `EvidenceGpcKnowledge` (`src/taxonomy/adapters/knowledge/`): SUPPORTED/ESTABLISHED `TAXONOMY_ANCHOR`
  knowledge as `PriorGpcMapping` (derivation STORED).
- Both are fail-safe: a knowledge-store outage yields no knowledge, never a failed resolution.
- The `Noop*` placeholders were deleted.

### Identity (until MKG mints durable ids in Phase 9)
Typed deterministic surrogates: `phrase:<country>:<normalised text>`, `concept:<market_concept_id>` |
`concept:proposed:<normalised label>`, `gpc:<code>`, `vendor:<id>` / `buyer:<id>`, `context:<label>`. An assertion is
`(subject, predicate, object)` with id `assertion:<hash>` — relationship-first persistence (§20, §47.10). Evidence ids
are `<observation_id>#ev_n`; observation ids for platform events are `obs:<event_id>` so redelivery collapses (§8, §39).

### Intake pipeline (`EvidenceService.ingest`)
1. Record the observation immutably; a known id is a duplicate → nothing new (FAILED observations are reprocessed).
2. Interpret: CSRE `SemanticObjectResolved` → `Phrase → mkg:EXPRESSES → Concept` (semantic_origin preserved verbatim,
   §52.1); `GPCMapped` → `Concept → mkg:MAPPED_TO_GPC → gpc:<code>` (mapping provenance §52.4; NOT_APPLICABLE ignored);
   WRS `EvidenceRetrieved` → per WRS item, phrase → candidate concept POSITIVE/NEGATIVE from `supports`/`contradicts`,
   WRS request/evidence ids + source metadata retained (§52.3; the WRS request wire is now persisted in `wrs_retrievals.request`);
   `EnrichmentCompleted` → weak `Concept → mkg:HAS_ALIAS → Phrase` from commercial terminology; structured vendor/buyer
   observations (`payload.objects`) → `mkg:SUPPLIES` (NEGATIVE for rejections), `mkg:IN_STOCK`/`OUT_OF_STOCK` for inventory,
   `mkg:REQUESTED` for buyers, `mkg:USED_FOR` for shared functional context (§11); free text → interpretation prompt with
   invariants (MKG vocabulary only, typed ids, actor identity, buyer ⇒ never SUPPLIES, strength ≤ 0.9, no invented GPC codes).
3. Fuse each touched assertion from its **full** evidence history (`fuse`): independence groups by `independence_key`
   (duplicates count once, strongest wins), sequential clamped update `s += (1−s)·w·gain` / `s −= s·w·gain` with
   `w = strength × source reliability × directness × recency`, opposing-evidence attenuation so one observation never
   dominates (§7) and beliefs recover (§26), single-source cap 0.9 (§5), staleness decay toward the prior with
   type-specific half-lives (§16: capability 120 d, demand 60 d, local terms 730 d, taxonomy 1095 d). Output is the
   §51.2 shape; every change appends `belief_history` (§44).
4. Promote knowledge (§54.2, claim-sensitive): e.g. LOCAL_TERM_MAPPING SUPPORTED at belief ≥ 0.6 & 2 independent sources,
   ESTABLISHED at ≥ 0.8 & 3; VENDOR_CAPABILITY SUPPORTED at ≥ 0.6 & 1 direct source; WEAKENING/INACTIVE on decline.
   Knowledge (`knowledge` table) keeps claim, scope, confidence, supported_by/contradicted_by, last_validated_at (§36).
5. Graph relevance (§25/§34 → §53.2): new & belief ≥ 0.3 → EXPAND/ADD; new & negative-only → REJECT; new & weak →
   INVESTIGATE (no command); Δ ≥ +0.02 → REINFORCE; Δ ≤ −0.02 → DECAY (DEACTIVATE below 0.3); collapse < 0.15 → PRUNE;
   contradiction with few sources → INVESTIGATE; otherwise MAINTAIN. Decisions are persisted (`graph_change_decisions`,
   status PENDING) and submitted through `GRAPH_CHANGE_SINK`.
6. Events: `ObservationRecorded`, `BeliefUpdated` (`CapabilityBeliefUpdated` for vendor capability predicates),
   `KnowledgePromoted`, `GraphChangeDecided`. Trace step `EVIDENCE/ingest` per observation, with prompt executions when used.

### Persistence
Migrations `20260924200000_phase8_evidence_system` (+ `20260924200100_phase8_wrs_request_column`): enums
`EvidencePolarity`, `KnowledgeState`, `ObservationStatus`, `GraphChangeOperation`, `GraphChangeDecisionStatus`; tables
`observations`, `evidence`, `evidence_assertions`, `belief_history`, `knowledge`, `graph_change_decisions`.
Dev API: `GET /dev/runs/:runId/evidence` (observations, evidence, assertions, knowledge, decisions, belief history for a
run); `GET /dev/requests/:id/trace` now includes `observations` derived from the request.

## Design decisions to flag
- **Deterministic fusion/relevance/promotion.** The TDR defines fusion, graph-relevance and knowledge-extraction *agents*
  (§33–§35) but leaves the update function configurable and demands schema-bound machine contracts (§50.8). Belief
  formation here is a versioned policy computed from immutable history and emitted in the §51.2/§51.3/§51.4 shapes —
  auditable and replayable. The model is used only where interpretation of free text is genuinely needed (§32).
- **Interpretation schema extension.** `evidence-interpretation-v4` adds `claim`, `kind`, `subject_label`, `object_label`,
  `supports`, `contradicts` to §51.1's item (which has `additionalProperties:false`). Without them the record cannot answer
  §13's "how was it interpreted / what does it support". All §51.1 fields keep their exact meaning.
- **Conservative model-only support.** A single CSRE resolution yields ~0.22 belief (exploratory, §5); four independent
  conversations resolving a phrase the same way, or WRS corroboration, are needed for SUPPORTED knowledge (§15.8 of the lock:
  evidence quality stays conservative).
- **Legacy evidence stack retained until Phase 11.** `EvidenceProcessor`/`evidence_aggregates`/`marketplace_events` still feed
  the legacy matching engine; the new Evidence System is the belief authority for everything new. The legacy stack is deleted
  when Matching & Fanout is rebuilt (gap analysis §5 "two belief stores").

## Gates
- `tsc`, `nest build`, `eslint --max-warnings 0` clean. Unit: 65 suites / 488 tests (new: policy, interpreters+invariants, service).
- Integration: platform-foundation, turn-assembly, intent-resolution, semantic-resolution, enrichment, chaotic-conversation —
  6/6 suites, 21/21 tests; chaos replay back at the 20-call ceiling. Root cause of the first failed run: the throwaway test DB had not received the
  Phase 8 migrations (the integration setup does not run `prisma migrate deploy`), so the CSRE grounding query threw and CSRE
  fell back. Fixed by migrating the test DB and making both knowledge adapters fail-safe.
- Component mode (`/v1/evidence/ingest`, real model):
  - free-text vendor statement "We sell wall sockets, switches and electrical cables. We don't do generators or generator repair."
    → 5 evidence items (3 POSITIVE, 2 NEGATIVE `mkg:SUPPLIES`), 3 CANDIDATE assertions at 0.506 → ADD, 2 INACTIVE → REJECT;
  - identical redelivery → `DUPLICATE`, no new evidence;
  - structured confirmation (new interaction) → belief 0.827, ESTABLISHED, REINFORCE;
  - later rejection → 0.700, SUPPORTED, DECAY; both evidence items retained; `/v1/evidence/retrieve` lists the contradiction;
  - buyer request → `buyer → mkg:REQUESTED → wall sockets` and `wall sockets → mkg:USED_FOR → house wiring`; never capability.
- Pipeline (live-test API, "I want to buy iron sponge and pure water in Lagos"): the outbox consumer ingested 5 observations
  (2 CSRE, 1 Enrichment, 2 GPC) → 10 assertions; `iron sponge → EXPRESSES → steel wool scouring pad` reached SUPPORTED with
  4 independent conversations (REINFORCE decision, PENDING for MKG); `MAPPED_TO_GPC` anchors at 0.283; belief history shows the
  journey 0.218 → 0.393 → 0.528 → 0.633.

## Follow-ups
- Phase 9 MKG binds `GRAPH_CHANGE_SINK` to the graph writer and reports APPLIED/REJECTED; Evidence then reads MKG ids instead of surrogates.
- Vendor/buyer interaction observations (`VENDOR_RESPONSE`, `FULFILLMENT_COMPLETED`, `BUYER_REQUEST`, …) are emitted by the
  rebuilt workflows in Phases 10–11 through `EVIDENCE_INTAKE` / the outbox; the contract and interpreters are ready.
- A scheduled decay sweep (re-fusing stale assertions without new evidence) is deferred to Phase 13 hardening.
