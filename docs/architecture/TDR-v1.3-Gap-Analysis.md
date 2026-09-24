# MetaMarket — TDR v1.3 Implementation Gap Analysis (Phase 0)

**Date:** 2026-09-12
**Specification authority:** `MetaMarket_TDR_Package_v1.3_MKG_Integrated/` (Overarching v1.3, Directive v1.2, MCOS+LangGraph 4.4, IDCE 1.6, CSRE 5.4, Enrichment 4.4, GPC Resolver 4.4, WRS 4.4, Evidence 4.4, MKG 1.1)
**Repository baseline:** branch `mcos-langgraph-fable` @ `d4f0347`, ~26k prod LOC, NestJS 10 / Prisma 6 / Postgres 16 + pgvector / Redis / BullMQ / LangGraph.js 1.4
**Status:** Analysis only. No code changed.

---

## 1. Contract-first preflight (Directive §49.1)

Final Contract Lock (Overarching §49.1) versus what the component TDRs' executable schemas actually pin:

| Boundary | Locked component version | Wire/schema | Schema-level conflict found | Resolution adopted |
|---|---:|---|---|---|
| MCOS ↔ LangGraph | 4.4 | internal 1.0 (P1–P6 `mcos-p*-1.0`) | none | — |
| LangGraph → IDCE | 1.6 | model output `idce-resolution-1.0`; envelope 1.1 | IDCE §22.3 envelope schema pins `component_version: const "1.4"`; §23.1 says 1.6 | `component_version` becomes a semver string validated against deployed registry (`"1.6"`); envelope `schema_version` stays `1.1`. Wire unchanged. |
| LangGraph → CSRE | 5.4 | response 5.0; request 5.1 | none (request const already 5.4) | — |
| CSRE → Enrichment | 4.4 | response 4.0; request 4.1 | Enrichment §28.2 pins `source_resolution.component_version: const "5.2"`; §29.2 supersedes to 5.4. §28.3 says `resolver_version` SHOULD be `"5.1"` | Accept `"5.4"`; `source_resolution.resolver_version` = deployed CSRE component version (5.4); `wire_schema_version` = `5.0`. |
| Enrichment → GPC Resolver | 4.4 | request/response 4.0 | Schemas pin `resolver_version: const "4.1"`; §76.1 declares 4.4 and marks 4.1/4.2 historical. §93A.1 requires `gpc_candidates`; §76.2 makes it optional | `resolver_version` validated against registry (`"4.4"`); `gpc_candidates` optional (override/hint). `schema_version` stays 4.0. |
| * → WRS | 4.4 | request/response 4.0 | §18.1 consumer enum lacks `MKG`/`EVIDENCE`; §21.2/§22.2 and MKG §19 make MKG a consumer | Widen enum to add `MKG`, `EVIDENCE` (backward-compatible widening; recorded as amendment). |
| * → Evidence | 4.4 | request/response 4.0 | Polarity: §9/§51.1 = POSITIVE/NEGATIVE/NEUTRAL/CONTRADICTORY; §52.2 NormalizedEvidenceRecord = POSITIVE/NEGATIVE/MIXED/UNKNOWN | Persist the 4-value interpretation enum (§51.1 is the executable schema). `MIXED`/`UNKNOWN` treated as stale aliases of CONTRADICTORY/NEUTRAL. **Confirm (Q4).** |
| Evidence → MKG | 1.1 | graph schema 1.0 | Three lifecycle vocabularies: MKG §11 (CANDIDATE/ACTIVE/REINFORCED/WEAKENING/INACTIVE/PRUNED/REJECTED), Evidence §47.8 (PROPOSED/SUPPORTED/STRONG/…), Evidence §54.2 (CANDIDATE/SUPPORTED/ESTABLISHED/…) | MKG §11 = graph **relationship state** (MKG owns graph state). Evidence §54.2 = **knowledge promotion state** (Evidence owns learning). §47.8 superseded. Graph-relevance decision enum (EXPAND/REINFORCE/MAINTAIN/DECAY/PRUNE/NO_CHANGE/INVESTIGATE) maps to GraphChangeCommand ops: EXPAND→ADD, REINFORCE→REINFORCE, DECAY→DECAY, PRUNE→PRUNE/DEACTIVATE; MAINTAIN/NO_CHANGE/INVESTIGATE emit no command. |
| Datastore | — | — | Overarching §17.4/App. B: Neo4j. MKG §25: "Neo4j or another RDF-compatible store". Directive §49.8: do not flatten RDF to relational JSON without measured decision. Render has no Neo4j. | **Blocked on Q1.** |

Wire casing rule (snake_case on wire, camelCase internal) is uniform across all TDRs; adopted globally.

---

## 2. Existing repository — what it actually is

Single NestJS process. Real hexagonal skeleton (`domain/ports` with 4 inbound + 18 outbound Symbol-token ports; ESLint enforces `src/domain` cannot import frameworks/drivers). Two conversation cores behind one `CONVERSATION_CORE` binding (LangGraph "turn supervisor" graph is bound; `TurnProcessor.handleTurn` is a dead duplicate). Segment-centric turn model: message → LLM utterance segmentation (≤3) → per-segment continuity → intent → semantic → `WorkflowManager` 6-layer discovery → deterministic `WorkflowEngine` FSM. Eleven LLM operations, all through one `LlmProviderService` (OpenAI→Gemini→Anthropic failover, circuit breaker, zod validation), prompts as string constants in service files, no versioning, no execution persistence, no correlation IDs. Two independent vendor-belief stores (`vendor_capabilities` from CDE; `evidence_aggregates` from EvidenceProcessor). Fanout/credits are the strongest, most correct area.

Runtime state observed 2026-09-12: local Postgres 16+pgvector (5434), Redis (6381), MinIO (9000) up; `prisma migrate status` reports one unapplied migration which is an **empty directory** (`20260910090000_mcos_logical_turns/`, no `migration.sql`) — `render.yaml`'s `preDeployCommand: npx prisma migrate deploy` will fail on it.

---

## 3. KEEP / ADAPT / REPLACE / REBUILD / REMOVE

### KEEP (conforms; minor fixes only)

| Area | Files | TDR fit | Fixes |
|---|---|---|---|
| Wallet / credits aggregate | `application/wallet/*`, `adapters/outbound/persistence/prisma-wallet.repository.ts`, `adapters/*/paystack/*`, tables `credit_wallets`, `virtual_accounts`, `credit_transactions`, `payment_notifications` | Deterministic domain service owning financial state; exactly-once ledger (`SELECT … FOR UPDATE`, ledger row before balance); HMAC-SHA512 raw-body verification | Emit versioned `CreditCharged` events with correlation IDs; keep. |
| Channel adapters | WhatsApp notifier (bounded retries, 20 s deadline < lock TTL), WhatsApp webhook + HMAC-SHA256 + payload mapper, web SSE controller + `WebStreamHub`, Twilio SMS | MCOS "channel adapter" layer, channel-agnostic canonical `IncomingMessage` | Signature verification must not be disable-able in production; Twilio: add retries. |
| Durable outbound delivery | `DurableChannelNotifier`, `outbound_messages`, `OutboundDeliverySweeper` | MCOS §46 "graph completion ≠ delivery" | Add `delivery:{responseId}` / `clarificationId` idempotency keys. |
| LLM provider infrastructure | `LlmProviderService`, 3 adapters, `circuit-breaker.ts`, `json-extraction.ts`, `OpenAiEmbeddingAdapter` | Overarching §35 shared provider abstraction with failover | Wrap in Prompt Runtime (below); route Whisper/OCR through it for telemetry. |
| GS1 GPC dataset layer | `TaxonomySeeder`, `PrismaTaxonomyRepository` (hybrid dense+tsvector RRF), tables `taxonomy_nodes/attributes/brick_*` | GPC Resolver §11–12 "canonical relational storage + embedding index"; official taxonomy immutable | Recreate the 4 dropped HNSW indexes; write `taxonomy_imports` so `gpc_version` is answerable. |
| Deterministic workflow engine | `domain/workflows/workflow-engine.ts`, `WorkflowInstance`/`WorkflowTransition` | MCOS §22 "AI never calls setState/complete/suspend" | Expose via `WorkflowExecutionPort`; add idempotency `action:{turnId}:{actionId}`. |
| Conversation lock | `ConversationContextManager.withLock` (Redis) | MCOS §19 | Wire `extendLock` (currently uncalled). |
| Transactional outbox | `OutboxEvent`, `OutboxEventPublisher`, `OutboxRelay` | Overarching §18.7 | Versioned event envelope; cross-process consumer (relay currently only re-emits in-process). |
| Media pipeline | BullMQ media queue, Whisper, OCR, S3 adapter | MCOS §31 | Low priority. |
| Tooling | ESLint boundary rules, jest unit/integration projects, `docker-compose.yml`, `render.yaml`, tsconfig | — | Add `@langchain/*` to the domain import blocklist. |

### ADAPT (useful; must be reshaped to the TDR)

| Area | Current | Target |
|---|---|---|
| `MessageIngestionService` | persist + dedupe + directly invoke core per transport message | persist + dedupe + **Turn Assembly** append/seal/enqueue/claim (MCOS §5A, atomic CAS); the core is invoked per **logical turn** from the queue worker |
| `LangGraphConversationCore` | turn-scoped thread, segment cursor, `MemorySaver` fallback | Conversation orchestrator graph per MCOS §11 topology (`thread_id=conversation:{id}`, `run_id=turn:{turnId}`), P1–P6 prompts with `mcos-p*-1.0` schemas, planner + dependency-aware scheduler, clarification gate, response planner/composer. Fail closed if checkpointer setup fails. |
| `WorkflowManager` | primary NL router (6 layers + greeting regex) | Workflow **registry/instance lookup** for a *planned action* (MCOS §21); layers retained as instance-resolution mechanisms; greeting handled by IDCE |
| `RequestDistributionService` + `VendorFanoutNotifier` + `VendorResponseHandler` | fanout + billing + copy, direct Prisma | **Matching & Fanout** module (recipient plan) + deterministic **Fulfilment** service behind ports (`FanoutDispatch` idempotency, per-dispatch transaction), 5-option vendor ask, vendor-response fast path preserved (scoped to that vendor's pending deliveries) |
| Workflow definitions (BuyerSearch, VendorOnboarding, Triage, CreditRecharge) | consume old `IntentResult`/`SemanticRequest`; embed rendering | consume `PlannedAction` + validated IDCE/CSRE contracts; rendering moves to Response Composer |
| `StageLogger` | no correlation | AsyncLocalStorage-propagated `requestId/conversationId/turnId/runId/messageId`; persisted step records for the trace API |
| `ConversationContextManager` | history + summary | bounded `TurnContextSnapshot` (Overarching §18.8) with snapshot IDs |
| Frontend `McosChatView` | works against `/channels/web/*` | keep; later point admin views at `/dev/*` trace API |

### REPLACE (responsibility or data model conflicts with TDR)

| Current | Why it conflicts | Replaced by |
|---|---|---|
| `UtteranceSegmentationService` (segment = execution unit) | MCOS §6: atomic unit is intent/action, not text segment | P1 turn-assembly classifier (boundary only) + IDCE multi-intent |
| `IntentResolutionService` | flat intent enum, no scope/dependencies/relations, workflow names leak as intents | IDCE v1.6 (`idce-resolution-1.0`) |
| `SemanticResolutionService`, `DemandUnderstandingService`, `BusinessUnderstandingService`, `OnboardingExtractionService` | four overlapping semantic resolvers; two run on the same buyer turn (two LLM calls, two ambiguity verdicts) | CSRE v5.4 (CMEE, `csre-resolution-v5`) + Enrichment v4.4 + Capability Projection |
| `CapabilityResolver` | resolves language → GPC in one step (CSRE+GPC merged); **writes** `service_capabilities` during resolution; codes outside candidates silently dropped | GPC Resolver v4.4 (maps an already-resolved MarketConcept; `MAPPED/AMBIGUOUS/INSUFFICIENT/CONFLICTING/NOT_APPLICABLE`); services → CSRE `entity_type=SERVICE` + MarketConcept, not a GPC brick |
| `CapabilityDiscoveryService` + `vendor_capabilities` + `capability_evidence`; `EvidenceProcessor` + `evidence_records` + `evidence_aggregates`; `CapabilityPromotionSubscriber` | two belief stores fed by the same events, no reconciliation; `capability_evidence` documented immutable but `deleteMany`'d; presentation (`buildSummary`) inside discovery | Evidence System v4.4 (observation → evidence → knowledge → belief → GraphChangeDecision) as the single belief authority; Capability Projection owns `CapabilityAssertion` (belief denormalised from Evidence by event) |
| `combineRanking`/`DEFAULT_RANKING_WEIGHTS`, `hybrid-knowledge-graph.ts` (`computeHkgmScore`, dead) | two formulas; copy-writing (`⭐⭐⭐⭐⭐`, regex title surgery) inside ranking; `inferArchetype` string-slices GPC codes | Matching & Fanout deterministic versioned composite score with inspectable feature contributions (Overarching §15.2) |
| Prompts as `const SYSTEM_PROMPT` in services | unversioned, untested, business tables embedded | Prompt registry (`prompts/*.md` + `schemas/*.json`, versions pinned in a registry, `PromptExecution` persisted) |
| `SuggestedActionsService` | separate LLM call after compose | P5 response planner + P6 naturaliser produce `SuggestedAction[]` |

### REBUILD (absent)

- **Turn Assembly + Turn Queue + Pending Clarification** durable state (MCOS §5A, §25A).
- **IDCE 1.6, CSRE 5.4 (CMEE), Enrichment 4.4, GPC Resolver 4.4 contract, WRS 4.4** (no search provider exists at all), **Evidence System 4.4, MKG 1.1** (RDF/SKOS + `mkg:` vocabulary, GraphChangeCommand write port, traversal/read ports), **Capability Projection, Matching & Fanout** modules.
- **Prompt Runtime** (PromptDefinition/Version, executor, schema validator with one bounded repair, telemetry, `PromptExecution` table).
- **Correlation + Trace persistence + dev inspection API** (`/dev/runs/{runId}/…`, `/dev/conversations/{id}/timeline`) and **Live Test Mode** metrics (LLM call count, sequential depth, parallel width, p50/p95/p99, repairs, specialist failures).
- **Specialist persistence** (Overarching §32.1): `LogicalTurn`, `TurnQueueEntry`, `TurnContextSnapshot`, `PendingClarification`, `IntentResolution`, `SemanticResolution`, `EnrichmentResolution`, `GPCMapping`, `MarketConcept` (pointer + embedding; graph identity in MKG), `CapabilityAssertion`, `MatchingRequest`, `MatchingCandidate`, `FanoutDispatch`, `VendorResponse`, `Observation`, `Evidence`, `Knowledge`, `Belief`, `GraphChangeDecision`, `PromptExecution`, `InboxRecord`.
- **Workflow catalogue** (Overarching §20): FindVendor, FindVenue, Greeting (greet + steer in one turn), Account (balance/recharge), FAQ (coming-soon), Random (one turn + steer), PriceEnquiry (→ vendor discovery + caveat). BuyerSearch and VendorOnboarding rebuilt on the new contracts.
- **Cross-process event consumption** (outbox → worker), leader-safe sweepers.

### REMOVE

- `TurnProcessor.handleTurn` dead core and its duplicated heartbeat/nudge/fallback; `hybrid-knowledge-graph.ts` dead scoring; `findSimilarByDna`, `rememberFacts`, `recordCompletion`, `publishCapabilityConfirmed`, `notifyConnected/notifyFreeTrial`, `idleExpiryMs`, `STATE_PRESENT_IMMEDIATE`, duplicate greeting regex, duplicate vendor renderers.
- Empty migration `20260910090000_mcos_logical_turns/` (replaced by a real one).
- `MediaAsset` model (never written) — or write it; `TaxonomyImport` must be written, not removed.
- Triage placeholder copy claiming shipped features don't exist.
- `scripts/onboard-*.ts` writing behind the repository layer (replace with an API-driven seeding path through Capability Projection).
- Rendered `README.md` (describes a different system); frontend `api.ts`/`socket.ts` dead `/amke/*` clients (frontend admin out of backend scope; flag).

---

## 4. Data ownership (Directive §21)

| Entity | Owner / sole writer | Mutation path | Event after mutation |
|---|---|---|---|
| Conversation, InboundMessage(+Inbox), LogicalTurn, TurnQueueEntry, TurnContextSnapshot, PendingClarification, OutboundMessage | MCOS | Postgres tx; CAS for seal/claim | MessageReceived, LogicalTurnCreated, DeliveryQueued/Succeeded/Failed |
| WorkflowInstance, WorkflowTransition | Workflow Engine | tx per transition | WorkflowStarted/Suspended/Resumed/Completed |
| IntentResolution / SemanticResolution / EnrichmentResolution / GPCMapping | IDCE / CSRE / Enrichment / GPC Resolver (via prompt runtime persistence) | append; supersede, never overwrite | IntentResolved, SemanticObjectResolved, EnrichmentCompleted, GPCMapped |
| MarketConcept (Postgres pointer, embedding) + graph node | MKG (concept identity via validated command); CSRE only *proposes* | GraphChangeCommand | ConceptCreated |
| Observation, Evidence, Knowledge, Belief, GraphChangeDecision | Evidence System | append-only; belief recalculated | ObservationRecorded, CapabilityBeliefUpdated |
| Graph assertions / relationship state | MKG | validated idempotent GraphChangeCommand | GraphMutated |
| CapabilityAssertion | Capability Projection (belief field = read model of Evidence belief, updated by event) | tx | CapabilityDiscovered |
| MatchingRequest, MatchingCandidate, FanoutDispatch, VendorResponse | Matching & Fanout / Fulfilment | tx per dispatch; idempotency keys | MatchCandidatesComputed, VendorSelected, FanoutDispatched, VendorNotified, VendorResponded |
| CreditWallet, CreditTransaction, VirtualAccount, PaymentNotification | Wallet | existing atomic repo | CreditCharged / wallet.* |
| Vendor, VendorProfile | Vendors (onboarding workflow) | tx | VendorOnboardingStarted/Completed |
| PromptExecution | Prompt Runtime | append | — |
| LangGraph checkpoints | LangGraph checkpointer | orchestration only; never business truth | — |

Redis: locks, dedupe acceleration, caches, SSE presence only. pgvector: retrieval index only. Object store (MinIO/S3): media, raw payloads, snapshots.

---

## 5. Repository-internal defects that the rebuild must not carry forward

1. All four pgvector HNSW indexes dropped by later migrations and never recreated (sequential scans).
2. No correlation IDs anywhere (`withCorrelation` has zero callers).
3. No authentication on web channel; webhook signature checks disable-able by config.
4. `PostgresSaver` falls back to `MemorySaver` silently; its 4 tables live outside Prisma migrations.
5. `distribute()` has no transaction and no idempotency on `customer_requests`/`request_deliveries` creation → retried search re-bills.
6. Free-text vendor reply regex accepts "1"/"yes" from any vendor with any pending delivery → charged.
7. Six `@Interval` sweepers run on every replica without leader election.
8. Proximity ranking inert (`memory.facts['location.city']` never written).
9. `EvidenceRecord`/`MarketplaceEvent` have no FKs to vendors.
10. Zero Prisma enums; ~15 status fields are free strings.

---

## 6. Locked business policy (from repo docs; TDR package is silent) — to confirm

Konnet Credits TDR + Vendor-Fanout TDR + Updated Buyer-Search requirements + shipped code (`REVEAL_COUNT=8`):

- `NAIRA_PER_CREDIT=100`, `VISIBILITY_FEE_CREDITS=100`, `ONBOARDING_GRANT_CREDITS=2000`.
- Top-ranked vendors (currently 8) in buyer's city OR state are revealed to the buyer immediately and billed the visibility fee; insolvent → next ranked; if none can pay, unpaid fallback reveal (`creditDeducted:false`).
- **Every** matched vendor receives the ask (5 options: Yes I have it / No / I can get it / I can refer someone / Not my line of business; numbered; multi-select allowed). Fanned-out vendors pay only on acceptance ("have it" / "can get it"), debit **before** reveal; insolvent responder never revealed.
- Response window 30 min; request TTL 24 h; buyer sees responders on next message (no proactive push).
- Only the resolved product name is used in vendor/buyer messages.
- "Never tell the customer no vendors were found" (Updated requirements) — see Q3(c) for the conflict with the TDR's no-fabricated-success rule.

---

## 7. Proposed build sequence (consolidates Directive §35/§48.6 and Overarching §29)

Every phase ends with: compile → lint → unit/integration → start app → live API requests → inspect persisted state via `/dev` trace API → fix → proceed.

| Phase | Deliverable | Live gate |
|---|---|---|
| 0 | This analysis; TDR-internal conflict resolutions; open questions answered | — |
| 1 Foundation | Module layout (`conversation/`, `orchestration/`, `intent/`, `semantics/`, `enrichment/`, `taxonomy/`, `retrieval/`, `evidence/`, `knowledge-graph/`, `capabilities/{projection,matching-fanout}`, `commerce/`, `wallet/`, `notifications/`, `platform/{prompt-runtime,correlation,events,persistence,live-test}`); AsyncLocalStorage correlation; versioned event envelope + outbox consumer; JSON-Schema (ajv) + zod validation layer; Prompt Runtime + `PromptExecution`; new Prisma migrations (incl. fixing the empty one, HNSW indexes); `/dev` trace API skeleton; live-test harness | `POST /channels/web/messages` → trace shows correlated request; restart-safe |
| 2 MCOS runtime | Turn Assembly state machine + queue + CAS seal/claim; conversation-scoped LangGraph thread/run; `TurnContextSnapshot`; `PendingClarification`; delivery keys; fail-closed checkpointer | 4-message coalescing, correction, cancellation, concurrent arrival, duplicate provider delivery |
| 3 IDCE | port, adapter, prompt/schema, persistence | greeting/BUY/SELL/FIND_VENDOR/account/FAQ/random/price/multi-intent/correction; Pidgin |
| 4 CSRE | CMEE, candidates, adjudication, canonicalisation, semantic origin, clarification recommendation | 10 CMEE acceptance tests; "I dey find wall socket"; description-based; venue |
| 5 Enrichment | profiles + embedding representations; MKG read port stub | multi-object enrichment; no re-resolution |
| 6 GPC Resolver | candidate retrieval port over existing taxonomy; hierarchy-aware adjudication; mapping persistence; async when non-blocking | 18 GPC tests incl. vector trap, false precision, NOT_APPLICABLE |
| 7 WRS | consumer-aware request/response; `SearchProviderPort` + provider adapter; NO_RELIABLE_EVIDENCE path | obscure term; Nigerian term; contradiction |
| 8 Evidence | observation/evidence/knowledge/belief; independence keys; decay; GraphChangeDecision emission via outbox | CSRE semantic-origin observation → belief; duplicate delivery = one observation |
| 9 MKG | RDF/SKOS model, vocabulary, GraphStorePort + adapter (Q1), write command validation, traversal/read contracts, snapshots | Scenarios A–F of MKG §28.1 |
| 10 Capability Projection + Vendor Onboarding workflow | assertions with provenance; progressive discovery; onboarding conversation | "I sell electrical materials" → category only; "I have wall sockets and switches" → refinement |
| 11 Matching & Fanout + BuyerSearch/FindVendor/FindVenue/PriceEnquiry | retrieval union, eligibility, deterministic scoring, fanout plan; deterministic credit + notification via ports; vendor response → evidence | Scenario G end-to-end with real credit deduction and 5-option ask |
| 12 Remaining workflows + E2E | Greeting, Account, FAQ, Random; multi-intent chaos scenarios | Directive §45 full conversation |
| 13 Hardening + audit | concurrency, retries, leader-safe workers, auth, secrets, performance measurement, Directive §44 audit, README | Recovery Mode: no data loss, no double charge |

---

## 8. Open questions (material; see chat)

Q1 graph store · Q2 production data on Render · Q3 fanout/credit policy confirmation (incl. "never say no vendors") · Q4 evidence polarity enum · Q5 WRS search provider/key · Q6 web-channel auth & dev API protection · Q7 live-gate mechanism (API-driven vs WhatsApp).
