# Rebuild Phase 4b — LangGraph Conversation Orchestrator v4.4

**Date:** 2026-09-24 · **Spec:** MCOS + LangGraph TDR v4.4 §7–§29, §34–§34A, §44–§49, §55–§58, §63–§65 · **Gap analysis:** §7 Phase 4 (second half), MCOS §56 migration phases 3–7

## What changed and why

The legacy conversation core (turn-supervisor graph, segment cursor, six-layer NL router, four overlapping understanding services) is gone. MCOS's `TURN_ORCHESTRATOR` seam is now bound to a v4.4 conversation orchestrator graph that consumes the IDCE and CSRE contracts built in Phases 3–4 and drives the deterministic workflow engine through a typed port.

| Requirement | Delivered | Where |
|---|---|---|
| Node topology (§11), conversation-scoped thread with explicit per-turn envelope (§8) | `ingest → fastPathCheck → (idce ∥ csre) → joinUnderstanding → planActions → clarifyGate → schedule ⇄ execute → responsePlan → compose → deliver → commit`, plus `triage` for a failed understanding. `thread_id = conversation:{id}`, every channel replaces on update so no turn inherits another's state; a retried turn carries only its own committed action results (§47) | `src/orchestration/application/graph/*` |
| State schema (§9) | `ConversationGraphState`: input, working context (dates serialised), fast-path decision, two specialist slots (parallel writers), unified understanding, plan, execution, artifacts, clarification, response, recovery, lifecycle. Plain JSON in the Postgres checkpointer; business truth stays in MCOS tables (§7.1) | `graph/conversation-graph.state.ts` |
| Parallel understanding + join (§12–§14, §65.3) | IDCE and CSRE run in one superstep through their typed adapters; the join binds current-turn objects to intents deterministically (span overlap, single-intent, primary fallback), resolves continuity, collects unresolved issues, marks readiness. Nothing routes before the join | `conversation-graph.nodes.ts`, `domain/unified-understanding.ts` |
| Continuity (§15, P2) | Deterministic when obvious (no workflows, explicit payload, clarification answer, single control intent); otherwise `mcos.p2.continuity@1.0.0` with a deterministic default on failure | `domain/continuity-decision.ts`, `application/orchestration-prompts.ts` |
| Planning (§16, P3) | Capability catalogue maps IDCE intent types → workflow type/operation/conflict keys/parallel-safety (intent is not workflow, IDCE §3.4). Deterministic planner when every intent maps cleanly; `mcos.p3.plan-builder@1.0.0` for anything richer, validated against the catalogue (unique ids, known intents/capabilities/operations, acyclic) and falling back deterministically (§44) | `domain/capability-catalogue.ts`, `domain/deterministic-planner.ts`, `domain/action-plan.ts` |
| Scheduling (§17–§18, §24) | Parallelise independent, parallel-safe actions with disjoint conflict keys; serialise the rest; skip only dependency-blocked actions on failure; every step guarantees progress | `domain/scheduler-policy.ts` |
| Workflow execution boundary (§20–§23, §63.5) | `WorkflowExecutionPort` → `LegacyWorkflowExecutionAdapter`: reloads authoritative state, resolves the instance for the planned action (explicit id of the same capability → open instance → new), suspends interruptible work on drift (§16), translates IDCE/CSRE contracts into the legacy `WorkflowTrigger`, lets `WorkflowEngine` perform every transition, applies handoffs, returns `ActionExecutionResult` | `adapters/legacy-workflow-execution.adapter.ts`, `ports/workflow-execution.port.ts` |
| Clarification gate (§25, §25A, P4) | Collects specialist recommendations and unresolved referents; one question per turn (deterministic when one candidate, `mcos.p4.clarification@1.0.0` otherwise); persists through MCOS `ClarificationService` before delivery; loop prevention releases blocked actions; unrelated work still runs; answered questions are resolved on the next turn | `clarifyGate` node |
| Response planning and composition (§26A–§28, P5, P6) | §28 ordering; deterministic merge for single results; `mcos.p5.response-planner` + `mcos.p6.naturalizer` for multi-result turns with a fact guard (every number and bold name must survive, else deterministic text); interactive payloads are never rewritten; resume nudge with a Layer-1 button when work was parked (§28 rule 5) | `domain/response-plan.ts`, `responsePlan`/`compose` nodes |
| Fast paths (§30, §34A.10) | Empty input → fallback; vendor RFQ replies → existing deterministic handler; tapped workflow/system actions → deterministic plan with no specialist call; replayed suggestion labels and numbered option picks resolved before understanding | `fastPathCheck` node, `adapters/vendor-fast-path.adapter.ts` |
| Error containment, heartbeat, delivery (§44–§46) | Node failures are traced and contained to one honest fallback; typing indicator + 25 s interim message preserved; delivery through the existing durable outbox path inside the graph, so a returned outcome means the outbound command was accepted | `conversation-orchestrator.service.ts` |
| Observability (§49, §65.6) | Every node is a traced step of the run (scheduling rounds separately), prompts record prompt/schema versions, `/dev/runs/{runId}` shows the whole turn, `naturalizationRejected` explains a declined P6 | `step()` helper |
| Prompts as code (§34A) | P2–P6 system prompts verbatim from the TDR plus output rules, bound to `mcos-p2…p6-*-1.0` executable schemas, component `LANGGRAPH`, model `LLM_SPECIALIST_MODEL`, one bounded repair | `src/orchestration/prompts/*`, `schemas/*` |
| Legacy removal (§56 phases 3–7, gap analysis REMOVE list) | Deleted: `LangGraphConversationCore`, `TurnCheckpointer`, `TurnGraphState`, `TurnProcessor`, `SEGMENT_EXECUTOR`/`CONVERSATION_CORE` ports, segmentation / intent-resolution / semantic-resolution / continuity-analyzer services and their schemas, `SuggestedActionsService`, `ResponseComposer`, `LegacyCoreTurnOrchestrator`. `WorkflowManager` remains only as a registry/discovery helper (unused by the graph) | `src/config/conversation.module.ts` |
| Chaos harness (§52) | The scripted oracle now answers IDCE, CSRE, P2, P5, P6 and the legacy business services; waits for turn commit before teardown; assertions pin the new mechanism (one IDCE + one CSRE call per turn, no segmentation) | `test/harness/*`, `test/integration/chaotic-conversation.test.ts` |

`ORCHESTRATOR_NATURALIZE_RESPONSES` (default true) gates P5/P6 for multi-result turns.

## Validation

- `tsc`, ESLint, `nest build` clean. Unit: 52 suites / 435 tests (new: scheduler, plan validation, deterministic planner incl. the digression case, understanding bindings/issues, response ordering/composition, continuity). Integration (real Postgres): chaos replay on WhatsApp and web plus the Phase 1–4 suites, all green, twice in a row.
- **Chaos replay (MCOS §52 Scenario A, scripted-correct specialists):** both channels serve VendorOnboarding → PlatformInfo (digression, onboarding suspended, "carry on" nudge) → VendorOnboarding + BuyerSearch (multi-intent) with zero dropped objectives at 16 LLM calls per transcript.
- **Live gate — pipeline mode** (`POST /dev/live-tests/runs`, real `gpt-4o-2024-11-20`, real workflows):

| Scenario | Result |
|---|---|
| "Hello" | GREETING → deterministic platform reply; 2 LLM calls (IDCE ∥ CSRE), 5 s end to end (legacy: 11 calls, 85–107 s) |
| "Find me a pump" | CSRE ambiguity → gate asks "What type of pump do you need…", BuyerSearch action held NEEDS_USER, turn `WAITING_USER`, clarification persisted; 2 LLM calls |
| "I need Peak milk and Indomie" → "How much for the milk?" | BuyerSearch START (objects milk/Peak, instant noodles/Indomie) → vendors revealed; turn 2 P2 `CONTINUATION` → BuyerSearch CONTINUE on the same instance |
| "Find a plumber in Warri and tell me your listing fee" | Two intents → two actions (BuyerSearch START, PlatformInfo START) serialised on the conversation key; both served; P5 planned, P6 declined once for dropping a vendor name (fact guard) and once accepted |
| "I sell electrical materials and wall sockets in Abuja" | OFFER → VendorOnboarding START; legacy onboarding continues its own questions |
| "I need a generator" → "forget it, cancel that" | BuyerSearch START; then deterministic CANCELLATION → CANCEL action → instance cancelled, "Okay, I've cancelled that search…"; 2 LLM calls |
| "I sell electrical materials in Ikeja Lagos" → "Wait, how much do you charge…" → "carry on" | Onboarding started; digression answered by PlatformInfo while onboarding is *suspended*, reply ends with the nudge and a "Carry on" button; "carry on" → RESUME on the same onboarding instance |

Per-turn orchestration cost is now 2–3 model calls (IDCE ∥ CSRE, P2 only when workflows exist); the remaining calls in the metrics belong to legacy workflow services (matching, onboarding extraction) that later phases replace.

## Known limitations carried forward

- Workflows still consume the legacy `WorkflowTrigger`/`IntentResult`/`SemanticRequest`; the adapter translates. They are rebuilt on the v1.3 contracts in Phases 10–12, which also removes `application/matching`, `application/capability` and the legacy semantic services those workflows call.
- The evidence path inside CSRE and Enrichment/GPC invocation after CSRE (§38) wait for Phases 5–7.
- P3 is exercised only when the deterministic planner cannot map an intent; a P3 regression corpus should accompany the first workflow that needs it.
- Replay mode (§50) — reproducing a turn without charging or fanning out — is not implemented; traces and checkpoints carry the inputs for it.
