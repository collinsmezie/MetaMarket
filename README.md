# MetaMarket

A Multi-Channel Conversation Operating System for informal markets — buyers and sellers
transact over WhatsApp, SMS and voice, and the platform learns what each vendor can actually
supply from the conversations themselves.

Built from the Technical Design Records in [`docs/design/`](docs/design) under the engineering
directives in [`Execution.md`](Execution.md).

> **The platform is not a chatbot. It is a Conversation Operating System.** — MCOS TDR §25

---

## Status

All five phases are implemented. See [`docs/PHASE-1-REPORT.md`](docs/PHASE-1-REPORT.md),
[`docs/PHASE-2-REPORT.md`](docs/PHASE-2-REPORT.md) and
[`docs/PHASE-3-4-5-REPORT.md`](docs/PHASE-3-4-5-REPORT.md) for exactly what is built, what is
verified, and what is deliberately deferred.

| Phase | Scope | Status |
|---|---|---|
| 1 | Conversation OS core: adapters, context, workflow engine, media, events | **Implemented**, pending live-WhatsApp gate |
| 2 | Vendor onboarding + Capability Discovery Engine | **Implemented**, verified against the docs' own test cases |
| 3 | Evidence Service + event bus consumers | **Implemented** — raw event store, processor, aggregator, internal API |
| 4 | Capability Matching Engine | **Implemented** — search modes, ambiguity, expansion, retrieval, explainable ranking |
| 5 | Fan-out + continuous learning | **Implemented** — immediate delivery, billing, fan-out, visibility rules, timeout sweep |
| — | [Konnet Credits Recharge](docs/design/Konnet-Credits-Recharge-TDR.md) | **Implemented** — dedicated virtual accounts, exactly-once crediting, WhatsApp confirmation |

---

## Quick start

```bash
# 1. Dependencies (Postgres+pgvector, Redis, MinIO)
npm install
npm run infra:up

# 2. Configuration
cp .env.example .env         # then fill in OPENAI_API_KEY and the WhatsApp block

# 3. Database
npx prisma migrate deploy
npx prisma generate

# 4. Run
npm run start:dev
curl localhost:3000/health
```

### Database & GUI access

- **Postgres (pgvector):** `localhost:5434`
  - **Database / User / Password:** `metamarket` / `metamarket` / `metamarket`
  - *(Port `5434` avoids colliding with host system Postgres on `5432`)*
- **Prisma Studio GUI:** `npx prisma studio` *(opens at http://localhost:5555)*


### Exercising the pipeline without WhatsApp

```bash
npm run build
node dist/cli/send-test-webhook.js "I need artist brush"
node dist/cli/send-test-webhook.js --voice media_456
```

The reply is delivered asynchronously; the server terminal shows the stage log for every
pipeline stage (Execution.md §3 format).

### Inspecting the Capability Discovery Engine

```bash
node dist/cli/capability-probe.js "I sell household items"   # real model, no writes
node dist/cli/capability-probe.js "I repair generators"
```

### Credits recharge

```bash
node dist/cli/send-test-webhook.js "Recharge"                     # provision + show account
npm run webhook:payment -- --account <number> --naira 5000        # simulate a bank transfer
```

Both sign their payloads exactly as Meta and Paystack do, so verification is exercised rather
than bypassed. Re-run the payment with the same `--reference` to prove exactly-once crediting.

### GS1 GPC taxonomy

```bash
node dist/cli/seed-taxonomy.js --dry-run     # inspect the file, write nothing
npm run seed:taxonomy                         # import + embed to Brick level
node dist/cli/taxonomy-search.js "hammer"     # inspect retrieval quality
```

---

## Architecture

Hexagonal (ports and adapters), per [ADR-001](docs/architecture/ADR-001-Hexagonal-Architecture.md).

**Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md)** — the engineering standards every
change must meet, and the pre-merge checklist.

```
src/
├── domain/                  PURE business logic — no framework, driver or SDK imports
│   ├── models/              Canonical models (IncomingMessage, Response, Conversation…)
│   ├── workflows/           State machines, workflow manager, discovery, policy
│   └── ports/
│       ├── inbound/         HandleIncomingMessage
│       └── outbound/        Llm, Embedding, Repositories, Channel, Lock, Media, Events
├── application/             Use cases orchestrating domain + ports
│   ├── conversation/        Conversation Context Manager
│   ├── understanding/       Continuity → Intent → Semantic resolution
│   ├── media/               Media processing
│   ├── taxonomy/            GS1 GPC import + embedding
│   ├── evidence/            Evidence processor, aggregator, internal query API
│   ├── matching/            Capability Matching Engine
│   ├── fulfilment/          Request distribution and fan-out
│   ├── wallet/              Credits: provisioning, crediting, confirmation
│   ├── pipeline/            Message ingestion, turn processing
│   └── response/            Response composition
├── adapters/
│   ├── inbound/             WhatsApp webhook, health
│   └── outbound/            OpenAI/Gemini/Anthropic, Prisma, Redis, S3, BullMQ, Graph API
├── config/                  Nest modules — the only place ports meet adapters
└── shared/                  Stage logger
```

The boundary is **enforced, not just documented**: `.eslintrc.js` fails the build if anything
under `src/domain/` imports a framework, driver, SDK or adapter.

### The pipeline

```
WhatsApp webhook
   → signature verification            (always 200 to Meta; reject only unsigned)
   → canonical message mapping
   → deduplicate + persist
   → [media? enqueue → Whisper/OCR → resume]
   → acquire conversation lock          (Redis, fencing token)
   → load conversation + registry + memory
   → continuity analysis                (deterministic when possible, else LLM)
   → intent resolution                  } skipped when continuing an existing workflow
   → semantic resolution                }
   → workflow routing                   (6 discovery layers, explicit id first)
   → deterministic state machine
   → compose response
   → deliver + publish events (transactional outbox)
```

---

## Commands

| Command | Purpose |
|---|---|
| `npm run start:dev` | Run with reload |
| `npm run build` | Compile to `dist/` |
| `npm test` | Unit + integration |
| `npm run test:unit` | Unit only (no infrastructure needed) |
| `npm run test:int` | Integration (needs `infra:up` and `.env.test`) |
| `npm run lint` | ESLint, including architecture boundaries |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run infra:up` / `:down` / `:reset` | Docker dependencies |
| `npm run seed:taxonomy` | Import + embed GS1 GPC |

---

## Testing

Unit tests never touch the network. Integration tests run against the real Postgres and Redis
from `docker-compose`, because the properties under test — concurrent upserts, lock fencing,
pgvector ranking — are properties of those datastores, not of application code alone. LLM
providers and outbound channels are always faked, so the suite is deterministic and free.

Integration tests refuse to run unless `DATABASE_URL` names a database ending in `_test`; they
truncate tables.
