# MetaMarket / BizApp
# Overarching System Architecture & Implementation Technical Design Requirements v1.3

**Document Status:** Implementation Master Blueprint  
**Version:** 1.3  
**Primary Runtime:** TypeScript / Node.js  
**Architecture:** Hexagonal / Ports & Adapters + LangGraph orchestration + deterministic domain workflows  
**Primary Market:** Nigerian informal + formal commerce  
**Audience:** Fable/Astra-style implementation agents, AI coding agents, platform architects, backend/AI engineers  
**Authority:** This document explains how the component TDRs work together. The component TDRs remain authoritative for the detailed internal design of each component.

---

# 0. Purpose of This Document

This document is the **overarching implementation specification** for the MetaMarket conversational commerce system.

It exists so that an AI implementation model can read one document first, understand the complete architecture, and then use the eight component design files as detailed subsystem specifications without inventing its own architecture or crossing component boundaries.

The system is intentionally designed as a collection of specialised components rather than one large AI agent. The platform converts arbitrary human conversation into structured intent, semantic referents, enriched concepts, taxonomy mappings, vendor capabilities, evidence, and executable marketplace actions.

The implementation must preserve the central separation:

```text
MCOS + LangGraph
    = conversation runtime + orchestration

IDCE
    = what the user wants

CSRE
    = what the user is referring to

Enrichment
    = semantic information useful downstream

GPC Resolver
    = sovereign taxonomy classification

Capability Projection
    = what a vendor can provide/do

Matching & Fanout
    = which vendors best satisfy a demand

WRS
    = external evidence acquisition

Evidence System
    = durable evidence, belief, graph learning

Domain Workflows / Capability Services
    = deterministic business execution
```

The implementation must never collapse these responsibilities into a single prompt, service, database table, or "smart router."

---

# 1. Source Design Set

The implementation baseline consists of these current component specifications:

| Component | Current design | Role |
|---|---|---|
| MCOS + LangGraph | v4.3 | Conversation runtime and orchestration |
| IDCE | v1.5 | Intent discovery/classification |
| CSRE | v5.3 | Commercial semantic resolution |
| Semantic Enrichment | v4.3 | Semantic/taxonomy-oriented enrichment |
| WRS | v4.3 | External evidence retrieval |
| Evidence System | v4.3 | Evidence, beliefs, graph change decisions |
| GPC Resolver | v4.3 | Sovereign GPC classification |
| Market Knowledge Graph | v1.0 | RDF/SKOS commercial relationship graph |

The component specifications explicitly establish the responsibility boundary between semantic resolution, intent discovery, orchestration, enrichment, taxonomy mapping, evidence, and capability matching. fileciteturn24file0L92-L108 fileciteturn24file1L15-L31

CSRE remains the authority for the user's actual referent and preserves Phrase → MarketConcept identity rather than substituting a GPC node for the concept. fileciteturn24file2L1170-L1216

The Enrichment layer consumes resolved concepts and expands them for downstream semantic/taxonomy use without becoming the GPC classifier. fileciteturn24file3L8-L24

WRS remains an evidence-acquisition capability rather than a final decision-maker, with stable evidence identity and a downstream Evidence System handoff. fileciteturn24file4L143-L157 fileciteturn24file4L417-L450

The Evidence System maintains the distinction between observation, evidence, insight/knowledge, current belief, and graph decision, including the distinction between graph priors and real-world evidence. fileciteturn24file5L27-L43 fileciteturn24file5L306-L327

GPC remains the immutable classification backbone and uses one strongest defensible mapping rather than exposing equal alternatives when a winner exists. fileciteturn24file6L15-L55

---

# 2. Final System Model

## 2.1 Complete Runtime

```text
                    ┌───────────────────────────────┐
                    │     External Channels         │
                    │ WhatsApp / Web / SMS / USSD   │
                    └───────────────┬───────────────┘
                                    │
                              Channel Adapter
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │ MCOS Ingestion          │
                       │ identity + dedupe       │
                       │ persistence + lock      │
                       └────────────┬────────────┘
                                    │
                             Logical Turn
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │ LangGraph Orchestrator  │
                       └────────────┬────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
               ┌─────────┐                     ┌─────────┐
               │  IDCE   │                     │  CSRE   │
               │ intent  │                     │referent │
               └────┬────┘                     └────┬────┘
                    │                               │
                    └──────────────┬────────────────┘
                                   ▼
                          Unified Understanding
                                   │
                                   ▼
                         Intent / Action Graph
                                   │
                            Dependency Planner
                                   │
                            Execution Scheduler
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
        Conversation          Semantic/TM         Marketplace
          actions              pipeline              actions
              │                    │                    │
              │              ┌─────┴─────┐              │
              │              ▼           ▼              │
              │         Enrichment   GPC Resolver       │
              │              │           │              │
              │              └─────┬─────┘              │
              │                    ▼                    │
              │              Capability Search           │
              │                    │                    │
              │                    ▼                    │
              │            Matching & Fanout             │
              │                    │                    │
              │                    ▼                    │
              │                  vendor capability graph               │
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   ▼
                           Deterministic Workflows
                                   │
                                   ▼
                           Domain / Capability APIs
                                   │
                    ┌──────────────┴───────────────┐
                    ▼                              ▼
             Evidence Events                 User Response
                    │                              │
                    ▼                              ▼
             Evidence System               Response Composer
                    │                              │
                    ▼                              ▼
            Graph / Beliefs                 Delivery Engine
```

MCOS + LangGraph explicitly owns orchestration while specialist engines retain their authoritative boundaries. fileciteturn24file0L92-L108

## 2.2 Mental Model for the Implementation Agent

The implementation agent must reason about the system using four questions:

```text
1. What is the transport/runtime state?
   → MCOS

2. What does the user want and what do they refer to?
   → IDCE + CSRE

3. What structured commercial representation is required?
   → Enrichment + GPC + Capability Layer

4. What deterministic business action should happen?
   → LangGraph + Workflow Engine + Capability Services
```

Never let an LLM node silently answer all four questions.

---

# 3. Architectural Laws

These rules are non-negotiable.

## 3.1 One Authority per Decision

Every important decision has one owner.

| Decision | Authority |
|---|---|
| Physical message handling | MCOS |
| Logical turn formation | MCOS |
| User intent | IDCE |
| Referent / semantic meaning | CSRE |
| Semantic expansion | Enrichment |
| Sovereign taxonomy mapping | GPC Resolver |
| External evidence acquisition | WRS |
| Evidence truth / belief / graph learning | Evidence System |
| Vendor capability representation | Capability Projection module + Evidence System |
| Vendor matching/ranking/fanout | Matching & Fanout module |
| Workflow execution | Workflow Engine |
| Conversation planning/routing | LangGraph |
| Final delivery | MCOS / Delivery Engine |

## 3.2 AI Is Never the Business-State Owner

AI may:

- interpret;
- classify;
- extract;
- rank candidate meanings;
- propose a plan;
- generate clarification text;
- summarise evidence;
- select a response structure.

AI must not directly:

- deduct credits;
- change vendor status;
- create a workflow record;
- mark onboarding complete;
- fan out requests;
- write a capability belief;
- change a GPC node;
- mutate a wallet;
- send an irreversible external action.

All such operations go through deterministic domain ports.

## 3.3 Schema Before Action

Every AI output that crosses a component boundary must be:

```text
LLM output
   ↓
parse
   ↓
JSON Schema validation
   ↓
semantic invariant validation
   ↓
adapter mapping
   ↓
service/domain call
```

Invalid output does not become a business action.

## 3.4 Evidence Is Not Truth

WRS returns evidence. Evidence System evaluates and persists it. A model-generated inference must never be silently promoted to observed fact.

## 3.5 Graph Proximity Is Not Capability Proof

A vendor being related to an electrical category does not prove it sells every product in that category.

A graph relationship is a prior/hypothesis until supported by evidence.

## 3.6 GPC Similarity Is Not Semantic Truth

Taxonomy retrieval helps classify a known concept; it does not redefine the concept.

## 3.7 Only the Best Defensible Decision Wins

Where one interpretation or vendor is clearly superior, return/select it.

Where materially different alternatives remain genuinely unresolved, retain the alternatives diagnostically and ask one useful clarification when it can materially reduce uncertainty.

---

# 4. The Conversation Lifecycle

## 4.1 Transport Message

A channel event is persisted immediately.

```text
provider event
    ↓
canonical inbound message
    ↓
persist
    ↓
dedupe/idempotency
```

## 4.2 Logical Turn Assembly

MCOS merges short additive messages into one logical conversational turn. The IDCE design explicitly requires IDCE to operate on the assembled turn rather than transport message boundaries. fileciteturn24file1L81-L105

Example:

```text
"I need photoframes"
"black ones"
"for a wedding"
"around Warri"
```

becomes one logical turn.

A correction or unrelated request can become a separate turn/action transition.

## 4.3 Understanding

LangGraph invokes IDCE and CSRE in parallel when their inputs are independent.

```text
                  Logical Turn
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
          IDCE                 CSRE
             │                   │
        intent graph        object graph
             └─────────┬─────────┘
                       ▼
              Unified Understanding
```

CSRE may resolve multiple independently meaningful objects and preserve exact surface form, context, relationships, and semantic origin. fileciteturn24file2L131-L159

## 4.4 Planning

LangGraph combines intent and object structures into intent/action units.

Example:

```text
A1 FIND_PRODUCT
    object=photoframes

A2 LOCATION_CONSTRAINT
    location=Warri

A3 FIND_VENDOR
    object=photoframes
    depends_on=A1
```

The graph scheduler decides which actions may be parallelized and which must be serialized.

## 4.5 Execution

Independent reads may execute in parallel.

State-conflicting mutations execute serially.

```text
parallel-safe:
    semantic enrichment
    GPC retrieval
    evidence retrieval

serialized:
    wallet deduction
    onboarding state transition
    fanout credit deduction
    workflow completion
```

## 4.6 Response

Action results are normalised into a response plan, then Response Composer creates the channel-neutral response artifact. Delivery Engine sends it and persists delivery state.

---

# 5. End-to-End Semantic Commerce Pipeline

For a commercially meaningful product/service/vendor request, use:

```text
User language
   ↓
Logical Turn
   ↓
IDCE
   ↓
CSRE / CMEE
   ↓
Enrichment
   ↓
GPC Resolver (when classification is useful)
   ↓
Capability Layer (when vendor capability work is required)
   ↓
Workflow / Capability execution
   ↓
Evidence observation
   ↓
Evidence System
   ↓
Response
```

Not every request must traverse every stage.

For example:

- Greeting should not invoke GPC.
- Account balance should not invoke CSRE/GPC.
- Non-commercial small talk should not invoke the commercial pipeline.
- A familiar product search may use CSRE fast path and skip WRS.
- An obscure product term may trigger WRS only inside CSRE.
- A vendor onboarding statement must enter the Capability Projection module after semantic resolution.

The pipeline is **capability-driven, not ceremony-driven**.

---

# 6. Component Implementation Standard

Every component must be implemented as a small independently callable service/module with a stable port.

## 6.1 Standard Hexagonal Shape

Each component should use the following structure:

```text
src/
  domain/
    entities/
    value-objects/
    policies/
    services/
    errors/

  application/
    use-cases/
    commands/
    queries/
    dto/

  ports/
    inbound/
    outbound/

  adapters/
    inbound/http/
    inbound/internal/
    outbound/postgres/
    outbound/redis/
    outbound/graph/
    outbound/vector/
    outbound/llm/
    outbound/web/

  infrastructure/
    config/
    logging/
    telemetry/
    persistence/

  prompts/
    master/
    runtime/
    sub-prompts/
    schemas/

  index.ts
```

The exact directory names may differ, but the ownership rule must remain.

## 6.2 Inbound Ports

Inbound ports define what the component can do.

Examples:

```typescript
interface ResolveCommercialSemantics {
  execute(input: CSRERequest): Promise<CSREResponse>;
}

interface ProjectVendorCapabilities {
  execute(input: CapabilityProjectionRequest): Promise<CapabilityProjectionResponse>;
}

interface MatchVendors {
  execute(input: MatchingRequest): Promise<MatchingResponse>;
}
```

## 6.3 Outbound Ports

Outbound ports hide infrastructure:

```typescript
interface PromptModelPort { ... }
interface EvidenceRepositoryPort { ... }
interface GraphRepositoryPort { ... }
interface VectorSearchPort { ... }
interface ConversationRepositoryPort { ... }
interface WorkflowRepositoryPort { ... }
interface NotificationPort { ... }
interface CreditLedgerPort { ... }
```

The domain must not import Prisma, Redis, Neo4j, LangGraph, OpenAI SDKs, HTTP clients, or vendor channel SDKs directly.

---

# 7. Prompt-Driven Component Implementation

Prompts are treated as executable configuration, not comments.

## 7.1 Prompt Stack

Every LLM-driven component should have:

```text
component/
  prompts/
    master.prompt.md
    runtime.prompt.md
    evidence.prompt.md
    decision.prompt.md
    clarification.prompt.md
    schemas/
      *.json
```

## 7.2 Runtime Prompt Invocation

A prompt execution must capture:

```json
{
  "request_id": "...",
  "component": "CSRE",
  "component_version": "5.1",
  "prompt_id": "csre.runtime.resolve",
  "prompt_version": "...",
  "model_provider": "...",
  "model_name": "...",
  "input_hash": "...",
  "input": {},
  "output": {},
  "schema_validation": {
    "valid": true,
    "errors": []
  },
  "decision_summary": {},
  "latency_ms": 0,
  "usage": {}
}
```

Do not persist hidden chain-of-thought. Persist the structured decision, evidence references, reason codes, confidence, and relevant audit metadata.

## 7.3 Prompt Execution Rule

```text
prepare typed input
    ↓
select pinned prompt/version
    ↓
call LLM provider abstraction
    ↓
parse
    ↓
schema validation
    ↓
semantic validation
    ↓
retry/repair boundedly when appropriate
    ↓
accept or return typed failure
```

The component must never accept arbitrary free-form model output from a prompt whose contract claims to be structured.

---

# 8. MCOS + LangGraph Implementation

MCOS is the application shell and reliability layer. LangGraph is the conversation orchestration graph.

The current MCOS design explicitly separates business state from LangGraph checkpoint state and requires workflow execution through typed boundaries. fileciteturn24file0L199-L205

## 8.1 MCOS Responsibilities

MCOS implements:

- channel adapters;
- canonical inbound messages;
- message persistence;
- deduplication;
- conversation identity;
- distributed conversation lock;
- logical turn assembly;
- conversation persistence;
- outbound delivery;
- idempotency;
- durable job/outbox processing;
- API surface;
- authentication/authorisation;
- observability;
- LLM provider abstraction;
- runtime recovery.

## 8.2 LangGraph Responsibilities

LangGraph implements:

- understanding graph;
- continuity decisions;
- intent/object coordination;
- dependency planning;
- execution scheduling;
- clarification control;
- workflow routing;
- result normalisation;
- response planning.

## 8.3 Graph State

The graph state must be treated as **reconstructible orchestration state**, not the canonical database.

The current state contract already includes conversation ID, turn ID, run ID, input, context, understanding, plan, execution, responses, clarification, recovery and lifecycle state. fileciteturn23file0L11-L36

## 8.4 Thread Model

Use:

```text
thread_id = conversation:{conversationId}
run_id    = turn:{turnId}
```

Do not create a new unrelated graph thread for every transport message.

---

# 9. IDCE Implementation

IDCE answers:

> What is the user trying to accomplish?

Its existing contract supports multiple intents, relations, dependencies, scope, priority, confidence, explicitness and clarification recommendations. fileciteturn23file1L62-L130

## 9.1 Input

IDCE receives:

- logical turn;
- previous turn summary;
- active workflows;
- relevant bounded context;
- current account role;
- known constraints;
- reference resolution context where needed.

## 9.2 Output

IDCE returns an `IDCEResolution`.

LangGraph then maps intent types into internal action/workflow candidates. IDCE does not select the final workflow.

## 9.3 Important Rule

The implementation must not create a giant intent enum with workflow names as if they were intents.

Example:

```text
Correct:
BUY → BuyerSearchWorkflow
FIND_VENDOR → VendorDiscoveryWorkflow
RECHARGE_CREDITS → AccountWorkflow

Incorrect:
BUYER_SEARCH_WORKFLOW = intent
```

---

# 10. CSRE Implementation

CSRE is the authoritative semantic layer.

It must support arbitrary real-world expressions including informal names, slang, Nigerian Pidgin, phonetic spellings, brands, models, descriptions, domains, categories, services, venues and multiple objects. fileciteturn24file2L16-L54

## 10.1 Required Internal Pipeline

```text
raw logical turn
      ↓
CMEE
      ↓
object records
      ↓
candidate generation
      ↓
contextual resolution
      ↓
commercial interpretation
      ↓
optional evidence request to WRS
      ↓
resolution adjudication
      ↓
canonicalisation
      ↓
semantic-origin output
```

## 10.2 Multi-Object Requirement

Each independently meaningful object receives its own `object_id`.

Shared context is represented separately.

For example:

```text
"I need a hammer, nails and electrical materials for roofing"

objects:
  object_1 hammer
  object_2 nails
  object_3 electrical materials

context:
  functional_context: roofing
```

CSRE's CMEE contract explicitly requires independent object records and stable object IDs. fileciteturn24file2L131-L159

## 10.3 Semantic Origin

Every resolved object must preserve:

```text
phrase
concept
market_concept_id
concept_status
relationship=EXPRESSES
origin=CSRE
request_id
semantic_confidence
```

This enables Evidence System learning without making CSRE the learning database. fileciteturn22file7L1238-L1276

---

# 11. Semantic Enrichment Implementation

Enrichment consumes CSRE output and makes it more useful for search, classification and matching.

Its core role is to provide definition, functions, use cases, attributes, terminology, distinguishing features, confusable concepts, taxonomy-oriented vocabulary and multiple embedding representations. fileciteturn24file3L154-L221

## 11.1 Pipeline

```text
CSRE object
   ↓
identity validation
   ↓
known knowledge lookup
   ↓
optional WRS evidence request
   ↓
LLM enrichment
   ↓
schema validation
   ↓
lineage attachment
   ↓
Enrichment result
```

## 11.2 Persistence

Store durable enrichment snapshots by:

```text
market_concept_id / object identity
+ enrichment_version
+ source_resolution_request_id
+ evidence_ids
```

Do not overwrite history destructively. Current enrichment may be updated while old versions remain auditable.

---

# 12. GPC Resolver Implementation

The GPC Resolver is the sovereign classifier.

The current architecture intentionally distinguishes:

```text
CSRE      = meaning
Enrich    = classification-ready semantic context
GPC       = sovereign taxonomy mapping
```

The GPC Resolver consumes CSRE + Enrichment + market knowledge + evidence and selects the strongest defensible existing GPC representation. fileciteturn23file3L194-L237

## 12.1 Retrieval Architecture

Recommended:

```text
GPC dataset versioned files
          │
          ├── parser
          ├── canonical relational storage
          └── embedding index
                     │
                     ▼
              PGVector retrieval
                     │
                     ▼
              candidate shortlist
                     │
                     ▼
              hierarchy-aware resolver
```

The official taxonomy remains immutable. The operational search index is replaceable.

## 12.2 Mapping Invariant

```text
MAPPED
  → gpc_code required
  → gpc_level required
  → gpc_title required

NON-MAPPED
  → those fields null
```

The current GPC Resolver contract already establishes this distinction. fileciteturn23file3L240-L287

## 12.3 Do Not Force Non-Products

Services, people, venues, capabilities and non-commercial concepts must not be forced into product GPC classes merely to obtain a taxonomy ID.

---

# 13. WRS Implementation

WRS is a shared outbound evidence service.

Its request is consumer-aware and its response retains request ID, evidence IDs, source provenance, quality, confidence, contradictions and relationship targets. fileciteturn24file4L56-L83 fileciteturn24file4L87-L139

## 13.1 Retrieval Pipeline

```text
Evidence Request
    ↓
query planning
    ↓
search/provider adapters
    ↓
source collection
    ↓
source evaluation
    ↓
evidence extraction
    ↓
evidence normalisation
    ↓
contradiction analysis
    ↓
stable WRS response
```

## 13.2 Provider Abstraction

WRS must support multiple retrieval adapters behind one port.

```typescript
interface SearchProviderPort {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}
```

Providers may include general web search, targeted web pages, marketplaces, public directories and future local data providers.

The component must not couple the evidence contract to one search provider.

---

# 14. Evidence System Implementation

The Evidence System is the long-lived learning substrate.

Its fundamental pipeline is:

```text
RAW OBSERVATION
      ↓
EVIDENCE
      ↓
INSIGHT / KNOWLEDGE
      ↓
CURRENT BELIEF
      ↓
GRAPH DECISION
```

This layered model is explicitly part of the current design. fileciteturn24file5L27-L51

## 14.1 Observation Sources

At minimum:

- buyer requests;
- buyer clarifications;
- vendor onboarding statements;
- vendor inventory updates;
- vendor confirmations;
- vendor rejections;
- matching outcomes;
- successful fulfillment;
- WRS evidence;
- CSRE semantic resolutions;
- Enrichment-derived knowledge;
- GPC mapping facts;
- marketplace behavioural observations.

## 14.2 Independence

Duplicate transport delivery or repeated replay must not become independent evidence.

The Evidence System explicitly requires evidence independence handling. fileciteturn24file5L363-L387

## 14.3 Capability Evidence

Vendor capability belief must be built from capability evidence, not taxonomy proximity alone.

```text
Vendor explicitly says:
  "I sell perfume"

→ positive capability observation
→ evidence
→ belief update
```

Where the graph says:

```text
Vendor → related_to → cosmetics
```

that is only a prior/hypothesis.

---

# 15. Capability Layer — Vendor Capability Projection and Matching & Fanout

The system retains two distinct marketplace responsibilities without introducing two additional top-level engines or services:

1. **Capability Projection** — converts vendor-originated commercial observations into durable, evidence-linked vendor capability representations.
2. **Matching & Fanout** — retrieves, filters, scores, ranks, and distributes buyer demand against those capability representations.

Both are modules/application ports in the modular-monolith architecture. They may be extracted into independently deployable services later if scale or ownership requires it.

## 15.1 Capability Projection — Purpose

Capability Projection answers:

> **What does this vendor have evidence-backed reason to supply, sell, service, install, repair, rent, distribute, or otherwise do?**

It consumes vendor-originated observations and the authoritative semantic/taxonomy outputs already produced elsewhere. It does not independently reinterpret raw language.

### Inputs

- vendor onboarding statements;
- vendor inventory updates;
- vendor corrections;
- vendor clarification answers;
- vendor confirmations;
- vendor rejections;
- historical capability evidence;
- CSRE semantic objects;
- Enrichment output;
- GPC mappings where useful;
- Evidence System beliefs and relationships;
- vendor profile/location context.

### Output

A capability assertion is a durable application/domain representation linked to its evidence rather than a replacement for evidence itself. Example:

```json
{
  "vendor_id": "vendor_123",
  "capability_id": "cap_001",
  "object_id": "object_001",
  "market_concept_id": "mc_001",
  "capability_type": "PRODUCT_SUPPLY",
  "gpc_code": "...",
  "status": "ACTIVE",
  "belief_score": 0.913,
  "evidence_ids": ["ev_1", "ev_2"],
  "source_type": "VENDOR_ASSERTION"
}
```

The capability record must preserve provenance, timestamps, evidence references, source type, polarity/history, and validity.

### Capability types

At minimum:

```text
PRODUCT_SUPPLY
PRODUCT_CATEGORY_SUPPLY
SERVICE_PROVISION
PROFESSIONAL_CAPABILITY
CUSTOM_WORK
REPAIR
INSTALLATION
RENTAL
DISTRIBUTION
OTHER_COMMERCIAL_CAPABILITY
```

### Progressive capability discovery

A broad statement must not be expanded into unsupported inventory.

```text
"I sell electrical materials"
        ↓
PRODUCT_CATEGORY_SUPPLY
        ↓
"electrical materials"
```

Later evidence may establish specific capabilities such as wall sockets, cables, bulbs, conduit pipes, or switches. The Evidence System determines belief from evidence; graph proximity and taxonomy adjacency are not proof of vendor capability.

### Capability graph projection

The operational graph may represent:

```text
Vendor
  ├── SUPPLIES → MarketConcept
  ├── OFFERS_SERVICE → MarketConcept
  ├── SPECIALISES_IN → MarketConcept
  ├── SERVES_LOCATION → Location
  ├── ACCEPTS_ORDER_FOR → MarketConcept
  └── HAS_CAPABILITY → CapabilityNode
```

Capability edges carry evidence-derived state such as belief score, status, first/last observed timestamps, evidence counts, source types, confidence, and validity.

### Capability Projection boundaries

It MUST NOT:

- determine buyer intent;
- independently resolve arbitrary customer language;
- rank vendors;
- deduct credits;
- disclose customer contact details;
- mutate official GPC taxonomy;
- convert unsupported inferred capability into confirmed inventory.

## 15.2 Matching & Fanout — Purpose

Matching & Fanout answers:

> **Which eligible vendor capabilities best satisfy this specific buyer demand right now, and in what order should demand be distributed?**

It consumes structured demand produced by LangGraph from IDCE + CSRE + downstream semantic/taxonomy processing. It never needs to reinterpret raw conversation.

### Matching input

```text
request_id
turn_id
intent_id
objects
semantic identities
GPC mappings where available
location constraints
venue constraints
quantity/attributes
temporal constraints
customer role/context
matching policy
```

### Retrieval signals

Use multiple signals:

```text
exact MarketConcept identity
        +
GPC compatibility
        +
vector similarity
        +
capability graph relationships
        +
Evidence System capability belief
        +
location eligibility
        +
operational freshness
```

Vector similarity is a candidate generator, not the sole final decision.

### Candidate pipeline

```text
Demand
  ↓
structured filters
  ↓
MarketConcept / GPC retrieval
  ↓
vector retrieval
  ↓
capability graph traversal
  ↓
candidate union + deduplication
  ↓
eligibility filtering
  ↓
deterministic scoring
  ↓
ranking
  ↓
fanout policy
```

### Eligibility

Before ranking, exclude vendors that are inactive, explicitly negative for the capability, below freshness/belief policy, outside required geography, restricted, operationally blocked, invalidated, or otherwise ineligible.

### Scoring

Do not use one opaque LLM score. Use a deterministic, versioned composite model with inspectable feature contributions, for example:

```text
match_score =
    semantic_fit
  + gpc_fit
  + capability_belief
  + attribute_fit
  + location_fit
  + freshness
  + operational_quality
  - contradiction_penalty
```

Exact weights are policy/configuration, not hard-coded business truth.

### Fanout and business actions

The matching module computes the ordered recipient plan. Deterministic domain services execute irreversible actions:

```text
rank strongest eligible vendors
        ↓
select initial vendor/group according to policy
        ↓
request deterministic credit transaction
        ↓
notify vendor
        ↓
disclose customer/vendor information according to policy
        ↓
fan out remaining demand to subsequent eligible vendors
        ↓
record vendor response/outcome
```

The wallet/credit service owns financial state. The delivery/notification service owns delivery. Matching & Fanout only requests those actions through ports and records their resulting decisions.

### Evidence feedback

Matching outcomes become Evidence System observations, including positive response, negative response, no response, customer contact, successful fulfilment, and failed fulfilment. Matching never directly rewrites capability belief.

## 15.3 Why This Is a Module Boundary, Not a New Engine Layer

Capability projection and matching are architecturally distinct responsibilities, but the initial deployment must keep them inside the existing application/domain architecture.

```text
Capability Layer
├── capability-projection/
│   ├── domain/
│   ├── application/
│   └── ports/
│
└── matching-fanout/
    ├── domain/
    ├── application/
    └── ports/
```

They may use internal ports to call Evidence, GPC, vector, graph, wallet, notification, and workflow capabilities. No network hop is required merely to preserve responsibility boundaries.

## 15.4 Extraction Rule

Only extract either module into a separate service when there is a concrete operational reason such as independent scaling, deployment isolation, ownership, or failure-domain requirements. The internal contracts should remain stable so extraction does not change the domain semantics.

---

# 17. Datastore Strategy

The system must use **different storage technologies for different classes of state**.

## 17.1 PostgreSQL — Transactional Source of Truth

PostgreSQL is the primary system of record for durable application state.

Use it for:

- users;
- accounts;
- vendors;
- vendor profiles;
- conversations;
- messages;
- logical turns;
- workflows;
- workflow instances;
- wallet/credit ledger;
- matching requests;
- fanout records;
- delivery records;
- idempotency records;
- outbox/inbox records;
- prompt execution metadata;
- schema validation records;
- current pointers to semantic versions;
- audit metadata.

Prisma remains a suitable application ORM in the TypeScript stack.

## 17.2 Redis — Ephemeral/Coordination State

Redis is for:

- conversation locks;
- short-lived caches;
- distributed coordination;
- rate limiting;
- temporary work queues where appropriate;
- dedupe acceleration;
- hot capability cache;
- hot search cache.

Redis must never be the only copy of business state.

Any state required to reconstruct the business must be persisted in PostgreSQL or another durable source.

## 17.3 Vector Database

Use **PostgreSQL + pgvector** as the initial vector store unless measured scale later requires separation into a dedicated vector database.

This keeps:

```text
relational concept metadata
+
embedding
+
version
+
source provenance
```

close together and is consistent with the GPC Resolver architecture's use of PostgreSQL/PGVector retrieval.

Use vectors for:

- market concepts;
- phrase embeddings;
- taxonomy nodes;
- enriched semantic representations;
- vendor capability representations;
- buyer demand representations;
- search aliases.

Vectors are retrieval indexes, not sources of truth.

## 17.4 Graph Database

Use **Neo4j** for the operational marketplace knowledge/capability graph in the first production implementation.

The graph stores traversable relationships such as:

```text
Phrase → EXPRESSES → MarketConcept
MarketConcept → MAPPED_TO → GPC
Vendor → SUPPLIES → MarketConcept
Vendor → OFFERS_SERVICE → MarketConcept
Vendor → SERVES_LOCATION → Location
Concept → SUBSTITUTE_FOR → Concept
Concept → COMMONLY_SOLD_WITH → Concept
BuyerRequest → REQUESTED → MarketConcept
Evidence → SUPPORTS → Assertion
Evidence → CONTRADICTS → Assertion
```

The source GPC/SKOS dataset remains sovereign and versioned. The graph is an operational projection of approved taxonomy and market relationships; it must never mutate the official GPC source.

## 17.5 Object Storage

Use S3-compatible object storage for:

- media;
- raw provider payloads;
- large external evidence snapshots;
- exported graph snapshots;
- prompt artifacts;
- debugging/replay bundles when too large for PostgreSQL.

Store only references/checksums in transactional records.

---

# 18. General Persistence Strategy — No Context Loss, No Data Loss

This is a core requirement.

> **Anything required to understand what happened, why it happened, what was decided, and what state resulted must be reconstructible.**

## 18.1 Persistence Layers

```text
                  ┌─────────────────────────┐
                  │ PostgreSQL               │
                  │ system of record        │
                  └───────────┬─────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
 conversation history   workflow state      financial ledger

        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  graph projection       vector indexes        object storage
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                    searchable/reconstructible state
```

## 18.2 Persist Every Inbound Message

Before any AI reasoning:

```text
provider event
→ canonical message
→ durable insert
→ idempotency key
→ acknowledgement
```

Only then should processing continue.

## 18.3 Persist Every Logical Turn

Store:

```text
turn_id
conversation_id
message_ids
assembled_text
assembly_reason
start/end timestamps
context snapshot ID
turn status
orchestration run ID
```

## 18.4 Persist Specialist Outputs

Persist validated outputs from:

- IDCE;
- CSRE;
- Enrichment;
- GPC Resolver;
- Capability Projection;
- Matching & Fanout;
- WRS;
- Evidence System.

Store them with request/version/correlation metadata.

## 18.5 Persist Decision Lineage

Every meaningful downstream decision should be traceable:

```text
user message
  ↓
turn
  ↓
intent
  ↓
object
  ↓
semantic resolution
  ↓
enrichment
  ↓
GPC mapping
  ↓
capability candidate
  ↓
match score
  ↓
selected vendor
  ↓
fanout action
```

## 18.6 Append-Only Event Records

Critical state changes should create durable events before or atomically with current-state mutation.

Example:

```text
VendorOnboardingStarted
VendorCapabilityObserved
CapabilityBeliefUpdated
BuyerRequestCreated
VendorCandidateSelected
FanoutDispatched
VendorResponded
CreditCharged
DeliveryQueued
DeliverySucceeded
```

Current-state tables are projections of event history, not the only record of what happened.

## 18.7 Inbox/Outbox Pattern

Use:

```text
Inbound message
    ↓
Inbox record
    ↓
transactional processing
    ↓
state change
    ↓
Outbox event
    ↓
background publisher
```

Do not rely on an in-memory callback to deliver an important event.

## 18.8 Context Snapshots

Context must be reconstructible from durable records.

Store a bounded snapshot containing:

```text
active workflows
active objectives
recent resolved objects
recent relevant semantic concepts
pending clarification
known user role
location
vendor context
account state references
latest turn summaries
```

Use snapshot IDs and version numbers.

## 18.9 Context Compaction

Do not retain unlimited full context inside LangGraph state.

Instead:

```text
raw transcript → durable message store
              ↓
turn summaries
              ↓
semantic state
              ↓
active workflow state
              ↓
bounded graph context
```

Raw history remains available for replay.

## 18.10 No Silent Overwrite

When a new resolution supersedes an old one:

```text
old record → SUPERSEDED_BY → new record
```

not destructive mutation with no history.

## 18.11 Checkpoints

LangGraph checkpoints are for orchestration recovery only.

Business truth stays in PostgreSQL/domain services.

This agrees with the MCOS boundary that graph/checkpoint state is not the source of truth for domain records. fileciteturn24file0L63-L65

---

# 19. No-Data-Loss Failure Handling

## 19.1 Component Failure

If a specialist fails:

```text
failure
  ↓
persist typed failure
  ↓
mark dependent actions BLOCKED
  ↓
continue independent actions
  ↓
recovery policy
```

A failed component must not erase previous successful outputs.

## 19.2 Network Failure

Every external operation uses:

- request ID;
- idempotency key;
- timeout;
- retry policy;
- bounded exponential backoff;
- circuit breaker where appropriate;
- durable result state.

## 19.3 Duplicate Execution

All externally visible mutations must be idempotent.

Examples:

```text
wallet charge key
fanout dispatch key
workflow command key
outbound delivery key
vendor notification key
```

## 19.4 Crash Recovery

After process restart:

```text
load pending durable work
    ↓
rebuild context
    ↓
resume graph run or create recovery run
    ↓
recheck idempotency
    ↓
continue from durable state
```

The system must never depend on an in-memory object surviving a process restart.

---

# 20. Workflow Catalogue for Initial Release

Only the following workflows are required initially.

## 20.1 Vendor Onboarding

Goal: register a vendor through a conversational experience.

Input examples:

```text
"I sell perfumes"
"I dey sell building materials"
"I supply phones and accessories"
```

Flow:

```text
Vendor expresses intention
    ↓
IDCE → SELL/OFFER
    ↓
CSRE → commercial objects
    ↓
Capability Projection → vendor capability representation
    ↓
ask only materially useful onboarding questions
    ↓
collect name/profile/location
    ↓
validate required fields
    ↓
create/update vendor profile
    ↓
persist capabilities
    ↓
respond naturally
```

The onboarding conversation should feel like one coherent dialogue, not a form rendered as chat bubbles.

## 20.2 Buyer Search — Product

Example:

```text
"Where can I get photoframes around Warri?"
```

Flow:

```text
IDCE → BUY / FIND_PRODUCT
CSRE → photoframes
context → Warri
Enrichment → search representation
GPC → where useful
Matching & Fanout → vendor candidates
Workflow → fanout/search
Evidence → outcome recording
Response → buyer-facing result
```

## 20.3 Find Vendor

Example:

```text
"I need someone that sells perfume"
```

Flow:

```text
IDCE → FIND_VENDOR
CSRE → perfume
Matching & Fanout → vendor capability match
fanout / response policy
```

## 20.4 Find Venue

Examples:

```text
"Which bookshop has this book?"
"Do you know a gift shop around Warri?"
```

Venue is a first-class contextual target rather than a product substitute.

The system resolves:

```text
requested object
+
venue requirement
+
location
```

Then uses location-aware vendor/business capability retrieval.

## 20.5 Greeting

Requirement:

> Warmly greet the user and ask what they want to do **in the same turn**.

Example behavior:

```text
User: "Hi"

Assistant:
"Hi 👋 Good to have you here. What would you like to do today — buy something, sell something, or find a vendor?"
```

Do not create an unnecessarily long greeting workflow.

## 20.6 Account

Supports initially:

```text
recharge credits
check credit balance
```

The wallet/credit domain owns the actual financial state.

Example:

```text
"How many credits do I have?"
→ account intent
→ read wallet balance
→ respond
```

## 20.7 FAQ

For unsupported FAQ topics:

```text
recognise FAQ intent
→ do not fabricate answer
→ tell user the feature is coming soon
```

The response should be useful but explicitly limited.

## 20.8 Random / Small Talk

A random conversational message receives **one conversational turn** of engagement.

Then:

```text
active workflow exists
    → gently steer back to it

no active workflow
    → ask whether user wants to buy or sell / find something
```

Never let casual conversation silently create a fake commercial action.

## 20.9 Price Enquiry

Price enquiry is intentionally unsupported as a dedicated pricing service.

It resolves operationally to vendor discovery.

Example:

```text
"How much is perfume?"
```

Response strategy:

```text
find vendors who can supply perfume
→ tell user that direct price lookup is not currently supported
→ recommend vendors so the user can make enquiries themselves
```

Do not invent prices.

---

# 21. Workflow Routing Matrix

| User objective | IDCE | CSRE | Enrichment | GPC | Capability Projection | Matching & Fanout | WRS | Action |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Greeting | ✓ | optional | – | – | – | – | – | Greeting response |
| Vendor onboarding | ✓ | ✓ | ✓ | optional | ✓ | – | optional | Onboarding workflow |
| Product search | ✓ | ✓ | ✓ | usually | – | ✓ | conditional | Buyer Search |
| Find vendor | ✓ | ✓ | ✓ | usually | – | ✓ | conditional | Vendor Discovery |
| Find venue | ✓ | ✓ | ✓ | optional | – | ✓ | conditional | Venue Discovery |
| Account balance | ✓ | – | – | – | – | – | – | Account workflow |
| Recharge | ✓ | – | – | – | – | – | – | Wallet workflow |
| FAQ | ✓ | optional | – | – | – | – | – | Coming-soon response |
| Random | ✓ | optional | – | – | – | – | – | Small talk + steer |
| Price enquiry | ✓ | ✓ | ✓ | optional | – | ✓ | conditional | Find vendors + caveat |

---

# 22. Clarification Strategy

The whole system follows the rule:

> Ask at most one high-information clarification question for a logical turn unless a deterministic transactional workflow requires a separate confirmation.

CSRE and IDCE may recommend clarification; LangGraph decides whether to actually ask.

## 22.1 Clarification Decision

Prefer clarification only when:

```text
uncertainty is material
AND
one question can substantially reduce it
AND
unrelated valid work should not be blocked
```

## 22.2 Bad Clarification

```text
"Please tell me everything you need so I can help you better."
```

## 22.3 Better Clarification

```text
"Do you mean wall sockets or complete electrical fittings?"
```

The question should target the actual decision boundary.

---

# 23. Evidence and Learning Loop

The platform continuously learns from interactions.

```text
Conversation
    ↓
structured event
    ↓
Evidence System
    ↓
observation
    ↓
evidence
    ↓
belief
    ↓
graph update
    ↓
future retrieval / resolution / matching
```

## 23.1 Example — Local Slang

```text
Buyer says: "iron sponge"
      ↓
CSRE resolves → steel wool / scouring pad
      ↓
semantic-origin observation
      ↓
Evidence System
      ↓
phrase relationship strengthened
      ↓
future buyer/vendor requests resolve faster
```

CSRE is the origin of the Phrase → Concept relationship; Evidence System determines durable persistence/strength. fileciteturn22file7L529-L562

## 23.2 Example — Vendor Capability

```text
Vendor: "I sell wall sockets"
      ↓
CSRE
      ↓
Capability Projection
      ↓
Vendor → SUPPLIES → wall sockets
      ↓
Evidence System
      ↓
capability belief
      ↓
Matching & Fanout uses belief during buyer matching
```

## 23.3 Example — Negative Evidence

```text
Vendor says:
"No, I don't sell perfume."

→ negative capability evidence
→ belief decreases
→ Matching & Fanout candidate eligibility/ranking changes
```

---

# 24. API Surface

The system should expose each major component through a stable HTTP/internal API contract even when deployed inside the same process initially.

## 24.1 Suggested Endpoints

```text
POST /v1/conversations/{conversationId}/messages
POST /v1/turns/assemble
POST /v1/idce/resolve
POST /v1/csre/resolve
POST /v1/enrichment/resolve
POST /v1/wrs/retrieve
POST /v1/gpc/resolve
POST /v1/capabilities/project
POST /v1/matching/match
POST /v1/workflows/execute
POST /v1/evidence/ingest
GET  /v1/conversations/{conversationId}
GET  /v1/turns/{turnId}
GET  /v1/runs/{runId}
GET  /v1/requests/{requestId}/trace
```

The implementation may start as a modular monolith with these as internal application ports before services are physically separated.

## 24.2 Why Modular Monolith First

The architecture separates responsibilities logically but does not require premature microservices.

Recommended progression:

```text
Phase 1
modular monolith

Phase 2
worker isolation

Phase 3
extract high-load components

Phase 4
independent scaling
```

This keeps contracts stable while reducing distributed-system complexity early.

---

# 25. Request Correlation

Every request crossing a boundary should carry:

```text
request_id
conversation_id
turn_id
run_id
parent_request_id
component
component_version
schema_version
prompt_version (when applicable)
created_at
```

Example:

```text
MCOS request
REQ-001
  ↓
IDCE request
REQ-002 parent=REQ-001
  ↓
CSRE request
REQ-003 parent=REQ-001
  ↓
WRS request
REQ-004 parent=REQ-003
  ↓
Enrichment request
REQ-005 parent=REQ-003
  ↓
GPC request
REQ-006 parent=REQ-005
  ↓
Matching & Fanout request
REQ-007 parent=REQ-001
```

This allows a single API request to be traced end-to-end.

---

# 26. Observability Requirements

Every logical turn must be inspectable.

## 26.1 Required Trace Dimensions

```text
conversation
turn
run
component
request
prompt
model
schema
decision
latency
failure
retry
persisted record IDs
```

## 26.2 Decision Trace

For a vendor result, the trace should show:

```text
user request
→ intent
→ semantic object
→ GPC mapping
→ capability evidence
→ candidate vendor
→ feature scores
→ ranking
→ fanout decision
→ credit transaction reference
→ notification
→ vendor response
```

## 26.3 Reasoning Representation

The system should persist **decision summaries**, not private chain-of-thought.

Good:

```json
{
  "reason_codes": [
    "EXACT_MARKET_CONCEPT_MATCH",
    "STRONG_VENDOR_CAPABILITY",
    "LOCATION_ELIGIBLE"
  ]
}
```

Not required:

```text
full hidden model reasoning transcript
```

---

# 27. Live Test Mode — Primary Validation Strategy

This project deliberately prioritises **live system testing over written test suites**.

The most important validation mechanism is:

> **The AI implementation agent sends real requests through the system's API and observes what actually happened.**

## 27.1 Live Test Mode Architecture

```text
AI Test Operator
      │
      ▼
System API
      │
      ▼
Full production-like runtime
      │
      ├── MCOS
      ├── LangGraph
      ├── IDCE
      ├── CSRE
      ├── Enrichment
      ├── GPC
      ├── Capability Projection
      ├── Matching & Fanout
      ├── WRS
      └── Evidence System
      │
      ▼
Persistence + Trace
      │
      ▼
AI observes and evaluates
```

## 27.2 Live Test Requirements

For every live test, capture:

- request/response;
- status code;
- request IDs;
- turn ID;
- run ID;
- component decisions;
- schema validation results;
- database records created/updated;
- graph changes;
- vector records created/updated;
- evidence records;
- workflow transitions;
- wallet/credit effects where applicable;
- outbound notifications;
- final response;
- errors/retries;
- latency.

## 27.3 Live Test Modes

### Component Mode

Invoke one component directly.

Example:

```text
POST /v1/csre/resolve
```

Observe the semantic output and persistence.

### Pipeline Mode

Invoke one full semantic flow.

```text
CSRE
→ Enrichment
→ GPC
```

### Workflow Mode

Invoke complete business behavior.

```text
Buyer Search
→ Matching & Fanout
→ fanout
→ vendor notification
→ Evidence
```

### Recovery Mode

Deliberately fail or interrupt a component.

Verify:

```text
no data loss
no duplicate charge
no duplicate notification
restart resumes correctly
```

## 27.4 No Test Should Rely Only on the Final Response

A test passes only when both:

```text
user-facing behaviour
+
persisted internal state
```

are correct.

## 27.5 Example Live Test — Vendor Onboarding

Request:

```text
"Hi, I sell perfumes and body sprays around Warri"
```

Inspect:

```text
MCOS message persisted
→ logical turn created
→ IDCE SELL/OFFER
→ CSRE objects
→ Enrichment outputs
→ vendor capability projection
→ vendor profile state
→ location state
→ Evidence observations
→ graph edges
→ final response
```

Then send:

```text
"I also sell deodorants"
```

Verify the same vendor capability state evolves without replacing previous history.

## 27.6 Example Live Test — Buyer Search

```text
"I need black photoframes around Warri"
```

Verify:

```text
intent = FIND_PRODUCT / BUY
object = photoframes
attribute = black
location = Warri
matching candidates exist
vendor capability evidence exists
ranking is deterministic
fanout records exist
```

## 27.7 Example Live Test — Price Enquiry

```text
"How much is perfume?"
```

Verify:

```text
PRICE_INQUIRY
→ translated to vendor discovery
→ no invented price
→ vendors selected
→ user receives appropriate explanation
```

## 27.8 Example Live Test — Random

```text
"How far?"
```

Verify:

```text
one turn of natural engagement
→ steering question in same response
→ active workflow resumed if one exists
```

---

# 28. Live Test Inspection API

For efficient AI-driven implementation, expose a development-only trace inspection API.

Suggested:

```text
GET /dev/runs/{runId}
GET /dev/runs/{runId}/events
GET /dev/runs/{runId}/context
GET /dev/runs/{runId}/specialists
GET /dev/runs/{runId}/decisions
GET /dev/runs/{runId}/persistence
GET /dev/runs/{runId}/graph
GET /dev/runs/{runId}/vectors
GET /dev/runs/{runId}/evidence
GET /dev/conversations/{conversationId}/timeline
```

Example response:

```json
{
  "run_id": "turn:123",
  "status": "SUCCESS",
  "steps": [
    {
      "component": "IDCE",
      "status": "SUCCESS",
      "request_id": "REQ-2",
      "decision": {}
    },
    {
      "component": "CSRE",
      "status": "SUCCESS",
      "request_id": "REQ-3",
      "decision": {}
    }
  ]
}
```

This is a development/diagnostics surface, not a user-facing API.

---

# 29. Implementation Sequence

The implementation agent should build in this order.

## Phase 0 — Repository Foundation

Create:

```text
application
 domain
 ports
 adapters
 infrastructure
 prompts
 schemas
```

Add:

- configuration;
- structured logging;
- request correlation;
- error types;
- schema validation;
- database connection;
- Redis connection;
- graph adapter;
- vector adapter;
- object-store adapter;
- LLM provider abstraction.

## Phase 1 — Persistence Core

Build first:

- PostgreSQL schema;
- Prisma models;
- migration mechanism;
- conversation/message tables;
- turn tables;
- workflow tables;
- audit/event tables;
- idempotency tables;
- outbox/inbox tables;
- wallet/credit ledger.

Then prove restart safety.

## Phase 2 — MCOS Runtime

Implement:

- channel adapter;
- canonical message ingestion;
- persistence;
- dedupe;
- locks;
- logical turn assembly;
- outbound delivery;
- LangGraph checkpointer;
- trace APIs.

## Phase 3 — Prompt Runtime

Build the shared prompt runtime:

```text
PromptDefinition
PromptVersion
PromptExecutor
ProviderFailover
SchemaValidator
RepairPolicy
PromptTelemetry
```

No specialist should implement its own unrelated LLM client.

## Phase 4 — IDCE

Implement its current v1.4 request/response contracts and prompts.

Live-test:

- greeting;
- BUY;
- SELL;
- FIND_VENDOR;
- account;
- FAQ;
- random;
- price enquiry;
- multiple intents;
- corrections.

## Phase 5 — CSRE

Implement:

- CMEE;
- candidate generation;
- semantic resolution;
- commercial interpretation;
- WRS integration;
- clarification recommendation;
- semantic origin;
- output schema validation.

Live-test Nigerian informal expressions, multi-object expressions, venues and descriptions.

## Phase 6 — Enrichment

Implement semantic enrichment and embeddings.

Create:

- concept embeddings;
- taxonomy embeddings;
- functional embeddings;
- search terms;
- negative terms.

## Phase 7 — GPC Resolver

Load the versioned GPC dataset.

Build:

```text
GPC parser
GPC relational store
GPC pgvector index
candidate retrieval
hierarchy resolver
mapping persistence
```

Live-test known products, categories, services and unsupported/non-product objects.

## Phase 8 — WRS

Implement retrieval adapters and evidence packaging.

Then live-test:

- obscure term;
- Nigerian terminology;
- contradiction;
- low-quality source;
- current information;
- no reliable evidence.

## Phase 9 — Evidence System

Implement:

- observation store;
- evidence store;
- knowledge store;
- belief engine;
- graph updater;
- provenance;
- decay;
- contradiction handling.

## Phase 10 — Capability Projection

Build the new capability discovery pipeline.

Live-test onboarding statements and iterative capability updates.

## Phase 11 — Matching & Fanout

Build:

- demand representation;
- candidate retrieval;
- vector retrieval;
- graph traversal;
- deterministic scoring;
- vendor eligibility;
- ranking;
- fanout coordination.

## Phase 12 — Initial Workflows

Implement the nine requested workflow types:

```text
VendorOnboarding
BuyerSearch
FindVendor
FindVenue
Greeting
Account
FAQ
Random
PriceEnquiry
```

## Phase 13 — Full Live Validation

Run complete API-driven scenarios across the entire stack.

---

# 30. AI Implementation Agent Operating Protocol

This section is specifically for Fable/Astra-style implementation agents.

## 30.1 First Read Order

The agent must read:

```text
1. THIS OVERARCHING TDR
2. MCOS + LangGraph v4.2
3. IDCE v1.4
4. CSRE v5.2
5. Enrichment v4.2
6. WRS v4.2
7. Evidence System v4.2
8. GPC Resolver v4.2
```

Then inspect the repository before modifying code.

## 30.2 Do Not Invent Missing Requirements

When implementation details are unclear, the agent must identify the uncertainty rather than silently choosing a conflicting design.

## 30.3 Ask Questions When Necessary

The implementation agent **must ask the user a question before proceeding** when:

- two requirements materially contradict each other;
- a security or financial behaviour is undefined and implementation would create irreversible effects;
- an external dependency has multiple materially different interpretations;
- the requested behaviour cannot be implemented consistently with these TDRs;
- the user asks for a change that would invalidate an existing authoritative contract;
- there is missing information that materially affects architecture rather than code style.

The agent should not ask unnecessary questions merely because a minor implementation detail is unspecified.

## 30.4 Prefer Safe Defaults for Non-Architectural Details

For implementation details that do not alter the architecture, choose the simplest maintainable option and document the assumption.

## 30.5 Never "Fix" an Authoritative Component by Duplicating Its Responsibility

Example:

If Matching & Fanout cannot understand a buyer phrase, do not add a second semantic resolver into Matching & Fanout. Fix/invoke CSRE.

If GPC mapping is weak, do not make Matching & Fanout treat vector similarity as taxonomy truth.

If Capability Projection lacks capability evidence, do not let Matching & Fanout infer inventory with an LLM.

---

# 31. Repository-Level Dependency Rules

Recommended dependency direction:

```text
Presentation / Transport
        ↓
Application
        ↓
Domain
        ↓
Ports
        ↑
Adapters / Infrastructure
```

Within the semantic stack:

```text
MCOS → IDCE
MCOS → CSRE
CSRE → WRS
Enrichment → WRS
GPC → Enrichment
GPC → Evidence System read-side
Capability Projection → CSRE / Enrichment / Evidence / GPC
Matching & Fanout → Capability Projection read-side / GPC / Evidence / Vector / Graph
```

Avoid direct circular dependencies.

For example:

```text
Capability Projection → Matching & Fanout   ✓
Matching & Fanout → Capability Projection   ❌
```

because capability state is established by the capability projection module and consumed read-only by matching.

---

# 32. Data Model Overview

## 32.1 Core Relational Entities

```text
User
Account
Vendor
VendorProfile
Conversation
Message
LogicalTurn
TurnContextSnapshot
WorkflowDefinition
WorkflowInstance
WorkflowTransition
IntentResolution
SemanticResolution
EnrichmentResolution
GPCMapping
CapabilityAssertion
MatchingRequest
MatchingCandidate
FanoutDispatch
CreditLedgerEntry
EvidenceObservation
EvidenceRecord
KnowledgeRecord
BeliefRecord
OutboxEvent
InboxRecord
DeliveryAttempt
PromptExecution
ModelExecution
```

## 32.2 Identity Rules

Important IDs must be globally unique within the system:

```text
conversation_id
message_id
turn_id
run_id
request_id
observation_id
evidence_id
object_id
market_concept_id
capability_id
matching_request_id
fanout_id
```

Never use a mutable natural-language string as a durable primary identity.

---

# 33. Event Taxonomy

Events should be named as facts that happened.

Examples:

```text
MessageReceived
LogicalTurnCreated
IntentResolved
SemanticObjectResolved
EnrichmentCompleted
GPCMapped
EvidenceRetrieved
ObservationRecorded
CapabilityDiscovered
CapabilityBeliefUpdated
BuyerRequestCreated
MatchCandidatesComputed
VendorSelected
FanoutDispatched
VendorNotified
VendorResponded
CustomerDisclosureCompleted
CreditCharged
WorkflowStarted
WorkflowSuspended
WorkflowResumed
WorkflowCompleted
DeliveryQueued
DeliverySucceeded
DeliveryFailed
```

Commands should be imperative; events should be past-tense facts.

---

# 34. Versioning Strategy

Every contract must be versioned independently.

```text
component_version
schema_version
prompt_version
policy_version
gpc_dataset_version
embedding_model_version
```

A production record should be able to answer:

```text
Which component version produced this?
Which prompt?
Which model?
Which schema?
Which GPC dataset?
Which policy?
```

Never mutate historical decision meaning when upgrading models.

---

# 35. Model Provider Strategy

Use a shared LLM provider abstraction.

```typescript
interface LanguageModelPort {
  generateStructured<T>(input: StructuredPromptInput): Promise<StructuredModelResult<T>>;
}
```

The implementation must support:

- provider failover;
- timeouts;
- retry policy;
- schema-aware output;
- model selection by task;
- usage telemetry;
- circuit breaking;
- prompt versioning.

The specialist must not know which model vendor is behind the port.

---

# 36. Security and Trust Boundaries

Treat all external/user-provided values as untrusted.

Validate:

- user identity;
- role permissions;
- vendor ownership;
- account state;
- request IDs;
- object IDs;
- workflow instance ownership;
- wallet operations;
- tool parameters.

LLM-generated identifiers must never be trusted as database authorisation subjects without server-side verification.

---

# 37. Determinism Requirements

Any business side effect must be deterministic given:

```text
validated command
+
current durable state
+
explicit policy version
```

LLMs should not decide:

```text
"Should we charge the vendor?"
```

They may classify the user's request so the workflow knows that a chargeable action is appropriate.

The deterministic domain workflow performs the transaction.

---

# 38. Performance Strategy

Use three execution classes.

## Class A — Deterministic Fast Path

Examples:

```text
balance lookup
known account command
simple greeting
cached semantic resolution
```

Avoid unnecessary LLM calls.

## Class B — Structured AI Path

Examples:

```text
IDCE
CSRE
Enrichment
GPC adjudication
Capability Projection semantic interpretation
```

## Class C — External/Deep Path

Examples:

```text
WRS
large graph traversal
large vector retrieval
slow vendor fanout
```

The orchestrator must parallelize where safe.

---

# 39. Caching Strategy

Safe to cache:

- immutable GPC nodes;
- stable embeddings;
- known MarketConcept lookup;
- read-only taxonomy retrieval;
- frequently used terminology;
- vendor capability read models with TTL.

Do not rely on cache as the only source for:

- wallet balance;
- current credit availability;
- workflow state;
- authoritative vendor status;
- final evidence state.

---

# 40. Search Architecture

Search should be layered.

```text
exact structured lookup
       ↓
market concept lookup
       ↓
GPC retrieval
       ↓
vector retrieval
       ↓
graph traversal
       ↓
full candidate scoring
```

This is preferable to sending every request directly to an embedding search.

---

# 41. Context Architecture

Context is not one giant conversation string.

It consists of:

```text
1. raw conversation history
2. logical turns
3. active workflow state
4. current objectives
5. semantic references
6. user/account context
7. vendor context
8. location context
9. relationship/reference state
10. durable learned knowledge
```

LangGraph gets a bounded projection.

The complete state remains recoverable from durable storage.

---

# 42. Example Complete Request Trace

User:

```text
"Abeg I need black photoframes around Warri"
```

## Step 1 — MCOS

```text
message persisted
turn assembled
```

## Step 2 — IDCE

```text
intent: BUY / FIND_PRODUCT
confidence: high
```

## Step 3 — CSRE

```text
object:
  phrase = "photoframes"
  concept = photo frame

attribute:
  color = black

location:
  Warri
```

## Step 4 — Enrichment

```text
functional/category/search representations
```

## Step 5 — GPC

```text
map if a useful GPC classification is available
```

## Step 6 — Matching & Fanout

```text
retrieve candidate vendors
filter inactive/stale/contradicted vendors
score
rank
```

## Step 7 — Fanout

```text
strongest eligible vendors first
persist distribution decisions
notify vendor according to policy
```

## Step 8 — Evidence

```text
buyer request observation
match observation
vendor response later
```

## Step 9 — Response

```text
"I found a few vendors around Warri who can help with photoframes. ..."
```

Everything above is persisted and traceable.

---

# 43. Example Multi-Intent Request

User:

```text
"Yes I sell perfumes. Also where can I get photoframes in Warri and how much are they?"
```

The system should form:

```text
A1 CONTINUE_VENDOR_ONBOARDING
    object=perfumes

A2 FIND_PRODUCT
    object=photoframes
    location=Warri

A3 PRICE_INQUIRY
    object=photoframes
    relationship=SUPPORTED_BY / REDIRECTED_TO A2
```

Execution:

```text
A1 → Capability Projection/onboarding
A2 → Enrichment/GPC/Matching & Fanout
A3 → redirect to vendor discovery
```

Do not let the price enquiry block onboarding or product search.

---

# 44. What the System Should NOT Do

Do not implement:

```text
one mega-agent that owns everything
```

Do not implement:

```text
raw message → embedding → nearest vendor
```

Do not implement:

```text
GPC nearest node → assume vendor capability
```

Do not implement:

```text
conversation transcript → single giant prompt → database mutations
```

Do not implement:

```text
Redis as source of truth
```

Do not implement:

```text
LangGraph checkpoint as business database
```

Do not implement:

```text
LLM-generated wallet changes without deterministic verification
```

Do not make a dedicated pricing database before the product supports real price discovery.

---

# 45. Definition of Implementation Complete

The system is considered implementation-complete for the initial scope when an AI operator can submit live API requests and verify the following without reading source code to infer hidden state:

## Conversation

- messages persist;
- turns assemble correctly;
- context survives restart;
- corrections/switches work;
- outbound delivery is durable.

## Intent

- single and multiple intents work;
- scopes and dependencies survive;
- clarification is bounded.

## Semantic Resolution

- informal Nigerian language resolves;
- multi-object expressions work;
- venue/product/service distinctions work;
- semantic origin survives downstream.

## Taxonomy

- GPC candidates retrieve correctly;
- strongest defensible mapping wins;
- non-applicable objects remain non-applicable;
- official dataset remains immutable.

## Capability Discovery

- vendor onboarding creates capability assertions;
- later messages refine capabilities;
- negative evidence is recorded;
- capability confidence is traceable.

## Matching

- buyer requests retrieve vendors;
- structured + vector + graph signals work together;
- ranking is explainable;
- stale/contradicted vendors can be excluded.

## Evidence

- observations persist;
- WRS evidence is traceable;
- beliefs evolve;
- graph decisions are auditable.

## Reliability

- duplicate messages do not duplicate actions;
- retries do not double-charge;
- process restarts recover work;
- all important state is durable.

---

# 46. Final Architecture Contract

The complete platform should always be explainable as:

```text
USER
 ↓
CHANNEL
 ↓
MCOS
 ↓
LOGICAL TURN
 ↓
LANGGRAPH
 ↓
┌─────────────────────────────┐
│ IDCE = INTENT               │
│ CSRE = REFERENT             │
└─────────────┬───────────────┘
              ↓
      INTENT / ACTION GRAPH
              ↓
┌─────────────────────────────┐
│ ENRICHMENT = SEMANTICS      │
│ GPC = TAXONOMY              │
│ CAPABILITY = PROJECTION     │
│ MATCHING = FANOUT            │
└─────────────┬───────────────┘
              ↓
       DETERMINISTIC WORKFLOW
              ↓
       DOMAIN CAPABILITY APIs
              ↓
        OBSERVATIONS
              ↓
      EVIDENCE SYSTEM
              ↓
    GRAPH + BELIEF + INDEXES
              ↓
       FUTURE REQUESTS
```

This is a closed learning system:

```text
language
 → interpretation
 → action
 → interaction
 → evidence
 → belief
 → improved future interpretation/matching
```

But each stage remains independently accountable.

---

# 47. Final Implementation Directive

The implementation agent must build the system **from the contracts outward**, not from UI screens inward.

Required order:

```text
contracts
→ persistence
→ adapters
→ prompt runtime
→ specialist engines
→ orchestration
→ workflows
→ live tests
→ optimisation
```

Every new feature must answer:

```text
Who owns this decision?
What is the input contract?
What is the output contract?
Where is it persisted?
How is it correlated?
What happens when it fails?
How can a live API test inspect it?
```

If those questions cannot be answered, the feature is not ready for implementation.

---

# Appendix A — Component Contract Registry

| Component | Owns | Inputs | Outputs | Durable Store |
|---|---|---|---|---|
| MCOS | channels, turns, locks, delivery | provider events | logical turns / delivery results | PostgreSQL |
| LangGraph | orchestration | logical turn + context | plan / execution / response plan | checkpoint + PostgreSQL |
| IDCE | intent | logical turn + context | intent graph | PostgreSQL |
| CSRE | semantic resolution | logical turn | semantic objects | PostgreSQL |
| Enrichment | semantic expansion | CSRE | enriched objects | PostgreSQL + pgvector |
| WRS | external evidence | evidence request | evidence package | evidence references |
| Evidence System | evidence/knowledge/belief | observations | beliefs/graph changes | PostgreSQL + Neo4j |
| GPC Resolver | taxonomy mapping | CSRE + Enrichment | GPC mappings | PostgreSQL + pgvector |
| Capability Projection | capability representation | vendor semantic/evidence inputs | capability assertions | PostgreSQL + Neo4j + pgvector |
| Matching & Fanout | matching/ranking | buyer demand + capability index | ranked candidates/fanout decisions | PostgreSQL |

---

# Appendix B — Minimal Initial Technology Stack

```text
Runtime:
  Node.js + TypeScript

API:
  Fastify or Express

ORM:
  Prisma

Transactional DB:
  PostgreSQL

Vector:
  pgvector

Graph:
  Neo4j

Cache/coordination:
  Redis

Graph orchestration:
  LangGraph

Object storage:
  S3-compatible storage

LLM:
  shared provider adapter with failover

Validation:
  JSON Schema + runtime TypeScript validation

Observability:
  structured logs + traces + persisted run inspection
```

The exact framework choices may be swapped only behind ports/adapters unless a source TDR explicitly requires a particular technology.

---

# Appendix C — AI Agent First Questions

Before implementing any non-trivial subsystem, an AI agent should be able to state:

```text
1. Which TDR governs this behaviour?
2. Which component owns the decision?
3. What contract crosses the boundary?
4. What persistence record proves it happened?
5. What correlation ID connects it to the original turn?
6. What deterministic workflow performs the side effect?
7. How will I live-test the behaviour through the API?
```

When the answer to any architectural question is ambiguous or contradictory with the TDR set, **ask the user before proceeding**.

---

# Appendix D — Source-of-Truth Principle

The platform has several kinds of truth and they must remain distinct:

```text
User truth
  = what the user actually said

Semantic interpretation
  = CSRE's resolved meaning for that turn

Taxonomy truth
  = sovereign GPC dataset

Evidence truth
  = durable observations and evidence records

Market knowledge
  = evidence-backed beliefs and relationships

Vendor capability belief
  = current evidence-backed estimate

Operational truth
  = deterministic workflow/domain state

Retrieval index
  = vector/graph/search projection

Orchestration state
  = LangGraph checkpoint
```

Never use one category as a substitute for another.

---

# Appendix E — Final Rule

> **Build the system so that every important answer can be traced backward to the user input, the component responsible for interpreting it, the evidence available at that time, the policy/model/schema version used, the deterministic action taken, and the durable state that resulted.**

That is the foundation for a production conversational marketplace that can operate reliably in the messy, informal Nigerian market while continuously learning from real interactions.

---

# 48. NORMATIVE AGENDA COMPLETION — v1.2

**Effective:** 2026-09-10  
**Status:** Authoritative amendment to the master blueprint.

## 48.1 Expanded authoritative component set

The implementation specification now includes **eight authoritative component TDRs** plus the implementation directive:

| Component | Version | Authority |
|---|---:|---|
| MCOS + LangGraph | 4.4 | Conversation runtime + orchestration |
| IDCE | 1.6 | Intent discovery/classification |
| CSRE | 5.4 | Semantic referent resolution |
| Semantic Enrichment | 4.4 | Semantic/search/taxonomy-oriented enrichment |
| GPC Resolver | 4.4 | Sovereign GPC classification |
| WRS | 4.4 | External evidence acquisition |
| Evidence System | 4.4 | Evidence, belief, learning, graph change decisions |
| Market Knowledge Graph | 1.1 | RDF/SKOS graph state + commercial relationships + graph queries |

Capability Projection and Matching & Fanout remain application/module capabilities, not additional top-level AI engines.

## 48.2 Final authority matrix

| Decision | Authority |
|---|---|
| Logical turn | MCOS |
| User intent | IDCE |
| Referent / MarketConcept | CSRE |
| Semantic expansion | Enrichment |
| Sovereign classification | GPC Resolver |
| External retrieval | WRS |
| Evidence/Belief | Evidence System |
| Graph state / commercial relationships | MKG |
| Vendor capability projection | Capability Projection |
| Vendor matching/fanout | Matching & Fanout |
| Workflow execution | deterministic workflow layer |
| Orchestration | LangGraph |

No component may become a second authority for one of these decisions.

## 48.3 Final semantic/learning graph

```text
Raw language
   ↓
CSRE → MarketConcept
   ↓
Enrichment
   ↓
GPC Resolver → sovereign GPC mapping
   ↓
MKG ← approved graph decisions ← Evidence ← observations/evidence
   ↓
Capability Projection / Matching & Fanout
```

MKG is now explicitly standalone.

## 48.4 Version and implementation registry

The deployment registry must pin the eight component versions, prompt/schema versions, GPC dataset version, graph schema version, and relevant policy/model versions. Existing versioned contracts remain valid unless explicitly superseded by the component's new TDR revision.



# 49. NORMATIVE AGENDA COMPLETION — v1.3 FINAL SYSTEM CONTRACT + RUNTIME HARDENING

**Effective:** 2026-09-12  
**Status:** Authoritative amendment to the master blueprint.

## 49.1 Final implementation package registry

| Component | Version | Wire / schema | Ownership |
|---|---:|---:|---|
| MCOS + LangGraph | 4.4 | internal 1.0 | orchestration |
| IDCE | 1.6 | output 1.0 / envelope 1.1 | intent |
| CSRE | 5.4 | response 5.0 / request 5.1 | semantic referent |
| Semantic Enrichment | 4.4 | response 4.0 / request 4.1 | semantic enrichment |
| GPC Resolver | 4.4 | request/response 4.0 | GPC classification |
| WRS | 4.4 | request/response 4.0 | external evidence acquisition |
| Evidence System | 4.4 | request/response 4.0 | evidence/belief/graph decisions |
| MKG | 1.1 | graph schema 1.0 | graph state / commercial relationships |
| Overarching Blueprint | 1.3 | n/a | system composition |
| Implementation Directive | 1.2 | n/a | execution governance |

## 49.2 Authoritative dependency graph

```text
MCOS + LangGraph
   ├── IDCE
   ├── CSRE
   │    ↓
   ├── Enrichment ←── MKG read context
   │    ↓
   ├── GPC Resolver ←── MKG read context (optional)
   ├── WRS
   ├── Evidence
   │     ↓ GraphChangeDecision
   └── MKG
          ↓
Capability Projection / Matching & Fanout
```

The knowledge path is deliberately cyclic in reads but controlled in writes:

```text
acyclic writes + cyclic knowledge reads
```

## 49.3 MarketConcept-first discovery

The platform MUST support commercial discovery from MarketConcept/enrichment context without requiring GPC mapping when GPC is not required by the workflow.

This protects local-market semantic nuance from being collapsed into taxonomy labels and makes GPC an auxiliary sovereign classification representation rather than a universal discovery gate.

## 49.4 Cross-store consistency

Each datastore has one logical source-of-truth role:

```text
PostgreSQL = transactional application/domain truth
Redis      = cache/locks/transient coordination
pgvector   = vector retrieval index
MKG store  = durable graph relationship truth
Object store = media/large artifacts
```

Cross-store propagation MUST use idempotent events/outbox or equivalent asynchronous projection patterns. Distributed 2PC across the full platform is NOT required.

The presence of multiple stores does not imply multiple authorities for the same fact.

## 49.5 Market-language flywheel

```text
local speech / text / audio transcript
        ↓
CSRE semantic observation
        ↓
Evidence + independence analysis
        ↓
MKG lexical-commercial knowledge
        ↓
CSRE / Enrichment read context
        ↓
better future resolution and matching
```

The platform MUST preserve provenance, locality, time, uncertainty, and alternative interpretations for learned market language.

## 49.6 Self-learning safety

No learning loop may promote a claim merely because the system predicted the same claim multiple times. Independent observations or explicit confirmation policy are required for strong promotion.

Graph priors remain hypotheses and cannot become direct inventory truth.

## 49.7 Performance policy

Latency and accuracy tradeoffs MUST be evaluated through Live Test Mode. No fixed architectural claim such as a universal number of LLM hops, seconds of latency, or compounded error rate is authoritative unless measured in the deployed configuration.

## 49.8 Final contract registry requirement

The Overarching TDR is the single place that declares the package-wide component versions and wire/schema versions. Component TDRs remain authoritative for their internal contracts. Any code generation agent MUST fail the implementation preflight when these registry values and the selected component TDR contracts disagree.
