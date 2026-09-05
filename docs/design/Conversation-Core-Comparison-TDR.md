# Conversation Core Comparison — TDR

Two branches, one question: **which conversation core handles chaotic multi-turn,
multi-intent trade conversations better** — MCOS's hand-rolled deterministic core, or a
graph-framework core wrapped by MCOS?

Both branches must power **WhatsApp and the web client**. Everything outside the
conversation core is shared, so the comparison isolates the variable under test.

---

## 1. Branch topology

| Branch | Conversation core | Role |
| --- | --- | --- |
| `mcos-native` | MCOS end to end — `ConversationContinuityAnalyzer` → `IntentResolutionService` → `WorkflowManager` → `WorkflowEngine` | Control. Extended with utterance segmentation and a per-turn plan. |
| `mcos-langgraph` | LangGraph.js supervisor graph | Treatment. MCOS retained as channel + capability + persistence wrapper. |

`main` is untouched and remains the published branch. `mcos-native` is the renamed former
`web-channel-support`; `mcos-langgraph` branches from it, so both start from the same commit
and inherit the same shared substrate (§4).

The web client (`frontend/`, Next.js 14) is **not part of this repository** — it is
git-excluded via `.git/info/exclude` and hosted separately. It is present for context and may
be modified to speak to whichever backend contract we define.

---

## 2. Tool decision: LangGraph.js

**Chosen: `@langchain/langgraph` (JS) with `@langchain/langgraph-checkpoint-postgres`.**

Node 20+ and TS 5.4+ are required; this repo is on Node 22 / TS 5.7, so there is no runtime
uplift. The JS port reached parity with Python on `StateGraph`, conditional edges,
checkpointing, streaming and human-in-the-loop.

Why it wins for *this experiment*:

- **It is the reference implementation of the category.** The point of branch B is to learn
  whether the graph-framework paradigm beats a bespoke core. Picking a niche library would
  confound the result with that library's idiosyncrasies.
- **`Send` / conditional fan-out** models "one utterance, several objectives" directly, which
  is the exact failure mode `mcos-native` has today.
- **`interrupt()` + checkpointer resume** is a cleaner human-in-the-loop primitive than
  MCOS's `waitsForInput` state parking.
- **Native token streaming** — the web client wants it; WhatsApp cannot use it. A core that
  supports both without branching is the honest test of the channel abstraction.
- **Postgres checkpointer** lets graph state live in the database MCOS already owns.

### Alternatives considered and rejected

| Candidate | Why not |
| --- | --- |
| **XState v5** | The best TS state-machine library — parallel states, actor model, persistable snapshots. But it has no opinion on LLM orchestration, streaming, or checkpointed multi-agent turns. Branch B would become "MCOS's engine, implemented better", testing the FSM rather than the paradigm. **Keep as the fallback refactor** if branch B's verdict is "the graph framework did not help". |
| **Mastra** | TS-native, good DX, workflow suspend/resume and agent memory built in. Younger, and its bundled memory layer would blur the boundary we are trying to measure — it would own conversation state *and* recall, making the diff against MCOS hard to attribute. |
| **Temporal** | Genuinely superior durable execution, but per-turn WhatsApp latency budgets do not suit workflow-worker round trips, and the ops burden is large. The right tool for **vendor fan-out and fulfilment**, not for a conversation turn. Worth revisiting for `request-distribution` independently of this comparison. |
| **Vercel AI SDK** | Excellent streaming and tool calling, no durable multi-objective state. Solves the web client's ergonomics, not the chaos problem. |
| **OpenAI Agents SDK** | Native agent handoffs, but provider-coupled — MCOS deliberately runs a three-provider failover chain (§4.4) — and no durable checkpoints. |

### Explicit non-goal

LangGraph does **not** solve multi-intent "natively", and no framework does. Splitting
`"Yes, KYB. Also who sells engine oil near Alaba?"` into two objectives is an LLM call with a
structured schema, written by us on both branches. `Send` helps *after* the split. Branch B's
advantage, if any, will come from state management and fan-out ergonomics — not from the
segmentation itself. Both branches therefore share the **same segmenter prompt and schema**
(§4.5) so the comparison is not contaminated by prompt quality.

---

## 3. The scenario under test

The canonical chaos transcript both branches must handle:

1. `"I sell Toyota brake pads and shock absorbers"` → starts Vendor Onboarding.
2. `"Wait, how much do you charge per month to list items here?"` → digression to billing;
   onboarding must be **parked, not lost**; the billing question must be **answered**; the
   reply should offer to resume.
3. `"Yes, KYB. Also who sells engine oil near Alaba?"` → **two objectives in one utterance**:
   completes the onboarding slot *and* opens a buyer search.

Known `mcos-native` failures at HEAD:

- `IntentResolutionService` prompt says "choose exactly one"; the schema returns one intent.
- `TurnProcessor.process` sets `needsUnderstanding = !isContinuing(relationship)`, so on a
  continuation intent resolution is skipped entirely — turn 3's search half is never
  classified.
- `WorkflowManager.route` returns one `RoutingDecision`; `applyRouting` yields one instance.
  `applyHandoff` is bounded to a single hop for an already-completed workflow.
- No workflow claims a pricing/FAQ intent, so turn 2 resolves to `unknown` → Triage.
- Nothing appends a "shall we finish X?" nudge; `ResponseComposer` never sees the suspended
  registry.

---

## 4. Shared substrate (identical on both branches)

### 4.1 Web channel

`CHANNELS` gains `web`. `CHANNEL_CAPABILITIES.web` declares rich text, buttons, lists and
media with no length ceiling — the inverse of USSD, which keeps the formatter honest.
`channel` is a plain `String` in Prisma, so no migration is required.

### 4.2 Inbound

`POST /channels/web/messages` maps the body to a canonical `IncomingMessage` and calls
`HandleIncomingMessagePort` — structurally identical to `WhatsAppWebhookController`, minus
signature verification, plus a session identity. No business logic in the controller.

### 4.3 Outbound: SSE, not Socket.IO

`GET /channels/web/stream` is a Nest `@Sse()` endpoint; a `WebChannelNotifier` implements
`ChannelNotifierPort` and pushes the canonical `Response` to the subscriber for that
conversation.

Chosen over Socket.IO because outbound delivery is unidirectional, `@nestjs/websockets` and
`@nestjs/platform-socket.io` are not currently dependencies, and SSE needs none. The web
client's existing `socket.io-client` usage targets a `/telemetry` namespace belonging to the
previous AMKE backend, which MCOS does not implement — it is already non-functional and must
be repointed regardless.

Delivery still flows through `DurableChannelNotifier`, so a disconnected browser gets the
same write-ahead-queue guarantee as an unreachable WhatsApp — `isAccepted()` semantics are
preserved rather than special-cased.

### 4.4 Retained MCOS assets — both branches

Non-negotiable, because losing them would make the comparison meaningless:

- `LlmProviderService` — three-provider failover with circuit breakers. **Branch B nodes call
  this, not LangChain chat models.** Adopting LangChain's model layer would silently drop the
  breakers.
- Prisma persistence, `ConversationContextManager`, message dedup, media pipeline.
- Capability services reached through the existing `WorkflowServices` seam: matching,
  distribution, wallet, evidence, taxonomy.
- `ChannelNotifierRegistry`, `DurableChannelNotifier`, outbound delivery sweeper.
- Event publication and `StageLoggerPort`.

### 4.5 Shared understanding primitives

- **Utterance segmenter** — one LLM call, structured output, ordered segments with text
  spans. Single-segment output is the common case and must stay cheap.
- **`PlatformInfo` workflow / node** — claims `pricing_question`, `platform_faq`, `help`.
  Without it turn 2 is unanswerable on either branch.

### 4.6 Expiry removal

Per requirements, conversation expiry is being retired. Expiry is currently load-bearing for
disambiguation, so both branches must replace it rather than delete it:

- `canResume` prunes the candidate set before every discovery layer.
- `ConversationContinuityAnalyzer.buildPrompt` lists **every** open workflow with no cap —
  unbounded growth means rising cost and *degrading* classification precisely as a
  conversation gets more chaotic.
- `resolveByEntity` only fires when exactly one workflow claims an entity; four historical
  "engine oil" searches make it permanently indecisive.

Replacement: recency weighting in candidate ranking, a hard cap on candidates entering any
LLM prompt, and `maxSuspendedWorkflows` archiving doing real work.

---

## 5. Branch A design — `mcos-native`

Additive; the discovery layers are kept.

1. **Segmentation stage** ahead of continuity analysis.
2. **Turn plan loop** in `TurnProcessor`: route each segment through the existing
   `WorkflowManager`, execute, collect. **Sequential** — segment 2's routing must observe
   segment 1's registry mutations. `ConversationPolicyEngine.canInterrupt` is checked per
   segment, so a payment step cannot be preempted by a chatty second clause.
3. **`ResponseComposer.merge`** fuses the per-segment replies into one message. It already
   exists for this and is currently under-used.
4. **Resume nudge** when a turn ends with no active workflow and resumable suspended ones
   exist — offered as an `encodeActionPayload` button, so accepting it hits discovery Layer 1
   and resumes with no LLM in the loop.
5. **Bounded, recency-weighted discovery** per §4.6.
6. **Entity scoping fix**: segment-scoped entities, so a buyer-search product cannot
   contaminate the onboarding instance's `importantEntities` and fingerprint.

## 6. Branch B design — `mcos-langgraph`

Separation of concerns is the whole point; the boundary is drawn at **one seam**.

```
Channel adapters (MCOS)      WhatsApp webhook / web POST → IncomingMessage
        ↓
MessageIngestion (MCOS)      dedup, persist, media, conversation lock
        ↓
ConversationCorePort         ← the seam. One method: handleTurn(context) → responses
        ↓
LangGraph supervisor         segment → plan → objective subgraphs → merge
        ↓                    checkpointed in Postgres, per-conversation thread
Capability services (MCOS)   matching, distribution, wallet, evidence — injected as tools
        ↓
ChannelNotifierRegistry      canonical Response → channel-native rendering
```

- `ConversationCorePort` is introduced on **both** branches. Branch A implements it with
  `TurnProcessor`; branch B with the graph. That is what makes the two cores swappable and
  the diff reviewable.
- Objective subgraphs replace workflow definitions: Vendor Onboarding, Buyer Search, Credit
  Recharge, Platform Info. Each is a `StateGraph` whose nodes call MCOS capability services.
- Multi-intent uses `Send` to fan out one turn across objective subgraphs; the merge node
  produces the ordered response list `ResponseComposer` already knows how to fuse.
- **Single state owner.** MCOS's `workflow_instances` remains the source of truth for the
  registry, active pointer, fingerprints and `importantEntities`, because those drive
  discovery. The LangGraph checkpointer owns *only* in-flight graph position. Two owners of
  "what is this user in the middle of" is the hardest class of bug to diagnose on WhatsApp,
  where sessions cannot be reproduced — so the split is explicit and enforced at the port.

---

## 7. How the comparison is judged

A verdict by feel is worthless. Both branches are scored on the same replay harness:

- **Fixture set** — chaotic transcripts, starting with §3, each turn labelled with the
  objective(s) that *should* be served.
- **Metrics** — per-segment routing accuracy; objectives dropped; objectives resumed after
  digression; LLM calls per turn; p50/p95 turn latency; tokens per turn.
- **Same fixtures, same segmenter prompt, same LLM provider chain** on both branches.
- Both must pass the existing integration suites (`whatsapp-pipeline`, `marketplace-loop`,
  `persistence`) plus a new `web-pipeline` suite.

Cost is a first-class metric, not a footnote: segmentation multiplies routing work per turn,
and a core that is 4% more accurate for 3× the tokens is not obviously the winner on
WhatsApp margins.
