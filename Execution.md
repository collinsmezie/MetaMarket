# MetaMarket Execution & Implementation Guidelines

This document serves as the master engineering directive for building the **MetaMarket Multi-Channel Conversation Platform** from the Technical Design Records (TDRs) and workflow specifications located in `docs/design
/`.

---

## 1. Core Stack & Technical Tooling

The platform MUST be built using the following production-grade tech stack:

* **Framework:** NestJS (Node.js / TypeScript) — enforces modularity, dependency injection, and clean architecture.
* **Database & ORM:** PostgreSQL + Prisma (or TypeORM) for structured persistence of conversations, workflows, and evidence records.
* **In-Memory Cache & Locking:** Redis (ioredis) for distributed conversation locking, rate limiting, and session caching.
* **Queue & Async Job Processing:** BullMQ (powered by Redis) for heavy background tasks (Speech-To-Text, OCR, Media Download, Async Event Fan-Out).
* **Vector & Semantic Store:** Pgvector (or Qdrant) for storing semantic fingerprints, mission embeddings, and capability graphs.
* **Taxonomy Repository:** GS1 GPC (Global Product Classification) Static Dataset (`data/gs1_gpc.json`) — a downloaded taxonomy file embedded into Pgvector / Vector DB via a seed script (`npm run seed:taxonomy`). Serves as the universal commercial dictionary for semantic vector lookups on both supply side (Vendor DNA profiling) and demand side (Semantic Resolution & Vendor Candidate Retrieval).
* **AI Orchestration & LLM:** Multi-provider LLM Architecture with automatic fallback to prevent service disruption. Primary: OpenAI SDK (Structured Outputs / Tool Calling); Fallbacks: Google Gemini SDK & Anthropic Claude SDK (via Vercel AI SDK or an internal `LlmProviderService` with circuit-breaker retries and uniform Zod/JSON schema enforcement).
* **Event Bus:** NestJS EventEmitter / Redis PubSub (or RabbitMQ) for asynchronous decoupled event handling (`request.accepted`, `match.completed`).
* **Testing:** Jest for Unit & Integration tests, Supertest for API endpoint testing.

---

## 2. Mandatory Clean Code Design Principles

All code contributions MUST strictly adhere to these principles.

> These are the constitution. [`CONTRIBUTING.md`](CONTRIBUTING.md) expands them into applicable,
> reviewable rules — each one traced to a defect that reached the running platform — plus the
> quality gate and the pre-merge checklist. Cite it from code comments as `CONTRIBUTING §N.N`.

1. **Strict Separation of Concerns (Hexagonal / Clean Architecture):**
   * **Adapters (`src/adapters/`):** Translate provider payloads (WhatsApp, SMS, Voice) to `Canonical Message` models. *Never put business logic or AI calls inside adapters.*
   * **Domain Core (`src/domain/`):** Business rules and workflow state machines only. *Never couple domain logic to messaging channels or HTTP controllers.*
   * **AI Services (`src/ai/`):** Handle extraction, intent detection, and normalization. *AI assists workflows; AI NEVER directly controls workflow execution.*

2. **Deterministic Workflow Execution:**
   * Business processes run as deterministic finite-state machines. LLMs provide extracted structured data, but the `Workflow Engine` makes all state transition decisions.

3. **Information Before Questions:**
   * Every workflow MUST extract maximal information from existing conversation context before asking the user any questions. Never prompt for information already provided.

4. **Multi-Provider LLM Resilience:**
   * AI components MUST interface through a unified `LlmProviderService` abstraction rather than calling OpenAI directly. If OpenAI experiences rate limits, timeouts, or downtime, the system MUST automatically fail over to **Google Gemini** or **Anthropic Claude** while maintaining strict JSON schema guarantees.

5. **Robust Error Handling & Graceful Degradation:**
   * **No Silent Failures / No Generic Loops:** If all LLM providers fail or JSON extraction fails, the orchestrator MUST NOT fail silently or enter generic `"Hi there!"` loops. It MUST return a centralized `FALLBACK_ENVELOPE` response guiding the user smoothly.
   * **Webhook Protection:** Channel Adapters MUST catch provider payload errors and always return HTTP `200 OK` to webhook providers (Meta, Twilio) to prevent provider retry storms, logging errors asynchronously.
   * **Workflow Dead-Letter & Expiration:** Unhandled exceptions during workflow execution MUST safely transition the active workflow to `Suspended` or `Failed` state with an audit log, avoiding hung session state.
   * **Exponential Backoff:** External API calls (Whisper STT, OCR, LLM inference) MUST implement exponential backoff retries (max 3 attempts) before triggering fallback.

6. **Event-Driven Decoupling:**
   * Platform services (MCOS, CME, CDE) communicate asynchronously via domain events rather than direct tight coupling.

7. **SOLID Principles & Clean Code Hygiene:**
   * Single Responsibility per class/module.
   * Explicit TypeScript types and DTO validations (`class-validator`, `zod`). No `any` types.

---

## 3. Terminal Logging Requirements

To maintain complete observability during development, testing, and execution, **every component stage MUST log structured, human-readable terminal output** demonstrating the inputs, transformations, and outputs.

### Standard Log Format:
```text
[<TIMESTAMP>] [<COMPONENT_NAME>] [<STAGE_NAME>]
Input  : <Formatted JSON / Data>
Action : <Brief description of logic/transformation>
Output : <Formatted JSON / Data>
```

### Example Stage Log:
```text
[2026-08-06T10:15:00.123Z] [MCOS] [MediaProcessingService]
Input  : { "type": "audio", "mediaId": "media_456", "channel": "whatsapp" }
Action : Executing Speech-To-Text via Whisper API...
Output : { "text": "I need artist brush", "confidence": 0.98 }

[2026-08-06T10:15:00.456Z] [CME] [DemandUnderstandingStage]
Input  : { "rawMessage": "I need artist brush" }
Action : Extracted intent [buyer_product_search] and item [artist brush]
Output : { "products": ["artist brush"], "ambiguity": "Low" }
```

---

## 4. Testing Requirements

Every component must be validated through automated test coverage before being marked complete:

1. **Unit Tests (`*.spec.ts`):**
   * Coverage required for all state transitions, adapters, scoring engines, and evidence aggregators.
   * Mock external APIs (WhatsApp Webhook, OpenAI API, Speech-To-Text).

2. **Integration Tests (`*.test.ts`):**
   * Test complete end-to-end multi-turn flows (e.g., Buyer Search flow from incoming WhatsApp payload to vendor profile delivery).
   * Verify state persistence in PostgreSQL and locking in Redis.

3. **Contract Verification:**
   * Validate that all published events conform to the `Standard Marketplace Event Model`.

---

## 5. Phased Implementation Strategy (Foundation First)

Features MUST be implemented sequentially in order of foundational priority. Each phase must be fully tested and verified before moving to the next.

```text
┌────────────────────────────────────────────────────────┐
│ PHASE 1: Platform Core Foundation                     │
│ (MCOS + Channel Adapter + Canonical Models + Postgres) │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ PHASE 2: Seller Intelligence & Onboarding             │
│ (Vendor Onboarding Workflow + Initial CDE + DNA Store) │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ PHASE 3: Marketplace Memory Backbone                   │
│ (Event Bus + Evidence Service + Event Raw Store)       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ PHASE 4: Demand Matching & Vendor Ranking              │
│ (CME 15-Stage Retrieval Pipeline + Ambiguity Manager) │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ PHASE 5: Advanced Marketplace Learning & Fan-out      │
│ (Async Fan-out + CLAD Engine + Behavioral Learning)    │
└────────────────────────────────────────────────────────┘
```

### Phase Breakdown:

#### **Phase 1: Multi-Channel Conversation OS (Platform Core Foundation)**
* **Goal:** Build the central orchestration environment.
* **Deliverables:**
  * Canonical Message & Response interfaces.
  * WhatsApp Channel Adapter (normalize Meta webhook to Canonical Message).
  * `Conversation Context Manager` with PostgreSQL + Redis persistence.
  * Basic `Workflow Manager` and deterministic `Workflow Engine`.
  * Terminal logging middleware for all pipeline stages.

#### **Phase 2: Vendor Onboarding & Capability Discovery (Supply-Side)**
* **Goal:** Allow vendors to onboard and generate their initial profile.
* **Deliverables:**
  * `Vendor Onboarding Workflow` (Max 1 clarification rule, location parsing, business name collection).
  * `Capability Discovery Engine (CDE)` seed logic — generate initial `Capability DNA` and capability graph.
  * Persistence layer for Vendor Profiles and capability confidence scores.

#### **Phase 3: Evidence Service & Event Bus (Marketplace Memory)**
* **Goal:** Establish the shared learning backbone.
* **Deliverables:**
  * Event Bus architecture (`EventEmitter` / Redis PubSub).
  * Raw Event Store persistence (immutable event history).
  * `Evidence Processor` & `Evidence Aggregator` to process vendor response events (`request.accepted`, `request.rejected`, `request.timeout`).
  * Internal APIs for querying vendor evidence scores.

#### **Phase 4: Capability Matching Engine (Demand-Side Retrieval & Ranking)**
* **Goal:** Connect buyer search requests to the best vendors.
* **Deliverables:**
  * CME 15-stage pipeline implementation.
  * Search Mode Classifier (Item, Descriptive, Business, Vibe search modes).
  * `Ambiguity Manager` with clarification request triggers.
  * Semantic Expansion (Mission Graph, Capability Graph, Inventory Affinity).
  * GS1 GPC Mapping Engine & Taxonomy Resolution (maps canonical capabilities to GS1 bricks/classes).
  * Candidate Retrieval & Ranking Engine combining `Capability Match Score + Evidence Score`.

#### **Phase 5: Marketplace Fan-Out & Continuous Learning**
* **Goal:** Enable asynchronous request distribution and continuous feedback loops.
* **Deliverables:**
  * Demand-driven fulfillment model (Immediate top-vendor delivery + Async fan-out to remaining vendors).
  * Post-interaction feedback collection (conversational micro-polling).
  * Cognitive Load-Aware Discovery (CLAD) adaptation.