# Requirements Specification: Typing Status Feature & Lifecycle Management

**Status:** Proposed / Requirement  
**Target Module:** MCOS (`application/pipeline`, `domain/ports/outbound`, `adapters/outbound/channel`)  
**Compliance Standard:** Mandatory alignment with [`CONTRIBUTING.md`](../../CONTRIBUTING.md)

---

## 1. Executive Summary & Objective

The **Typing Status Feature** enhances user experience across conversational channels (primarily WhatsApp Business API) by displaying real-time feedback (`"typing..."` indicator and bouncing dot animation) while MetaMarket processes user turns.

Because LLM intent resolution, semantic understanding, Graph-RAG queries, and vendor capability matching can take several seconds, providing continuous visual feedback reduces perceived latency and prevents users from re-sending duplicate messages.

This specification outlines the functional, technical, and architectural requirements for implementing typing indicators in MetaMarket Conversation OS (MCOS). It defines strict rules for active processing triggers, error deactivation & empathetic fallback messaging, 25-second timeout heartbeat updates, and channel-agnostic port abstractions, all fully grounded in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

---

## 2. Mandatory Architectural & Design Constraints (`CONTRIBUTING.md` Grounding)

All code and design changes implementing this specification **MUST** comply with the following `CONTRIBUTING.md` rules:

| Section | Rule | Requirement Application |
|---|---|---|
| **§3.1 & §3.5** | Dependencies Point Inward & Every External Dependency Behind a Port | The domain and application layers must not reference Meta Graph API schemas (`typing_indicator`, `wamid`). Typing capabilities must be declared as a channel-agnostic outbound port abstraction (`domain/ports/outbound/typing-indicator.port.ts` or extended `ChannelNotifierPort`). |
| **§4.1** | Context Boundaries | Owned strictly by **MCOS** (`application/pipeline/turn-processor.service.ts` and `adapters/outbound/channel`). |
| **§6.3** | Liskov Substitution Principle | Channel adapters that do not support typing indicators (e.g. SMS, Voice, Mock) must provide a graceful no-op implementation without throwing or breaking callers. |
| **§7.1 & §7.2** | Sanctioned Patterns & Banned Patterns | Use Decorator/Strategy patterns. Banned: Boolean flag parameters (`sendTyping(true)`), primitive obsession, swallowing errors, and logic in adapters. |
| **§9.2 & §9.6** | Concurrency, Lock TTL & Deadline Bounding | Typing status timers must respect the 30s `CONVERSATION_LOCK_TTL_MS`. The 25-second timeout notification must execute safely before the conversation lock expires. |
| **§11.1** | Truthful Copy | User-facing copy for delayed processing or errors must be truthful, polite, and empathetic ("pleading with the user"), naming exact system states without false promises. |
| **§11.2** | Fallback Envelope Semantics | Error notifications resulting from internal processing failures must maintain fallback envelope standards and not degrade into generic greeting loops. |
| **§11.6** | Best-Effort Principle | Typing status notifications are best-effort background signals. A failure to deliver a typing status indicator MUST NEVER throw, fail the turn, or roll back committed state. |
| **§12.3 & §12.5**| Return Outcomes & Stage Logger | All typing lifecycle actions must log using the standard `Input / Action / Output` format via `StageLoggerPort`. Errors must return classified outcomes rather than throwing. |
| **§15 & §16** | Testing & Quality Gate | Full unit and integration coverage with hand-written fakes. Zero regressions on existing test suites; build, typecheck, and lint gates must remain green. |

---

## 3. Functional Requirements

### 3.1 Active Processing Triggering (REQ-TS-001)

1. **Trigger Condition:** MetaMarket **MUST** trigger the typing status indicator **only** when it is actively processing an incoming user turn/request (e.g., inside `TurnProcessor.process()`).
2. **Timing:** The typing indicator signal MUST be dispatched immediately after the conversation context is loaded and recorded, prior to executing long-running tasks (LLM intent resolution, semantic understanding, capability matching, vendor fan-out).
3. **Channel Filtering:** The trigger signal MUST be directed only to channels that support typing status (e.g., WhatsApp). Non-supported channels MUST silently ignore the request via port abstraction (`CONTRIBUTING §6.3`).

### 3.2 Failure Handling & Typing Deactivation (REQ-TS-002)

1. **Automatic Deactivation:** In Meta WhatsApp API, delivering any response message automatically deactivates/clears the active typing status on the user's client. 
2. **Internal Problem Recovery:** If `TurnProcessor` encounters an uncaught exception, timeout, or internal error during turn execution:
   * MCOS **MUST** intercept the failure gracefully.
   * MCOS **MUST** send an immediate user-friendly error response to deactivate the typing indicator and inform the user.
3. **Empathetic Pleading Copy:** The error message **MUST** be humble, polite, and plead with the user for forgiveness while offering clear next steps (`CONTRIBUTING §11.1`).
   * *Required Copy Standard:* `"I am so sorry, I ran into an unexpected technical issue while processing your request. Please forgive me—could you please try sending your message again in a moment?"`
4. **Non-Rollback Assurance:** Sending the error/deactivation message MUST NOT throw or roll back any database state already committed (`CONTRIBUTING §11.6`).

### 3.3 25-Second Timeout & Progress Heartbeat (REQ-TS-003)

Meta's WhatsApp Cloud API automatically expires typing status indicators after **25 seconds** if no response message is sent.

1. **Heartbeat Timer:** MCOS **MUST** maintain an active processing timer for turns whose execution exceeds 25 seconds (e.g., complex multi-vendor capability fan-out or deep RAG lookups).
2. **Proactive Progress Notification:** If active processing reaches **25 seconds** without a completed response:
   * MCOS **MUST** dispatch an interim progress update message to the user before the 25s Meta TTL expires.
   * *Required Copy Standard:* `"I am still working hard to find the absolute best options for your request! Thank you so much for your patience—I will have your results ready in just a moment."`
3. **Re-triggering Typing Status:** After sending the 25-second interim update message (which clears the initial typing indicator), MCOS **MUST** immediately issue a new typing indicator request if processing is continuing into a second phase, keeping the visual indicator active.
4. **Lock TTL Bounding:** The heartbeat timer MUST operate strictly within the bounds of `CONVERSATION_LOCK_TTL_MS` (30 seconds) (`CONTRIBUTING §9.2`, `§9.6`) to prevent worker race conditions.

---

## 4. Technical & Architectural Specification

### 4.1 Domain Port Interface (`domain/ports/outbound/typing-indicator.port.ts`)

Following `CONTRIBUTING §3.5` and `§6.4`, a dedicated typing indicator capability contract will be established:

```typescript
import type { Channel } from '../../models/channel';

export const TYPING_INDICATOR_PORT = Symbol('TypingIndicatorPort');

export interface TypingTarget {
  readonly channel: Channel;
  readonly address: string;
  readonly conversationId: string;
  readonly messageId?: string;
}

export interface TypingIndicatorResult {
  readonly success: boolean;
  readonly error?: string;
}

export interface TypingIndicatorPort {
  /**
   * Triggers a 'typing...' status on the target channel if supported.
   * Must never throw; returns an outcome result.
   */
  showTyping(target: TypingTarget): Promise<TypingIndicatorResult>;
}
```

### 4.2 Adapter Implementation (`adapters/outbound/channel/whatsapp-notifier.adapter.ts`)

The WhatsApp adapter implements `TypingIndicatorPort` (or extends `WhatsAppNotifier`) by sending Meta's specific Graph API payload:

```json
POST https://graph.facebook.com/<GRAPH_VERSION>/<PHONE_NUMBER_ID>/messages
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "<RECIPIENT_PHONE>",
  "status": "read",
  "message_id": "<INCOMING_MESSAGE_ID>",
  "typing_indicator": {
    "type": "text"
  }
}
```

* **Best-Effort Classification:** Per `CONTRIBUTING §11.6`, HTTP failures when triggering typing status are logged via `StageLoggerPort` as warnings and return `{ success: false }`. They NEVER throw or crash the caller.

### 4.3 MCOS Pipeline Integration (`application/pipeline/turn-processor.service.ts`)

Inside `TurnProcessor.process()`:

```
[Incoming User Turn]
       │
       ▼
[Load & Record Context]
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
[Fire Best-Effort Typing Indicator]      [Start 25s Timeout Watchdog]
       │                                         │
       ▼                                         │ (If duration >= 25s)
[LLM / Intent / Matching Workflows]              ▼
       │                                 [Send Interim Progress Update]
       │                                 [Re-trigger Typing Indicator]
       ├─── (Success) ──────────────┐            │
       │                            ▼            │
       │                   [Deliver Final Response]
       │                   (Auto-clears Typing)
       │
       └─── (Internal Exception / Failure)
               │
               ▼
       [Catch Exception Gracefully]
       [Deactivate Typing via Empathetic Error Message]
       [Log Stage Failure & Return Outcome]
```

---

## 5. Non-Functional Requirements & Safety Controls

1. **Zero Code/Functionality Breakdown:**
   * Existing workflow state machines (`Triage`, `VendorOnboarding`, `BuyerSearch`, `Recharge`) MUST NOT be altered or impacted.
   * `TurnProcessor` return signatures (`TurnOutcome`) remain unchanged.
2. **Channel Neutrality:**
   * Channels lacking typing indicator support (e.g. SMS, Voice, CLI) resolve `showTyping` as `{ success: true }` instantly without side-effects (`CONTRIBUTING §6.3`).
3. **Observability & Logging (`CONTRIBUTING §12.5`):**
   * Typing indicator actions must log under `COMPONENT = 'MCOS'` and `STAGE = 'TurnProcessor:Typing'` using the mandatory format:
     * **Input:** `{ conversationId, channel, messageId }`
     * **Action:** `"Triggered typing status indicator for active turn processing"`
     * **Output:** `{ success: true/false }`
4. **Idempotency & Concurrency (`CONTRIBUTING §9.2`):**
   * Typing heartbeat updates do not alter conversation state tables or mutate outbox records, avoiding lock contention during multi-worker processing.

---

## 6. Verification & Pre-Merge Quality Gate (`CONTRIBUTING §15 & §16`)

Before merging any implementation of this specification, the following verification steps MUST pass:

- [ ] **Unit Tests:** `TurnProcessor` unit tests verify:
  - Typing indicator is called upon starting an active turn.
  - 25s timeout triggers interim progress notification with empathetic copy.
  - Internal processing errors trigger the empathetic pleading error message and clear typing status.
  - Non-supported channels handle `showTyping` gracefully.
- [ ] **Fake Ports (§15.4):** `FakeTypingIndicatorAdapter` implemented for testing without real network calls.
- [ ] **Quality Gate (§16):**
  - `npm run lint` clean
  - `npm run typecheck` clean
  - `npm run test:unit` clean
  - `npm run build` clean
