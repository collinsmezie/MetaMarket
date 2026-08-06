# ADR-001: Hexagonal Architecture (Ports & Adapters) for Multi-Channel Isolation

* **Status:** Accepted
* **Date:** 2026-08-06
* **Deciders:** Core Architecture Team
* **Technical Constraints:** Multi-channel support (WhatsApp, SMS, Voice, USSD), LLM multi-provider resiliency (OpenAI, Gemini, Claude), Channel-agnostic business logic.

---

## 1. Context & Problem Statement

The MetaMarket platform must orchestrate complex business workflows (Customer Search, Vendor Onboarding, Escalations) across multiple communication channels (WhatsApp, SMS, Voice, USSD) while leveraging multiple AI providers for intent resolution and capability extraction.

Without a strict architectural boundary:
1. Provider-specific payload structures (e.g., Meta WhatsApp Webhooks) leak into core business logic.
2. Adding a new channel (e.g., Telegram or USSD) requires rewriting workflow controllers.
3. Swapping or falling back between LLMs (OpenAI $\rightarrow$ Gemini $\rightarrow$ Claude) introduces tight coupling and fragile error handling across services.

---

## 2. Decision

We will adopt **Hexagonal Architecture (Ports and Adapters)** as the primary architectural pattern for the MetaMarket codebase.

The application is structured into three distinct layers:

```text
               EXTERNAL DRIVERS                                  INSIDE THE CORE                                 EXTERNAL SERVICES
          (Channels & Webhook Trigger)                       (Pure Business Logic)                          (Storage, LLMs, Messaging)

    ┌────────────────────────────────────┐             ┌────────────────────────────────┐             ┌───────────────────────────────────┐
    │ WhatsApp / SMS / Voice / Telegram  │             │   Domain Core                  │             │ PostgreSQL / Redis / Pgvector     │
    └─────────────────┬──────────────────┘             │   - Workflow Engine            │             └─────────────────▲─────────────────┘
                      │                                │   - Capability Matching Engine │                               │
                      ▼                                │   - Conversation Context       │                               │
            ┌──────────────────┐                       └────────────────────────────────┘                     ┌──────────────────┐
            │ Incoming Adapter │                                       ▲                                      │ Outgoing Adapter │
            └─────────┬────────┘                                       │                                      └─────────▲────────┘
                      │                                                │                                                │
                      ▼                                                │                                                │
            ┌──────────────────┐                               ┌───────┴──────┐                               ┌─────────┴────────┐
            │  INCOMING PORT   ├──────────────────────────────►│ DOMAIN MODEL ├──────────────────────────────►│  OUTGOING PORT   │
            │ (Driver Interface)│                              └──────────────┘                               │(Driven Interface)│
            └──────────────────┘                                                                              └──────────────────┘
                                                                                                                        ▲
                                                                                                                        │
                                                                                                              ┌─────────┴────────┐
                                                                                                              │ OpenAI / Gemini  │
                                                                                                              └──────────────────┘
```

### Layer Responsibilities:

1. **Domain Core (The Hexagon Center):**
   * Contains pure business logic, state machines (`Workflow Engine`), intent matching rules (`CME`), and aggregate roots (`Conversation Context`).
   * **Strict Constraint:** The core possesses ZERO dependencies on external frameworks, HTTP modules, database drivers, or messaging channel SDKs. It operates solely on canonical TypeScript models (`IncomingMessage`, `CanonicalResponse`, `VendorDNA`).

2. **Ports (Interfaces):**
   * **Driver Ports (Primary/Inbound):** Define how external triggers invoke application use cases (e.g., `ReceiveMessageUseCasePort`).
   * **Driven Ports (Secondary/Outbound):** Define contracts for external dependencies required by the core (e.g., `LlmProviderPort`, `ConversationRepositoryPort`, `ChannelNotifierPort`).

3. **Adapters (Outer Layer):**
   * **Inbound Adapters:** Normalize channel-specific webhooks into domain models.
     * *Example:* `WhatsAppChannelAdapter` parses Meta webhooks $\rightarrow$ maps to `CanonicalMessage` $\rightarrow$ calls `ReceiveMessageUseCasePort`.
   * **Outbound Adapters:** Implement infrastructure drivers.
     * *Example:* `OpenAiLlmAdapter` and `GeminiLlmAdapter` implement `LlmProviderPort`.
     * *Example:* `PrismaConversationRepository` implements `ConversationRepositoryPort`.

---

## 3. Key Benefits & Consequences

### Positive Consequences
* **Channel Agnostic:** Adding a new channel (e.g., Telegram) requires writing only a new `TelegramAdapter`. Zero changes are made to core business workflows.
* **LLM Resilience & Fallback:** The `LlmProviderService` can fail over from OpenAI to Gemini or Claude seamlessly behind the `LlmProviderPort` interface.
* **Testability:** Core domain rules and state transitions can be tested in 100% isolation using mock adapters without real network requests or API costs.
* **Database Flexibility:** Persistence strategies (e.g., switching from PostgreSQL to Redis caching) are isolated within repository adapters.

### Negative Consequences
* **Slight Structural Overhead:** Requires creating interface files (Ports) and translation mappings (Adapters) rather than writing direct inline logic.
* **DTO Mapping Overhead:** Requires mapping incoming webhook payloads to Canonical models and Canonical models to outgoing provider payloads.

---

## 4. Compliance & Code Conventions

All engineers must adhere to the following directory convention in `src/`:

```text
src/
├── domain/                  # PURE BUSINESS LOGIC (No external dependencies)
│   ├── models/              # Canonical models (IncomingMessage, VendorDNA)
│   ├── workflows/           # State machines & business rules
│   └── ports/               # TypeScript Interfaces (Inbound & Outbound)
│       ├── inbound/         # e.g., HandleIncomingMessage.port.ts
│       └── outbound/        # e.g., LlmProvider.port.ts, Repository.port.ts
├── adapters/                # EXTERNAL IMPLEMENTATIONS
│   ├── inbound/             # Channel webhooks & controllers
│   │   ├── whatsapp/        # WhatsAppAdapter.ts
│   │   └── sms/             # SmsAdapter.ts
│   └── outbound/            # External services & persistence
│       ├── llm/             # OpenAiAdapter.ts, GeminiAdapter.ts
│       └── persistence/     # PostgresRepository.ts, RedisCache.ts
└── config/                  # Framework & DI wiring (NestJS Modules)
```
