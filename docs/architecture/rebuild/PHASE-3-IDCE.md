# Rebuild Phase 3 — IDCE v1.6 (Intent Discovery & Classification Engine)

**Date:** 2026-09-12 · **Spec:** IDCE TDR v1.6 (all sections; contract lock §23), MCOS §63.2–§63.3, §65.2, Overarching §9, §24.1 · **Gap analysis:** §7 Phase 3

## What changed and why

| Requirement | Delivered | Where |
|---|---|---|
| IDCE as an independent authority for "what does the user want?" (§1, §2.1, §23.2) | New component `src/intent/` with domain / ports / application / adapters; imports only the platform runtime, never CSRE, taxonomy, matching or workflows | `src/intent/**` |
| Executable contracts (§18.2, §22.3) | `idce-resolution-1.0.json`, `idce-service-request-v1.1.json`, `idce-service-response-v1.1.json` registered in the schema registry; `component_version` is a `^1\.\d+$` string (the TDR's stale `const "1.4"` superseded by §23.1 = 1.6, wire versions unchanged) | `src/intent/schemas/*` |
| Versioned master prompt (§28, §31 rule 3) | The §28 production prompt verbatim plus the output-discipline rules the schema/invariants need; `idce.master.discover@1.6.1` (1.6.1 tightens negation: an excluded object is a NEGATIVE constraint, never a second intent) | `src/intent/prompts/idce.master.md` |
| Taxonomy as vocabulary, not workflow names (§3.4, §4, §22.5) | Base vocabulary constant; unsupported labels are semantic-invariant violations that point the model at `UNKNOWN_INTENT`/`OUT_OF_SCOPE` | `domain/intent-taxonomy.ts` |
| Semantic invariants beyond schema (§18.3 rules 7–12) | Unique ids, single PRIMARY, no dangling references, acyclic execution relations, clarification consistency — enforced inside the prompt runtime's single bounded repair | `domain/idce-invariants.ts`; `PromptExecutor.semanticValidator` |
| Runtime chain (§18.3, §29A) | `IdceService`: pinned prompt → provider funnel → parse → schema → invariants → one repair → typed outcome; provider/schema/policy failures return `ERROR` envelopes, never fabricated intents; authoritative `model_metadata` stamps overwrite the model's copy | `application/idce.service.ts` |
| Idempotency (§21, §22.4) | `idce:{conversation}:{turn}:{revision}`; same turn + snapshot + versions returns the stored resolution with no model call | service + `intent_resolutions.idempotency_key` |
| Persistence and lineage (Overarching §18.4, §32.1) | `intent_resolutions` (wire resolution, versions, model, prompt execution id, latency, status, error, supersede pointer); `IntentResolved` event; trace step `IDCE/discover` with decision summary | `adapters/persistence/*`, migration `20260912220000_phase3_idce_intent_resolutions` |
| MCOS specialist adapter (MCOS §63.2–§63.3, §65.2) | `IdceSpecialistAdapter`: `TurnInputState` + `ConversationWorkingContext` → `IDCEServiceRequest` (bounded `IntentContext`, prior intent state from persisted resolutions), request validated before invocation, response validated after, projected into `SpecialistResponseEnvelope` with versions and correlation preserved; never repairs a response by guessing | `application/idce-specialist.adapter.ts` |
| Component Mode API (Overarching §24.1, §27.3) | `POST /v1/idce/resolve` (snake_case envelope in/out, schema-validated) | `adapters/http/idce.controller.ts` |
| Migration path (MCOS §56 phases 1–2) | IDCE runs beside the legacy core on every logical turn; its intents feed the turn summary and `previousTurnSummary`; failures never affect the legacy outcome | `conversation/adapters/orchestrator/legacy-core-turn-orchestrator.adapter.ts` |
| Model policy (Directive §49.4; recorded determinism finding) | `LLM_SPECIALIST_MODEL` (default `gpt-4o-2024-11-20`) pinned per prompt definition, honoured by the OpenAI adapter, recorded on every execution | `config/env.schema.ts`, `platform/prompt-runtime/prompt-definition.ts` |
| Provider schema compatibility (found live) | Strict projection now maps `const`→`enum` and untyped `{}` slots to scalar-or-null; the Anthropic tool schema is projected too (it rejected the TDR's top-level `allOf`) | `platform/contracts/strict-output-schema.ts`, `adapters/outbound/llm/anthropic-llm.adapter.ts` |
| Dev inspection | `GET /dev/requests/:requestId/trace` returns the step, prompt executions, events and the persisted intent resolution for one request id | `platform/live-test/dev-trace.controller.ts` |

## Validation

- `tsc`, ESLint, `nest build` clean. Unit: 44 suites / 398 tests (new: taxonomy invariants, service idempotency/versions/typed failures). Integration (real Postgres): `intent-resolution.test.ts` (idempotency key uniqueness, prior intent state excludes the current turn, camel view) plus the Phase 1–2 suites still green.
- **Live gate — Component Mode** (`POST /v1/idce/resolve`, real `gpt-4o-2024-11-20`, 2–8 s each):

| Case (IDCE §26) | Result |
|---|---|
| "I need a generator" | `BUY` PRIMARY 0.98 |
| "I need a generator, how much is it and who sells one in Warri?" | `FIND_PRODUCT` P, `PRICE_INQUIRY` S, `FIND_VENDOR` S; SUPPORTS relations; `LOCATION=Warri` constraint |
| "Find a plumber and buy PVC" | `FIND_SERVICE` P, `BUY` S |
| "How much?" after "I need Toyota brake pads" | `PRICE_INQUIRY` scoped to `object_1` (context used, no invented objective) |
| "Yes continue the onboarding" (suspended onboarding) | `CONTINUE_VENDOR_ONBOARDING` |
| "By the way, what is the monthly listing fee?" (onboarding active) | `PLATFORM_INFORMATION` |
| "you get engine oil?" | `AVAILABILITY_INQUIRY` |
| "abeg find person wey sell gen" | `FIND_VENDOR` (`product=generator`) |
| "Give me 10 bags of cement" / "Sorry, make that 20" (coalesced) | one `BUY`, `QUANTITY=20` |
| "I want a blender, not a mixer" | prompt 1.6.0 produced a second `BUY(mixer)` intent; after tightening the negation rule (1.6.1) re-run live → one `BUY` PRIMARY with `EXCLUDE=mixer` polarity `NEGATIVE`, no relations |
| "Find me a pump" | `FIND_PRODUCT`, no invented subtype (referent ambiguity is CSRE's) |
| "Hello" | `GREETING` |
| "I dey sell electrical materials" | `SELL` |
| "Find brake pads" / "also, how do I recharge my credits?" | `FIND_PRODUCT` + `RECHARGE_CREDITS` |

- **Live gate — Pipeline Mode**: "I need a wall socket and how much is it?" through the real queue → trace step `IDCE 1.6 discover SUCCESS 9.0 s`, prompt execution `idce.master.discover@1.6.x` on `gpt-4o-2024-11-20` with **1 schema repair recorded**, `IntentResolved` event on the run, turn summary `intentTypes = [FIND_PRODUCT, PRICE_INQUIRY]`; legacy outcome unaffected. First attempt of the day surfaced two provider schema rejections (untyped `value`, Anthropic `allOf`) that the trace exposed as `TEMPORARY_FAILURE` — fixed and re-verified.

## Known limitations carried forward

- `scope.object_ids` is empty until CSRE supplies objects (Phase 4); IDCE correctly does not invent them.
- Prompt behaviour is validated by a hand-run battery, not a regression corpus; the IDCE §26 cases should become a replayable eval once CSRE objects exist so both specialists are scored together.
- Routing authority still sits in the legacy `WorkflowManager`; IDCE output is recorded, not yet acted on — that moves to the LangGraph planner after CSRE (Phase 4b), per MCOS §56 phases 3–4.
