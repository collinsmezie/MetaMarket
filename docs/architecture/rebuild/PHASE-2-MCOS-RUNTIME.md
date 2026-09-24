# Rebuild Phase 2 — MCOS Runtime

**Date:** 2026-09-12 · **Spec:** MCOS + LangGraph TDR v4.4 §5A, §7–§10, §19–§20, §25A, §46–§49, §63 · **Gap analysis:** §7 Phase 2

## What changed and why

| Requirement | Delivered | Where |
|---|---|---|
| A transport message is not a turn (MCOS §5A, §62.1) | `src/conversation/` component: Turn Assembly with a durable state machine `OPEN → SEALED → ENQUEUED → PROCESSING → COMMITTED / WAITING_USER / FAILED / CANCELLED`, persisted quiet and hard deadlines, `revision` for CAS | `conversation/domain/logical-turn.ts`, `conversation/application/turn-assembly.service.ts` |
| Deterministic boundary precedence (§5A.3.3, §5A.4–§5A.6) | Pure policy: interactive payload → explicit retraction → channel/hard limits → quiet window → continuation; P1 model classifier registered (prompt + schema `mcos-p1-turn-assembly-1.0`) but only consulted when enabled and signals are inconclusive | `conversation/domain/assembly-policy.ts`, `turn-assembly-classifier.ts`, `prompts/mcos.p1.turn-assembly.md` |
| Atomic append/seal/enqueue/claim (§5A.3.4, §5A.10–§5A.11) | Open turn read `FOR UPDATE` inside the accepting transaction; partial unique index = one OPEN turn per conversation; CAS seal (`status='OPEN' AND revision=$n AND quiet_deadline_at<=now()`); per-conversation monotonic queue sequence; claim with `FOR UPDATE SKIP LOCKED` that never overtakes a lower sequence or a conversation already in flight | `adapters/persistence/prisma-logical-turn.repository.ts`, migration `20260912200000_phase2_mcos_logical_turns` |
| Retraction before execution (§5A.8, §5A.10.1) | "forget that / never mind / cancel / leave that …" cancels the never-executed OPEN turn (`RETRACTED_BEFORE_EXECUTION`) and the new turn records `supersedesTurnId`; committed history is never rewritten | policy + repository |
| Queued turn lifecycle, one executor per conversation (§5A.9, §19) | `TurnQueueWorker`: in-process kick after enqueue, 1 s poll on every replica (CAS-safe), stale-claim recovery (leader-locked), bounded concurrency; `TurnExecutor` holds the Redis conversation lock and extends it on a heartbeat (the previously unused `extendLock`) | `turn-queue.worker.ts`, `turn-executor.ts` |
| Bounded retry without duplicating committed work (§5A.10 rule 7) | `requeue` on retryable failure while `attempts < TURN_MAX_EXECUTION_ATTEMPTS`; terminal FAILED afterwards | executor + repository |
| Durable pending clarification (§25A.0–§25A.4) | `pending_clarifications` with partial unique `WAITING_FOR_USER` per conversation, version-checked transitions, append-only history, deterministic answer binding of the next turn, loop prevention by `issueKey` | `domain/pending-clarification.ts`, `application/clarification.service.ts`, `adapters/persistence/prisma-clarification.repository.ts` |
| Bounded context snapshot (Overarching §18.8, §41; MCOS §63.1) | `ConversationWorkingContext` built per turn from durable records (history, workflow registry, memory facts, previous turn summary, pending clarification, vendor identity) and persisted as `turn_context_snapshots` with `contextSnapshotId` on the turn and run | `application/turn-context.builder.ts`, `domain/turn-context.ts` |
| Canonical turn envelope and orchestrator seam (§57, §63.1, §63.9) | `TurnInputState` + `TurnOrchestratorPort.runTurn(input, context) → TurnOutcome`; MCOS commits the turn only after the orchestrator returns with delivery accepted | `ports/turn-orchestrator.port.ts` |
| Migration adapter | `LegacyCoreTurnOrchestrator` feeds the assembled logical turn to the legacy core (anchored on the last message, all artifacts); deleted when the v4.4 conversation graph binds to `TURN_ORCHESTRATOR` after IDCE/CSRE exist | `adapters/orchestrator/legacy-core-turn-orchestrator.adapter.ts` |
| Ingestion (§4.1, §18.2) | persist → dedupe → inline artifacts → (media queue) → Turn Assembly. No synchronous reply; `HandleIncomingMessageResult.turnId` added | `application/pipeline/message-ingestion.service.ts` |
| Fail-closed checkpointer (Gap Analysis §5.4) | `TurnCheckpointer` no longer falls back to `MemorySaver`; a deployment that cannot checkpoint does not boot | `application/langgraph/turn-checkpointer.provider.ts` |
| Events (Overarching §33) | `MessageReceived`, `LogicalTurnCreated`, `LogicalTurnSealed`, `LogicalTurnCommitted` — versioned, correlated, run-stamped | assembly service, executor |
| Dev inspection | `GET /dev/turns/:turnId` (turn + queue + snapshot), `/dev/conversations/:id/turns`, `/dev/conversations/:id/clarifications`; `POST /dev/live-tests/runs` now waits for each message's logical turn to reach a terminal state and supports `interMessageDelayMs` / `concurrent` | `platform/live-test/*` |
| Configuration (§5A.3.2 "exposed in configuration and telemetry") | `TURN_QUIET_WINDOW_MS_{WHATSAPP,WEB,DEFAULT}`, `TURN_MAX_ASSEMBLY_MS`, `TURN_MAX_MESSAGE_COUNT`, `TURN_CLAIM_TTL_MS`, `TURN_QUEUE_POLL_MS`, `TURN_MAX_EXECUTION_ATTEMPTS`, `TURN_ASSEMBLY_MODEL_CLASSIFIER_ENABLED`; limits are logged with every accepted message | `config/env.schema.ts`, `.env.example` |

Data ownership: `logical_turns`, `turn_queue`, `pending_clarifications`, `turn_context_snapshots` and `inbound_messages.turn_id` are written only by the MCOS runtime. LangGraph checkpoints remain orchestration-only.

## Validation

- `tsc --noEmit`, ESLint, `nest build` clean.
- Unit: 42 suites / 389 tests (new: boundary policy — continuation, correction vs retraction, interactive payload, hard limits, channel boundary, classifier gating, deadline capping).
- Integration (real Postgres + Redis, `test/integration/turn-assembly.test.ts`): four rapid messages coalesce with accumulated text and per-message turn links; CAS seal refuses early/stale attempts and exactly one of two concurrent sealers wins; retraction cancels and supersedes; button tap seals; concurrent first messages never open two OPEN turns; idempotent enqueue with monotonic sequence; ordered claim (disjoint conversations for racing workers, second turn unclaimable while first in flight, claimable after commit); requeue and stale-claim recovery bounded by attempts; one active clarification per conversation with version-checked transitions and append-only history.
- **Live gate** (app from `dist/`, real model calls, real queue; `POST /dev/live-tests/runs`):

| Scenario | Result |
|---|---|
| A single message "I need a wall socket" | 1 turn `SINGLE_MESSAGE`, `COMMITTED`, one run, reply delivered |
| B "I need brake pads" / "Toyota Camry" / "2018" / "near Warri" at 300 ms gaps | **1 turn** `COALESCED_MESSAGES`, assembled text 4 lines, **one** orchestration run (11 model calls once, not four times) |
| C "I need brake pads" / "Actually forget that" / "Find me a plumber" | first turn `CANCELLED` (`RETRACTED_BEFORE_EXECUTION`, never executed, no fanout), second turn `supersedesTurnId` set and `COMMITTED` |
| D two messages sent concurrently | 1 turn, both messages, ordered (now by receipt timestamp) |
| E same `clientMessageId` delivered twice | 1 inbound message persisted, 1 turn |
| F interactive payload | sealed immediately, `INTERACTIVE_PAYLOAD`, `COMMITTED` |
| Inspection | `/dev/turns/{id}`: revision 7, queue `COMMITTED` seq 1, snapshot v1 persisted; `/dev/runs/{id}`: correlation id from the HTTP header propagated through the queue worker onto all 11 prompt executions and 11 events; timeline shows `MessageReceived ×4 → LogicalTurnCreated → LogicalTurnSealed → LogicalTurnCommitted` |

## Measured (legacy orchestrator behind the new runtime)

Coalesced turn: 11 LLM calls, sequential depth 10, parallel width 2, p50 7.1 s, total 107 s. The runtime itself adds ~1.2 s (web quiet window) plus sub-second queue latency; the cost is entirely the legacy understanding stack, which Phases 3–4 replace.

## Known limitations carried forward

- The legacy core still records the user turn and delivers replies itself; `TurnOutcome.intentTypes/objectIds` are empty until IDCE/CSRE exist, so `previousTurnSummary` carries only the reply text.
- Legacy prompt executions share one `requestId` per turn; child request ids arrive with the specialist adapters.
- `ConversationWorkingContext.semanticObjects` is empty until CSRE persists `SemanticResolution` records (Phase 4).
- Media messages join a turn only after their artifacts exist; a text message arriving during transcription may seal a turn ahead of the voice note (documented ordering trade-off).
- Pending clarifications are bound and persisted, but nothing *asks* one yet: creation is the orchestrator graph's clarification gate (Phase 4b).
