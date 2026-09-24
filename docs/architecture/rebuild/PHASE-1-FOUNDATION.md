# Rebuild Phase 1 — Foundation

**Date:** 2026-09-12 · **Spec:** TDR package v1.3 + Final Lock · **Gap analysis:** `docs/architecture/TDR-v1.3-Gap-Analysis.md` §7 Phase 1

## What changed and why

| Requirement | Delivered | Where |
|---|---|---|
| Request correlation on every boundary (Overarching §25–26; Directive §26) | `AsyncLocalStorage` request context with `correlationId / requestId / parentRequestId / conversationId / turnId / runId / messageId`; HTTP middleware mints/echoes `x-correlation-id` and `x-request-id`; stage logger stamps every line from the ambient context | `src/platform/correlation/*`, `src/main.ts`, `src/shared/logging/stage-logger.ts` |
| Executable contracts (Overarching §3.3; Directive §13) | Draft 2020-12 JSON Schema registry (ajv) keyed by `$id`, version inference, typed violations; snake_case↔camelCase wire casing; OpenAI strict-mode projection that never tightens the source schema | `src/platform/contracts/*`, `src/adapters/outbound/llm/openai-llm.adapter.ts` |
| Prompt runtime (Overarching §7, §29 Phase 3; MCOS §34A.11) | `PromptDefinition` (id + version + component + schemaId), `PromptRegistry`, `PromptExecutor` (render labelled data sections → provider funnel → parse → schema validate → exactly one bounded repair → typed outcome); every execution persisted | `src/platform/prompt-runtime/*` |
| Prompt execution persistence for *all* model calls (Overarching §7.2) | Legacy callers are recorded by the provider funnel as `legacy:<operation>` until each is migrated to a versioned prompt; runtime callers record themselves with prompt/schema versions | `src/adapters/outbound/llm/llm-provider.service.ts`, `prompt_executions` table |
| Trace store + dev inspection API (Overarching §26, §28; Final Lock §13) | `orchestration_runs`, `trace_steps`, `prompt_executions`; `GET /dev/registry`, `/dev/runs/:runId`, `/steps`, `/prompts`, `/events`, `/dev/conversations/:id/runs`, `/timeline`; `POST /dev/live-tests/runs`; run metrics computed from recorded intervals (LLM count, sequential depth, parallel width, p50/p95/p99, repairs, retries) | `src/platform/observability/*`, `src/platform/live-test/*` |
| Versioned, correlated events + durable consumption (Overarching §18.6–18.7, §33; Directive §22, §49.8) | `CorrelatedDomainEvent` envelope (`eventVersion`, correlation/turn/run ids, aggregate); outbox rows stamped from context; `OutboxConsumerWorker` claims with `FOR UPDATE SKIP LOCKED` and consumes exactly once per `(event_id, consumer)`; handlers run inside the event's persisted context | `src/platform/events/*`, `outbox_events` columns, `event_consumptions` |
| Leader-safe sweepers (Directive §27) | `LeaderLock` over the Redis lock port; applied to the outbox relay (remaining sweepers are replaced in their own phases) | `src/platform/scheduling/leader-lock.ts` |
| Component/wire version registry (Overarching §49.1; Directive §49.1) | Pinned versions for all components; exposed at `/dev/registry`; specialist envelope helpers stamp versions | `src/platform/registry/component-registry.ts`, `src/platform/contracts/specialist-envelope.ts` |
| Repository defects from the gap analysis | Empty migration directory removed; four pgvector HNSW indexes recreated; run envelope per turn in ingestion (`run_id = turn:{turnId}`) | `prisma/migrations/20260912180000_phase1_platform_foundation` |
| Configuration | `DEV_TRACE_API_ENABLED` (must be false in production — enforced), `OUTBOX_CONSUMER_DISABLED`; `render.yaml` pins the dev API off | `src/config/env.schema.ts`, `.env.example`, `render.yaml` |

Dependency direction: `platform/` depends on ports and adapters, never on domain workflows; domain (`src/domain/**`, `src/*/domain/**`) is forbidden from importing `platform/**`, `@langchain/*`, `neo4j-driver` (ESLint).

## Validation

- `tsc --noEmit` clean; ESLint clean; `nest build` clean.
- Unit: 41 suites / 380 tests pass (6 new suites: request context, wire casing, schema registry, strict projection, run metrics, prompt executor incl. one-repair and typed failures).
- Integration (real Postgres + Redis): `platform-foundation.test.ts` — run/step/prompt persistence and metrics, secret redaction in traces, correlation stamped onto outbox rows, exactly-once consumption across a handler failure and retry, context resume inside handlers, leader lock exclusivity.
- **Live gate:** app started from `dist/`; `POST /dev/live-tests/runs {"messages":["I need a wall socket"]}` with `x-correlation-id: corr_phase1_gate_001`:
  - response echoed the correlation id; run `turn:2fed3f8a-…` status `COMPLETED`;
  - `GET /dev/runs/{runId}` showed 11 persisted model calls (all `legacy:*` on the configured `o3-mini`), each with model, latency, status and the run's correlation id;
  - all 11 outbox events for the turn carry `correlation_id` and `run_id`;
  - `GET /dev/conversations/{id}/timeline` reconstructs inbound message → run → events → outbound messages → assistant history in order.

### Pre-existing integration failures (not Phase 1 regressions)

Running the full legacy integration suite showed five failing suites (`outbound-queue`,
`whatsapp-pipeline`, `marketplace-loop`, `credit-recharge`, `vendor-onboarding`; 32 tests). The
same five suites fail identically on a clean checkout of `HEAD` (`d4f0347`) in a separate git
worktree against the same test database, so they are pre-existing and environment/legacy related,
not caused by this phase. `persistence`, `evidence-service`, `taxonomy-retrieval`,
`chaotic-conversation` and the new `platform-foundation` suites pass. The legacy suites are
replaced phase by phase as their subjects are rebuilt; the outbound-queue lease behaviour is
re-examined in Phase 2 when durable delivery is wired to the new turn model.

## Measured baseline (legacy pipeline, to be beaten, not assumed)

| Metric | Value |
|---|---:|
| LLM calls per turn | 11 |
| Sequential LLM depth | 10 |
| Parallel LLM width | 2 |
| LLM latency p50 / p95 | 6.8 s / 14.1 s |
| Total turn latency | 85 s |

Seven of the eleven calls are sequential `capability_ranking` invocations from the legacy capability resolver — the exact duplication the gap analysis marked REPLACE.

## Known limitations carried into Phase 2

- One transport message still equals one turn; Turn Assembly, the turn queue and pending clarification arrive in Phase 2, reusing this run envelope unchanged.
- `trace_steps` are written only by the new runtime; the legacy core emits none (stepCount 0). Specialist steps appear as each specialist is rebuilt.
- Legacy prompt executions share the ingestion `requestId`; child request ids per specialist come with the specialist adapters.
- `OPENAI_MODEL=o3-mini` in the local `.env` contradicts the recorded decision to run the conversational path on `gpt-4o` at temperature 0; per-component model policy is introduced with the specialists (Phase 3), at which point the default becomes explicit.
