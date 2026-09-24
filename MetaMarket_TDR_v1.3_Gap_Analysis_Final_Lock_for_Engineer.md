# MetaMarket — TDR v1.3 Final Lock: Gap Analysis Decisions & Implementation Directives

**Date:** 2026-09-12  
**Status:** FINAL IMPLEMENTATION LOCK  
**Authority:** This document resolves the Phase 0 implementation questions raised in `TDR-v1.3-Gap-Analysis.md` and adds the final business-policy changes supplied by the product owner.  
**Priority:** Where repository behavior, legacy code, older requirements, or existing implementation ideas conflict with the v1.3 TDR package and this final lock, **the TDRs win**.

---

## 1. Purpose

This document is the engineer's final decision record for continuing implementation of the MetaMarket TDR v1.3 package.

The engineer's gap analysis identified seven material open questions plus several repository conflicts and migration concerns. This document converts those questions into explicit implementation decisions.

The objective is **not** to preserve old implementation behavior for its own sake. The objective is to preserve correct business behavior and system intelligence while making the v1.3 architecture, ownership boundaries, contracts, evidence model, MKG, orchestration model, and deterministic workflows authoritative.

The gap analysis identifies the current repository as a NestJS 10 / Prisma 6 / Postgres 16 + pgvector / Redis / BullMQ / LangGraph.js 1.4 system of approximately 26k production LOC. It also identifies areas to keep, adapt, replace, rebuild, and remove. [Gap Analysis §1–2](#source-grounding)

---

# 2. Authority Rule — TDRs Win

## Final rule

> **If an existing idea, class, service, workflow, database model, prompt, policy, or implementation behavior conflicts with the current v1.3 TDR package or this final lock, the TDR wins.**

This applies to:

- existing code
- old repository documentation
- older feature specifications
- old workflow behavior
- legacy prompt behavior
- old naming
- duplicate domain concepts
- existing database ownership assumptions
- legacy ranking formulas
- previous fanout/reveal policies
- previous TTLs
- previous response windows
- old authentication assumptions

The engineer must not preserve contradictory legacy behavior merely because it already exists in code.

Where legacy code contains useful implementation primitives, those primitives may be retained **only after being reshaped to the authoritative TDR contracts and ownership model**.

---

# 3. Final Resolution of Open Questions

| Question | FINAL DECISION |
|---|---|
| Q1 — Graph store | Use **Neo4j initially**, behind `GraphStorePort`; MKG owns graph truth. |
| Q2 — Existing production data | Preserve/migrate useful data through phased migration; the new v1.3 ownership model becomes authoritative after cutover. |
| Q3 — Reveal | **Show all matched vendors to the buyer**. No city/state restriction for now. |
| Q3 — Fanout | **Fan out the customer request to all matched vendors**. |
| Q3 — Visibility billing | **100 Konnet credits per billable vendor visibility/reveal**. |
| Q3 — Onboarding grant | **2,000 free Konnet credits** assigned to every successfully onboarded vendor. |
| Q3 — Low-credit policy | A vendor with insufficient credits may still be shown **up to a configurable number of times** while the platform covers the visibility bill. Default value is implementation-configurable through `.env`. |
| Q3 — Low-credit messaging | When the platform covers the bill, tell the vendor that **the bill is on the house**. |
| Q3 — Location scope | **No city/state scope restriction for now**. Matching/ranking determines the eligible set; all matched vendors may be revealed/fanned out. |
| Q3 — Request TTL | **48 hours**. |
| Q3 — Response window | **48 hours**. |
| Q3 — Vendor response billing | **Responding vendors pay on acceptance**. |
| Q3 — Buyer response visibility | Buyer sees a responder's business card **on the buyer's next message**. |
| Q3 — Message content | Vendor/buyer operational messages use **only the resolved product name**, not the full original buyer search text. |
| Q3(c) — No current suitable vendor | Use the exact approved message in §7. |
| Q4 — Evidence polarity | `POSITIVE`, `NEGATIVE`, `NEUTRAL`, `CONTRADICTORY`. |
| Q5 — WRS provider | Implement `SearchProviderPort`; use a replaceable initial provider adapter. Tavily is the default initial provider. |
| Q6 — Authentication | **No authentication requirement yet** for web/dev testing. Do not spend implementation effort on auth now; keep the architecture easy to secure later. Production security hardening remains a Phase 13 concern. |
| Q7 — Live Test Mode | API-driven Live Test Mode remains the canonical engineering test mechanism; WhatsApp is secondary integration validation. |
| GPC blocking | Workflow-level policy explicitly determines whether GPC is `REQUIRED`, `OPTIONAL`, or `BACKGROUND`. GPC must not universally block MarketConcept-first discovery. |

---

# 4. Fanout & Visibility Policy — Final Business Lock

This section supersedes conflicting historical fanout/reveal policies.

## 4.1 Match set

The system should determine the complete eligible vendor match set using the v1.3 Matching & Fanout architecture.

For now:

```text
MarketConcept
    ↓
Capability / semantic matching
    ↓
Eligibility filtering
    ↓
Deterministic ranking
    ↓
ALL eligible matched vendors
```

There is **no city/state reveal restriction** at this stage.

The system may use geography as a ranking feature where appropriate, but geography must **not silently eliminate otherwise eligible matches** unless a later business policy explicitly introduces geographic constraints.

## 4.2 Buyer visibility

The buyer may see **all matched vendors**, subject to normal eligibility rules.

There is no current `REVEAL_COUNT = 8` cap.

The engineer must remove or supersede any legacy implementation that assumes only the top eight vendors are revealed.

## 4.3 Customer request fanout

The customer request is fanned out to **all matched vendors**.

Each vendor receives the standardized vendor request and can respond using the defined options.

The fanout system must remain deterministic and idempotent.

Each dispatch should have an immutable identity such as:

```text
fanoutDispatchId
requestId
vendorId
```

Billing and response handling must always resolve against the exact dispatch, never a vague "any pending request" state.

## 4.4 Visibility price

The billable visibility fee is:

```text
100 Konnet credits
```

The amount must be configuration-driven or domain-configured rather than hard-coded across multiple services.

Suggested configuration:

```env
KONNET_VISIBILITY_FEE_CREDITS=100
```

## 4.5 Successfully onboarded vendor grant

Every successfully onboarded vendor receives:

```text
2000 free Konnet credits
```

Suggested configuration:

```env
KONNET_ONBOARDING_GRANT_CREDITS=2000
```

The grant must be applied exactly once for a successful onboarding completion event.

It must be idempotent.

A retry of onboarding completion must not issue another 2,000-credit grant.

## 4.6 Low-credit vendor policy

A vendor whose balance is below the normal visibility fee may still be shown when the vendor has remaining platform-sponsored visibility allowances.

The number of sponsored appearances is configurable through `.env`.

Suggested configuration:

```env
LOW_CREDIT_VENDOR_SPONSORED_VISIBILITY_LIMIT=3
```

The default value for this implementation is **3**.

The developer must be able to change the value without modifying application code.

### Behavior

If:

```text
vendor.creditBalance >= 100
```

then normal billing applies.

If:

```text
vendor.creditBalance < 100
```

and:

```text
sponsoredVisibilityUses < LOW_CREDIT_VENDOR_SPONSORED_VISIBILITY_LIMIT
```

then:

- vendor may still be shown to the buyer;
- vendor may still receive the customer request;
- the platform covers the visibility fee;
- vendor credit is not driven negative;
- sponsored usage is incremented atomically;
- vendor is told that the bill is on the house.

Suggested vendor-facing message concept:

> "You're currently being connected at no cost — the bill is on the house."

The exact conversational wording may be handled by the Response Composer, but it must preserve that meaning.

Once the configured sponsored-visibility limit is exhausted, the normal insufficient-credit policy applies.

### Important

The sponsored limit is **not** a permanent vendor eligibility limit. It is a billing subsidy safeguard.

Do not couple it to capability ranking or semantic relevance.

## 4.7 Vendor acceptance billing

Responding vendors pay on acceptance.

The billable acceptance states remain:

```text
HAVE_IT
CAN_GET_IT
```

The system must debit before revealing the vendor's acceptance/connection outcome where required by the fanout policy.

An insufficient-credit vendor that attempts a billable acceptance must not produce an unpaid successful reveal unless a separately defined sponsored-acceptance policy is introduced later.

The platform-sponsored policy described in §4.6 currently applies to **visibility**, not an unlimited general credit waiver.

## 4.8 Buyer sees responders on next message

Do not proactively push responder business cards as the default behavior.

Persist the responder outcome and surface the relevant business card(s) when the buyer sends the next message.

This remains compatible with durable delivery while keeping the buyer interaction predictable.

---

# 5. Request Lifetime Policy

## 5.1 Request TTL

Customer requests remain active for:

```text
48 hours
```

Suggested configuration:

```env
CUSTOMER_REQUEST_TTL_HOURS=48
```

After 48 hours the request must transition to its terminal/expired state according to the workflow/state model.

## 5.2 Vendor response window

Vendor response is accepted for:

```text
48 hours
```

Suggested configuration:

```env
VENDOR_RESPONSE_WINDOW_HOURS=48
```

The response window must be attached to the exact fanout dispatch/request rather than inferred from arbitrary message timestamps.

## 5.3 Idempotency

The combination of a 48-hour window and asynchronous vendor responses makes idempotency especially important.

At minimum, fanout and billing operations must be protected against:

- webhook retries
- duplicate vendor replies
- repeated buyer messages
- concurrent response processing
- worker retries
- process restarts
- duplicated outbox delivery

The gap analysis correctly identifies the current `distribute()` path as unsafe because it lacks transactional creation/idempotency and can rebill on retries. This must not survive the rebuild.

---

# 6. Buyer and Vendor Message Content

## Final rule

> **Operational vendor/buyer messages use only the resolved product name. Do not echo the buyer's full initial search text into operational marketplace chats.**

Example:

Buyer enters:

```text
"I dey find that kind wall socket wey dem dey use for new houses, maybe 13 amp white one"
```

CSRE may resolve this to a MarketConcept/product identity such as:

```text
Wall Socket
```

Vendor-facing request should use:

```text
Wall Socket
```

not the entire original search sentence.

### Why

This keeps marketplace communications:

- clear
- concise
- commercially focused
- less noisy
- less likely to leak internal semantic reasoning
- consistent across WhatsApp, web, SMS, and future channels

The original user message remains available in trace/context/persistence where appropriate for system reasoning and audit, but it must not automatically become the operational marketplace message.

---

# 7. No Current Vendor Response — Approved Customer Message

When there are currently no suitable vendors to present, use:

> **"We're currently searching for suitable vendors across your local market, I'll notify you once capable businesses become available."**

This replaces any legacy instruction that requires the system to pretend that vendors were found.

## Truthfulness rule

The system must never fabricate a successful vendor match merely to make the response sound positive.

The approved message is therefore a truthful asynchronous-discovery state:

```text
No suitable eligible vendor currently available
            ↓
Persist search/request state
            ↓
Continue allowing future capability discovery / matching
            ↓
Notify through the defined product behavior when suitable capability becomes available
```

The exact future notification mechanism is governed by the relevant notification/channel TDR; this decision does not require inventing an unimplemented background-notification subsystem.

---

# 8. Q1 — Market Knowledge Graph Store

## Decision

Use **Neo4j initially**, but only through MKG ports.

The rest of the system must not import Neo4j directly.

Recommended boundary:

```text
Evidence
   ↓
GraphChangeCommand
   ↓
MKG Application Service
   ↓
GraphStorePort
   ↓
Neo4j Adapter
```

Reads follow the same principle:

```text
CSRE / Enrichment / GPC / Matching
             ↓
       MKG Read Port
             ↓
       Neo4j Adapter
```

## Ownership

MKG owns:

- graph nodes
- graph assertions
- relationship state
- graph identity
- RDF/SKOS representation
- graph traversal
- graph validation
- graph snapshots

Postgres remains authoritative for its own transactional/business domains.

Do not attempt a distributed transaction spanning Postgres and Neo4j.

Use the existing transactional outbox/event architecture for propagation.

## Required properties

Graph writes must be:

- idempotent
- validated
- provenance-aware
- compatible with graph relationship lifecycle state
- replay-safe

---

# 9. Q2 — Existing Production Data and Migration

Existing data should be treated as migration input, not as a reason to preserve obsolete architecture.

Every old entity/store should be classified as:

```text
KEEP
MIGRATE
DERIVE
ARCHIVE
DELETE
```

The new TDR ownership model becomes the long-term authority.

Avoid indefinite parallel sources of truth.

Example:

```text
old vendor_capabilities
        ↓
   migration/backfill
        ↓
Evidence + CapabilityAssertion
```

not:

```text
old vendor_capabilities + new CapabilityAssertion
        ↓
 two permanent authorities
```

Migration should be phased:

1. introduce new schema
2. backfill/transformation
3. validate counts and semantics
4. switch reads/writes
5. monitor
6. deprecate old path
7. remove old store when safe

The engineer must report migration outcomes, including:

- records found
- records migrated
- records transformed
- duplicates
- rejected records
- unresolved records

---

# 10. Q4 — Evidence Polarity

Use only:

```text
POSITIVE
NEGATIVE
NEUTRAL
CONTRADICTORY
```

Legacy aliases:

```text
MIXED   → CONTRADICTORY
UNKNOWN → NEUTRAL
```

Do not preserve the stale enum values as independent domain states.

The purpose is to give Evidence deterministic semantics for belief recalculation and contradiction handling.

---

# 11. Q5 — Web Retrieval System

Implement WRS behind:

```ts
interface SearchProviderPort {
  search(request: SearchRequest): Promise<SearchResponse>;
}
```

Use **Tavily as the initial provider adapter**, with the provider replaceable through configuration.

Suggested configuration:

```env
WRS_SEARCH_PROVIDER=tavily
TAVILY_API_KEY=...
```

WRS is an evidence acquisition mechanism, not a semantic authority.

In particular, deep Nigerian/local market slang may be poorly represented on the web. Marketplace evidence, vendor interactions, buyer confirmations, and approved MKG knowledge remain valid complementary sources.

The WRS implementation must provide a clear `NO_RELIABLE_EVIDENCE` outcome rather than inventing confidence from weak search results.

---

# 12. Q6 — Authentication Is Deferred for Now

The product is still in idea-validation/testing mode.

Therefore:

> **Do not block implementation on authentication.**

Do not spend significant engineering effort building production authentication for the web test channel or `/dev` trace API in this phase.

However, keep the architecture secure-by-boundary so authentication can be introduced later without redesigning the domain.

The engineer should therefore:

- keep channel adapters separate from domain services;
- keep `/dev` under a dedicated controller/module boundary;
- avoid embedding anonymous assumptions into business logic;
- avoid irreversible security design choices;
- document the future authorization boundary.

Webhook verification that is already required for actual provider integrations should remain correct where applicable; this deferral does **not** mean disabling provider signature verification for production-like integrations.

Full authentication/security hardening remains a later phase.

---

# 13. Q7 — Live Test Mode

API-driven Live Test Mode is the canonical engineering test mechanism.

Preferred flow:

```text
POST /dev/live-tests/runs
        ↓
logical conversation / turns
        ↓
MCOS
        ↓
full component execution
        ↓
persisted trace
        ↓
GET /dev/runs/{runId}
```

The live-test system must be able to inspect:

- requestId
- correlationId
- conversationId
- turnId
- runId
- component versions
- schema versions
- prompt versions
- model/provider
- LLM call count
- sequential depth
- parallel width
- retries
- schema repairs
- specialist outputs
- persisted domain decisions
- evidence records
- beliefs
- GraphChangeDecision
- MKG mutations
- matching candidates
- fanout dispatches
- billing actions
- final customer/vendor response

WhatsApp remains a secondary integration validation path.

---

# 14. GPC Blocking Policy

GPC must not become a universal blocking step for MarketConcept-first commercial discovery.

Instead, workflows must declare the taxonomy policy explicitly.

Recommended contract:

```ts
type TaxonomyBlockingPolicy =
  | 'REQUIRED'
  | 'OPTIONAL'
  | 'BACKGROUND';
```

Examples:

### Capability discovery / vendor search

```text
CSRE
  ↓
MarketConcept
  ↓
Matching / discovery
  ↓
GPC = BACKGROUND or OPTIONAL
```

### Workflow requiring formal classification

```text
CSRE
  ↓
Enrichment
  ↓
GPC = REQUIRED
  ↓
continue
```

This preserves the semantic identity established by CSRE while allowing the taxonomy layer to remain useful for classification, retrieval, analytics, and structured capability mapping.

---

# 15. Performance & Result-Quality Preservation

The business-policy changes in this final lock must **not** degrade system performance, matching quality, or semantic quality.

The most important change is that the system now shows/fans out to **all matched vendors** rather than an old top-eight reveal policy.

This does **not** mean the system should perform eight-times-more-expensive reasoning.

## 15.1 Match once, fan out many

Matching should produce one deterministic candidate set and score computation:

```text
request
  ↓
semantic resolution
  ↓
enrichment
  ↓
candidate retrieval
  ↓
deterministic scoring/ranking
  ↓
eligible matched vendor set
  ↓
fanout
```

Do not re-run expensive semantic/LLM reasoning independently for each vendor.

## 15.2 Fanout must be cheap relative to matching

Per-vendor fanout should use deterministic operations:

- eligibility check
- dispatch creation
- notification enqueue
- credit policy evaluation
- persistence

Do not introduce an LLM call per vendor.

## 15.3 Concurrency

Fanout to all matched vendors should be asynchronous and bounded through the existing queue/event infrastructure.

Use:

- batch processing where appropriate
- queue backpressure
- bounded concurrency
- idempotent dispatch
- transactional billing
- retry-safe notifications

Avoid one giant synchronous request that waits for every vendor notification to complete.

## 15.4 Vendor-set size protection

Showing all matched vendors does not mean allowing unlimited pathological fanout.

The engineer must implement a configurable **system safety ceiling** for operational fanout capacity if needed, but it must be an infrastructure protection—not a hidden product reveal limit.

Example:

```env
MAX_FANOUT_BATCH_SIZE=...
```

If the protection ceiling is reached, process the full matched set through queued batches rather than silently dropping matches.

Do not convert the safety ceiling into a product policy like "only show the first N vendors."

## 15.5 Ranking quality remains deterministic

The system should not weaken candidate quality merely because more candidates are displayed.

Continue using the versioned composite scoring model with inspectable feature contributions.

Preserve distinctions among:

- semantic relevance
- capability strength
- evidence/belief strength
- eligibility
- geographic relevance as an optional ranking signal
- commercial availability signals

Geography may contribute to ranking, but current policy must not use it as an automatic exclusion boundary.

## 15.6 Semantic identity must remain primary

The increase from eight visible vendors to all matched vendors must not cause broader or fuzzier semantic matching simply to increase the vendor count.

The system should prefer:

> fewer highly relevant vendors over a large set of semantically weak vendors.

"All matched vendors" means all vendors that genuinely meet the matching threshold, not all vendors that might vaguely sell related products.

## 15.7 GPC remains non-destructive

Deferring GPC must not reduce semantic discovery quality.

MarketConcept remains the primary commercial semantic identity.

GPC is auxiliary classification.

A taxonomy classification must never overwrite or reinterpret the CSRE-established identity simply because a nearby GPC candidate has a higher vector score.

## 15.8 Evidence quality remains conservative

The system must not lower Evidence quality thresholds merely because the marketplace wants more matches.

Maintain:

- provenance
- source identity
- independence tracking
- corroboration
- contradiction handling
- belief recalculation
- self-proving-loop prevention

## 15.9 LLM call consolidation

Where the TDR permits runtime optimization, deterministic retrieval and independent specialist outputs may be executed in parallel.

A single optimized model call may serve multiple reasoning outputs only when:

- each output has its own contract;
- each output is independently validated;
- authority boundaries remain intact;
- traces record that the outputs came from the same call.

Do not merge IDCE and CSRE into one domain authority simply because they can share a model invocation.

## 15.10 Performance telemetry

Live Test Mode must make performance regressions visible.

Track at minimum:

```text
LLM call count
sequential depth
parallel width
component latency
end-to-end latency
p50 / p95 / p99
retry count
schema repair count
specialist failure count
queue wait time
fanout batch duration
```

Performance optimization should be driven by these measurements rather than assumptions about theoretical LLM error/latency multiplication.

---

# 16. Billing & Credit Integrity Requirements

Because fanout now covers all matched vendors, billing correctness becomes even more important.

## 16.1 Visibility charge

```text
100 credits
```

must be applied atomically when the vendor is billably revealed.

## 16.2 Onboarding grant

```text
2000 credits
```

must be issued exactly once after successful onboarding.

## 16.3 Sponsored visibility

Sponsored low-credit visibility must be tracked separately from ordinary wallet balance.

Suggested conceptual fields:

```text
sponsoredVisibilityUses
sponsoredVisibilityLimit
```

or an equivalent auditable ledger/event model.

Do not simply decrement a fake wallet balance to represent a platform subsidy.

## 16.4 Idempotency

Every financial mutation must have a deterministic idempotency key.

Examples:

```text
onboarding-grant:{vendorId}
visibility:{fanoutDispatchId}
acceptance:{fanoutDispatchId}
```

The existing wallet implementation is one of the strongest areas in the repository and should be retained/adapted rather than replaced unnecessarily.

---

# 17. Data Ownership Remains Authoritative

The existing gap analysis already establishes the intended ownership model. The implementation must preserve it.

Key examples:

```text
MCOS
  → Conversation / LogicalTurn / TurnQueue / PendingClarification

IDCE
  → IntentResolution

CSRE
  → SemanticResolution / MarketConcept proposal

Enrichment
  → EnrichmentResolution

GPC
  → GPCMapping

Evidence
  → Observation / Evidence / Knowledge / Belief / GraphChangeDecision

MKG
  → graph identity / graph assertions / graph state

Capability Projection
  → CapabilityAssertion

Matching & Fanout
  → MatchingRequest / MatchingCandidate / FanoutDispatch

Wallet
  → CreditWallet / CreditTransaction / VirtualAccount / PaymentNotification
```

Do not reintroduce multiple competing belief stores.

Do not allow CSRE to directly mutate durable MKG identity.

Do not allow LLM output to directly mutate workflow state.

Do not allow matching to become an evidence authority.

---

# 18. Legacy Repository Defects That Must Still Be Fixed

The business-policy changes in this document do **not** relax the important repository defects already identified in the gap analysis.

The rebuild must still address, at minimum:

1. missing HNSW indexes
2. missing correlation IDs
3. silent `MemorySaver` fallback
4. non-idempotent fanout creation/billing
5. unsafe vendor response matching
6. duplicate interval sweepers across replicas
7. missing vendor foreign-key integrity in evidence data
8. free-string statuses that should become controlled enums where required
9. dead duplicate turn core
10. old hybrid graph scoring
11. unversioned prompts
12. old semantic resolver duplication
13. old capability resolver that merges semantic and taxonomy responsibilities

These defects were explicitly identified in the gap analysis and remain implementation requirements. [Gap Analysis §5](#source-grounding)

---

# 19. Updated Build Sequence

The existing proposed build sequence remains valid, with the final business-policy changes incorporated.

```text
Phase 1  Foundation
Phase 2  MCOS Runtime
Phase 3  IDCE
Phase 4  CSRE
Phase 5  Enrichment
Phase 6  GPC Resolver
Phase 7  WRS
Phase 8  Evidence
Phase 9  MKG
Phase 10 Capability Projection + Vendor Onboarding
Phase 11 Matching & Fanout + Buyer Search / Find Vendor / Find Venue / Price Enquiry
Phase 12 Remaining workflows + E2E
Phase 13 Hardening + audit
```

Each phase must end with:

```text
compile
  ↓
lint
  ↓
unit/integration
  ↓
start application
  ↓
real API execution
  ↓
inspect persisted trace/state
  ↓
fix regressions
  ↓
proceed
```

This ensures that implementation decisions are validated against actual execution rather than only static code correctness.

---

# 20. Required Live Test Scenarios for These Final Changes

The engineer should add live-test coverage for the final business-policy changes.

## Scenario A — Many matched vendors

Input:

```text
Buyer searches for a common product with many genuine matches.
```

Expected:

- all eligible matched vendors are retained;
- no hidden top-8 reveal cap;
- all eligible vendors enter fanout;
- billing decisions are deterministic per vendor;
- matching itself happens once rather than per vendor.

## Scenario B — Vendor with normal balance

Expected:

```text
visibility charge = 100 credits
```

and exact wallet ledger mutation is persisted once.

## Scenario C — Newly onboarded vendor

Expected:

```text
vendor successfully onboarded
→ +2000 free credits exactly once
```

Retrying onboarding completion must not duplicate the grant.

## Scenario D — Low-credit sponsored vendor

Given:

```text
vendor balance < 100
sponsored usage < configured limit
```

Expected:

- vendor remains eligible;
- vendor can be shown;
- platform covers visibility;
- vendor sponsored usage increments once;
- vendor receives the on-the-house message.

## Scenario E — Sponsored limit exhausted

Given:

```text
vendor balance < 100
sponsored usage >= configured limit
```

Expected:

- ordinary insufficient-credit behavior applies;
- no negative wallet balance;
- no hidden subsidy.

## Scenario F — 48-hour TTL

Expected:

```text
request created
→ active for 48h
→ expires deterministically after TTL
```

## Scenario G — 48-hour vendor response window

Expected:

- response accepted inside the window;
- response rejected/ignored after expiry;
- retry does not create duplicate acceptance/billing.

## Scenario H — Buyer sees responder on next message

Expected:

```text
vendor accepts
→ response persisted
→ buyer sends next message
→ business card appears
```

## Scenario I — Resolved product name only

Input contains a long natural-language buyer request.

Expected vendor/buyer operational message contains only the resolved product name.

## Scenario J — No current match

Expected exact customer response:

> "We're currently searching for suitable vendors across your local market, I'll notify you once capable businesses become available."

No fake vendor cards may be produced.

---

# 21. Engineer Implementation Directive

Proceed with implementation using this document together with the full MetaMarket TDR v1.3 package.

Do not pause implementation merely because a legacy repository behavior differs from this document.

Instead:

1. identify the conflict;
2. apply the TDR as the authority;
3. preserve useful underlying infrastructure where safe;
4. migrate data where necessary;
5. add adapters rather than leaking new concerns into old modules;
6. validate via live execution;
7. record any genuinely material contradiction that cannot be resolved from the TDRs.

Do not ask for confirmation on decisions already locked here.

Only raise a question if implementation encounters a **material ambiguity not resolved by the v1.3 TDRs or this final lock**.

---

# 22. Final Product/Architecture Principle

The final implementation should preserve the following invariant:

> **Keep intelligence distributed by responsibility, but make knowledge shared through controlled interfaces.**

In practical terms:

```text
IDCE     → what the user wants
CSRE     → what commercial thing/concept they mean
Enrich   → useful semantic context
GPC      → taxonomy classification
WRS      → external evidence
Evidence → what observed evidence means
MKG      → durable graph knowledge
Capability Projection → vendor capability view
Matching → who is relevant
Fanout   → who receives the request
Workflow → what the system is allowed to do
MCOS     → how the conversation executes
```

No layer should silently absorb another layer's authority merely because doing so appears convenient in the existing codebase.

The system should become **more intelligent through shared knowledge**, not by collapsing all reasoning into one service.

---

# Source Grounding

This document uses the engineer-provided Phase 0 gap analysis as its repository-state and open-question source. The gap analysis records the TDR package versions, repository baseline, contract conflicts, current implementation state, ownership model, defects, locked legacy policy, and proposed build sequence.

Relevant sections of the supplied gap analysis:

- Specification authority and repository baseline: §1 lines 3–5.
- Contract conflicts and current resolution proposals: §1 lines 10–26.
- Existing repository architecture and runtime state: §2 lines 30–34.
- Keep/Adapt/Replace/Rebuild/Remove analysis: §3 lines 38–98.
- Data ownership: §4 lines 102–119.
- Existing repository defects: §5 lines 123–133.
- Existing locked fanout/credit policy that this final lock supersedes where explicitly changed: §6 lines 138–147.
- Proposed phased implementation sequence: §7 lines 151–169.
- Original open questions: §8 lines 174–176.

---

## Final Status

**IMPLEMENTATION IS UNBLOCKED.**

The engineer should treat the decisions in this document as locked unless a future TDR revision explicitly supersedes them.
