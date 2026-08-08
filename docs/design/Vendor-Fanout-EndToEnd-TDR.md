# TDR: Vendor Fan-Out End-to-End — WhatsApp Ask and Deterministic Reply Intake

## 1. Objective

Close the two missing contracts that keep demand-driven fulfilment from working end to end over WhatsApp: (a) fanned-out vendors are never *asked* — `RequestDistributionService.distribute()` writes `requestDelivery` rows and publishes `request.delivered`, but sends no message to the vendor's phone; and (b) a vendor's answer can never be *routed* — `recordVendorResponse()` (request-distribution.service.ts:452) is called from nowhere in the application code, so even a vendor who replied would be ignored.

This TDR defines the vendor-facing ask message, the deterministic button payload that carries the answer home, the inbound intake that turns a tap into a recorded response, and the exact wiring changes. The goal is a loop testable directly via WhatsApp: a buyer searches → matched vendors receive "Can you help?" buttons → a vendor taps yes → the buyer's next message presents that vendor.

## 2. Scope

**In scope**

- A reserved, non-instance workflow id and payload encoding for vendor replies (`mm|vendor-response|accept|<requestId>`).
- `VendorFanoutNotifier`: a best-effort outbound service that sends the ask message with two quick-reply buttons to every fanned-out vendor.
- `VendorResponseHandler`: a deterministic inbound intake that resolves a tapped button to `RequestDistributionService.recordVendorResponse()` and replies to the vendor.
- Changes to `RequestDistributionService.distribute()` so the fan-out loop loads vendor records, captures delivery ids, and triggers the ask.
- A hook in `TurnProcessor.process()` that intercepts vendor-response payloads before intent resolution.
- `vendor.notified` as a new domain event.
- Module wiring in `conversation.module.ts`.
- Unit + integration tests, including the WhatsApp pipeline path.

**Out of scope**

- Free-text vendor replies ("Yes I can help" typed rather than tapped). The intake is deterministic and button-only; typed answers continue to fall through ordinary routing. A text fallback can be layered on later behind the same resolver.
- Proactively pushing newly-revealed responders to the *customer* mid-search. The customer's BuyerSearch re-presents responders on their next message (existing behavior, buyer-search.workflow.ts:277-326); pushing between turns is a separate enhancement.
- Template-message handling for the 24-hour service window. The ask uses the same interactive-button delivery as the existing wallet pushes (wallet-notifier.service.ts) and accepts the same constraint; a rejection is logged and the delivery row simply times out honestly.
- Re-ranking or the fan-out strategy itself. Distribution strategy stays in `RequestDistributionService` (MCOS Refinement #11 §4).

## 3. How this feature fits the platform

MCOS Refinement #11 already specifies the loop (§1 stage list, §4 fan-out, §5 response collection, §6 visibility, §7 events). `RequestDistributionService` already implements the *state* side of it — request creation, immediate delivery, billing, `recordVendorResponse`, `revealedVendors`, the 30-minute timeout sweep — and `BuyerSearch` already implements the waiting and re-presentation states. What is missing is the *conversational* side: nothing talks to the vendor, and nothing hears their answer.

The design precedent is the wallet push system (Konnet Credits Recharge TDR §25.7): a listener composes a canonical `Response`, the channel adapter renders it, the send is best-effort and never throws, and state is committed before the message is attempted. This TDR follows the same pattern for the ask, and adds the missing inbound half: a deterministic button payload (mirroring the `system` reserved id in system-actions.ts) and an intake that routes it straight to the distribution service without an LLM call.

Key architectural rule preserved: the Conversation OS orchestrates, the fulfilment service owns delivery state. `TurnProcessor` gains a routing branch, not business logic — it delegates to `VendorResponseHandler`, which calls `recordVendorResponse`.

## 4. Terminology

- **Vendor ask / ask message** — the push that tells a fanned-out vendor a customer is looking for something they match, with two buttons.
- **Vendor response payload** — the `mm|vendor-response|accept|...` / `mm|vendor-response|decline|...` string carried in a button id and echoed back verbatim on a tap.
- **Intake** — the deterministic inbound handling of a vendor response payload.
- **Delivery row** — a `RequestDelivery` row: the per-(request, vendor) record of whether a fanned-out vendor has been asked, has answered, is revealed, and has paid.

## 5. Business flows

### 5.1 Outbound — the vendor ask

A buyer's search resolves and matches vendors. `BuyerSearch.ResolveDemand` calls `distribution.distribute(...)` (buyer-search.workflow.ts:209). Inside `distribute()`:

1. The immediate vendor is billed and revealed (existing, Konnet Credits Recharge TDR §25.6).
2. The remaining ranked vendors (up to `FANOUT_LIMIT` = 8) each get a `requestDelivery` row with status `pending` (existing, request-distribution.service.ts:314-324).
3. **Updated:** for each fanned-out vendor in the buyer's city or state, the service loads the `Vendor` record, captures the delivery row id, and enqueues an ask push. The push uses the strict **Resolved Product Name** and composes a canonical `Response`:

```text
New Customer Request

A customer in {City} is looking for {Resolved_Product_Name}

Can you fulfill this request?  
1. Yes, I have it  
2. No, I don't have it  
3. I can get it  
4. I can refer someone  
5. I don't sell this, not my line of business
```

The vendor may reply using interactive buttons, single numbers (`1` to `5`), text, or multi-option combinations separated by commas or dashes (e.g., `1, 3` or `1-4`).

4. The push is best-effort (never throws) and is awaited with the rest of the distribution pushes. On successful delivery it is recorded in the vendor's conversation history. A failed ask leaves the delivery row pending; the existing 30-minute sweep later records `request.timeout`.
5. `vendor.notified` is published for each successfully-sent ask, alongside the existing `request.delivered`.

### 5.2 Inbound — Vendor Response Processing (5 Options & Multi-Option Intake)

The vendor's phone receives the ask message. When the vendor replies via button tap, number, or text:

1. `TurnProcessor.process()` receives the message and invokes `VendorResponseHandler.tryHandle()`.
2. The payload or text is parsed to normalize multi-option selections (e.g., `1, 3` maps to `YES_HAVE_IT` and `CAN_GET_IT`).
3. **Execution by Option Category:**
   - **Option 1 ("Yes, I have it") & Option 3 ("I can get it"):**
     - Vendor Profile Card (Business name, City, Star rating, WhatsApp number, capability description) with interactive CTA `"Message Vendor"` (WhatsApp DM link) is sent to the buyer.
     - Product is saved to vendor inventory under the **Resolved Product Name**.
     - Evidence Service increments vendor capability confidence.
   - **Option 2 ("No, I don't have it"):**
     - System replies to vendor: `"ok, noted"`. Profile is NOT sent to buyer.
     - Evidence Service records temporary stock unavailability.
   - **Option 4 ("I can refer someone"):**
     - System prompts vendor asking for contact details (Name and WhatsApp number) of the referral.
     - Evidence Service records referral network capability.
   - **Option 5 ("I don't sell this, not my line of business"):**
     - System replies: `"Thank you for letting us know! We've updated our records..."`
     - System prunes vendor capability in CDE/CME scope.


The vendor's reply path never touches the customer's `BuyerSearch` instance. The delivery row is the shared state; the customer's next message picks up newly-revealed vendors.

### 5.3 Customer-side re-presentation

Unchanged (buyer-search.workflow.ts:277-326). When the customer next messages while `WaitingForVendorResponses`, `revealedVendors(requestId)` returns vendors with `revealedToCustomer: true` in rank order; fresh ones are presented with `select_vendor` buttons; a tap calls `recordSelection` and completes the search.

## 6. Component placement map

| Concern | Where it lives |
| --- | --- |
| Reserved id + payload resolver (pure) | `src/domain/workflows/vendor-response.ts` (new) |
| Ask push (best-effort outbound) | `src/application/fulfilment/vendor-fanout-notifier.service.ts` (new) |
| Inbound intake (deterministic) | `src/application/fulfilment/vendor-response-handler.service.ts` (new) |
| Fan-out loop change | `src/application/fulfilment/request-distribution.service.ts` |
| Turn-processor hook | `src/application/pipeline/turn-processor.service.ts` |
| Wiring | `src/config/conversation.module.ts` |

No changes to `prisma/schema.prisma`, the inbound/outbound channel adapters, `BuyerSearch`, `WorkflowManager`, or `WorkflowDefinitionRegistry`.

## 7. Data model

No schema changes. The existing tables already carry everything:

- `CustomerRequest` (id, conversationId, workflowId, customerId, query, capabilityId/Name, product, customerCity, status, expiresAt) — prisma/schema.prisma.
- `RequestDelivery` (requestId, vendorId, rank, score, immediate, status `pending|accepted|rejected|timeout`, revealedToCustomer, creditDeducted, deliveredAt, respondedAt, responseTimeMs) — one row per fanned-out vendor, keyed by the `requestId_vendorId` compound unique.

The intake mutates exactly one `RequestDelivery` row through the existing `recordVendorResponse` transaction; nothing new is persisted.

## 8. Domain — reserved id and payload resolver

### 8.1 `src/domain/workflows/vendor-response.ts` (new)

Mirrors `system-actions.ts`. `system` is the reserved id for buttons that start something new; `vendor-response` is the reserved id for buttons that answer a distribution, and it must never collide with a real workflow instance id (instance ids are UUIDs, so it cannot).

```ts
export const VENDOR_RESPONSE_WORKFLOW_ID = 'vendor-response';

export interface VendorResponseAction {
  readonly requestId: string;
  readonly accepted: boolean;
}

export function resolveVendorResponse(interactivePayload: string | null): VendorResponseAction | null {
  if (interactivePayload === null) return null;

  const decoded = decodeActionPayload(interactivePayload);
  if (decoded === null || decoded.workflowId !== VENDOR_RESPONSE_WORKFLOW_ID) return null;
  if (decoded.action !== 'accept' && decoded.action !== 'decline') return null;
  if (decoded.value === undefined || decoded.value.length === 0) return null;

  return { requestId: decoded.value, accepted: decoded.action === 'accept' };
}
```

- Payload size: `mm|vendor-response|accept|<36-char uuid>` ≈ 68 bytes, well under `MAX_PAYLOAD_BYTES` (256, action-payload.ts:16).
- `decodeActionPayload` already rejects anything the platform did not mint, so a user typing `mm|vendor-response|...` as plain text is never trusted (action-payload.ts:61-71).
- A wrong action (`confirm`, `recharge`, ...) or a missing value returns `null` → the tap falls through to ordinary routing; it is never read as an accept or decline (V7).

## 9. Application layer

### 9.1 `src/application/fulfilment/vendor-fanout-notifier.service.ts` (new)

A best-effort push service, deliberately the same shape as `WalletNotifier.push` (wallet-notifier.service.ts:224-284):

```ts
@Injectable()
export class VendorFanoutNotifier {
  constructor(
    @Inject(CHANNEL_NOTIFIER_REGISTRY) private readonly notifiers: ChannelNotifierRegistryPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly context: ConversationContextManager,
    private readonly config: AppConfigService,
  ) {}

  async notifyVendor(params: {
    requestId: string;
    vendor: Vendor;              // userId, conversationId, businessName, location.city
    capabilityName: string;
    customerCity: string | null;
    fee: number;
    deliveryId: string;
  }): Promise<void>;             // total by contract: never throws
}
```

Composes the ask `Response` from §5.1 (text + the two `vendor_response` actions), then:

1. `supports('whatsapp')` guard — same degradation as `WalletNotifier` (`Unsupported channel: whatsapp`, logged, return).
2. `notifiers.forChannel('whatsapp').send({ channel: 'whatsapp', address: vendor.userId, conversationId: vendor.conversationId }, response)`.
3. On success: `context.recordAssistantTurn(...)` so the vendor's next turn sees the ask in history; publish `vendor.notified` (with `requestId`, `vendorId`, `deliveryId`); `stage` log.
4. On rejection/failure: `stageFailed` log; **no** `vendor.notified`; return. Distribution is already committed — nothing rolls back (V1).

The notifier is published to `pushes` inside `distribute()` and awaited via `Promise.allSettled` with the existing wallet pushes (request-distribution.service.ts:373).

### 9.2 `src/application/fulfilment/vendor-response-handler.service.ts` (new)

The deterministic intake:

```ts
@Injectable()
export class VendorResponseHandler {
  constructor(
    @Inject(VENDOR_REPOSITORY) private readonly vendors: VendorRepositoryPort,
    private readonly distribution: RequestDistributionService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  /** Returns the reply to send, or null when the payload is not a vendor response. */
  async tryHandle(params: {
    conversation: Conversation;
    interactivePayload: string | null;
  }): Promise<Response | null>;
}
```

`tryHandle` logic:

1. `resolveVendorResponse(payload)` → `null` → return `null` (turn continues normally).
2. `vendors.findByUserId(conversation.userId)` → `null` → `stageFailed` ("vendor-response payload tapped by a non-vendor") and return the inert reply `"This link is no longer active."`. A payload minted for a vendor is inert for anyone else (V4).
3. `distribution.recordVendorResponse({ requestId, vendorId, accepted })`:
   - returns `null` (delivery gone, already answered, or timed out) → `stage` log and reply `"This request is no longer open — no action needed. Thanks anyway."` (V3).
   - returns `{ revealed: true }` → reply `"You're in — your profile has been sent to the customer. Get ready for their call or message."`
   - returns `{ revealed: false }` for an accept → reply `"Thanks for accepting. Your profile wasn't shared this time — please check your messages for the reason, and recharge so the next one reaches you."` The detailed insufficient-credits push with the recharge button is already sent by `WalletNotifier.notifyInsufficient(responder)` inside `recordVendorResponse` (request-distribution.service.ts:580-589); this reply just confirms the tap was heard.
   - decline → reply `"No problem — I've let the customer know you're not available this time."`

No LLM, no workflow instance, no intent resolution. The existing `recordVendorResponse` publishes `request.accepted`/`request.rejected` and the billing events, so the Evidence Service sees the answer exactly as it does today.

### 9.3 Changes to `RequestDistributionService.distribute()`

The fan-out loop (request-distribution.service.ts:314-333) gains:

1. `vendors.findById(rankedVendor.vendorId)` for each fanned-out vendor. A vendor that no longer exists is skipped entirely — no delivery row, no `request.delivered`, no ask — since a vendor who cannot be asked cannot respond, and a pending row for them would only become a spurious `request.timeout` (V2).
2. Capture the created `requestDelivery.id` as `deliveryId`.
3. `pushes.push(this.fanout.notifyVendor({ requestId, vendor, capabilityName, customerCity: params.customerCity, fee, deliveryId }))`.
4. The notifier publishes `vendor.notified` itself on successful delivery (§9.1 step 3), so `distribute()` adds no event of its own for the ask.

The immediate-delivery path and the missed-lead path are unchanged.

## 10. Pipeline change — `TurnProcessor.process()`

Insert the intake immediately after the empty-text guard (turn-processor.service.ts:122-124), before continuity analysis:

```ts
const vendorResponse = await this.vendorResponses.tryHandle({
  conversation,
  interactivePayload: input.interactivePayload,
});

if (vendorResponse !== null) {
  await this.send(conversation, vendorResponse, null);
  await this.context.touch(conversation.id, message.channel);
  return { response: vendorResponse, workflowId: null };
}
```

Why this position:

- The button tap always yields non-empty text (the title becomes a text artifact), so the guard cannot eat it — but the check must still come first because the payload is decisive; continuity analysis and intent resolution are unnecessary and would only cost an LLM call.
- `send()` already delivers and records the assistant turn (turn-processor.service.ts:470-526), mirroring the system-action short-circuit (turn-processor.service.ts:140-147).
- The vendor's tap was already recorded as a user turn at the top of `process()` (turn-processor.service.ts:114-118), so history is complete on both sides.
- `context.touch` mirrors what `finalise()` does for ordinary turns (turn-processor.service.ts:443), keeping idle-expiry accounting correct.

The vendor's active workflow, if any, is untouched: the intake bypasses routing, so nothing is suspended or resumed.

## 11. Events

| Event | Producer | When | Carries |
| --- | --- | --- | --- |
| `request.delivered` | `RequestDistributionService` | existing, per fan-out vendor | requestId, vendorId, `immediate: false` |
| `vendor.notified` | `VendorFanoutNotifier` | **new**, ask delivered | requestId, vendorId, deliveryId, conversationId |
| `request.distributed` | `RequestDistributionService` | existing, when fannedOut > 0 | requestId, vendorCount |
| `request.accepted` / `request.rejected` | `RequestDistributionService` | existing, from `recordVendorResponse` | requestId, vendorId, responseTime |
| `request.timeout` | `RequestDistributionService` | existing, sweep | requestId, vendorId |
| `vendor.credit.deducted` / `vendor.credit.insufficient` | `RequestDistributionService` | existing, billing paths | requestId, vendorId, credits/fee |

`vendor.notified` is the concrete spelling of MCOS Refinement #11 §7's `VendorNotified`. All envelopes follow the Standard Marketplace Event Model (event-publisher.port.ts:17-29).

## 12. Configuration

No new environment variables. The existing constants govern the flow:

- `FANOUT_LIMIT = 8` and `RESPONSE_WINDOW_MS = 30 * 60 * 1000` (request-distribution.service.ts:44-47).
- `visibilityFee` from `config.credits.visibilityFee` (already used for the ask's fee copy).

The ask copy and button titles are constants in `VendorFanoutNotifier`, like the wallet push copy.

## 13. Module wiring — `src/config/conversation.module.ts`

- Add `VendorFanoutNotifier` and `VendorResponseHandler` to the `providers` array (conversation.module.ts:64-84).
- `RequestDistributionService` already a provider; add `VendorFanoutNotifier` to its constructor (Nest injects from the module scope; `CHANNEL_NOTIFIER_REGISTRY`, `VENDOR_REPOSITORY`, `EVENT_PUBLISHER`, `CLOCK`, `STAGE_LOGGER` are all already resolvable here).
- `TurnProcessor` already a provider; add `VendorResponseHandler` to its constructor.
- No new tokens, no new modules, no exports.

## 14. Error handling & graceful degradation

| # | Failure | Behaviour | Never |
| --- | --- | --- | --- |
| V1 | Ask push fails for a vendor (network / channel rejection / no notifier) | Best-effort: `stageFailed`, no `vendor.notified`, delivery row stays `pending` and later times out honestly | Roll back distribution, retry loop, block the buyer's turn |
| V2 | Fanned-out vendor no longer exists | Skips the ask, the delivery row and `request.delivered` for them | A dead pending row / spurious `request.timeout` |
| V3 | Tap on a delivery no longer `pending` (already answered, or timed out) | `recordVendorResponse` returns `null`; "This request is no longer open" reply; nothing mutated | Second charge, double reveal |
| V4 | Vendor-response payload tapped by a non-vendor conversation | `stageFailed`, inert "This link is no longer active." reply | Mutating someone else's delivery |
| V5 | Accept but insufficient balance | Existing E17 path: `request.accepted` recorded honestly, vendor **not** revealed, `vendor.credit.insufficient` + responder missed-lead push; handler gives the brief acknowledgment | Revealing an unbilled responder / negative balance |
| V6 | Accept debit duplicated by a crash | `billResponder` `duplicate` branch: no second debit, reveal proceeds (existing, request-distribution.service.ts:593-596) | Double debit |
| V7 | Malformed/unknown vendor-response payload | `resolveVendorResponse` returns `null`; the turn routes normally, never read as accept/decline | An arbitrary tap spending a vendor's credit |
| V8 | Reply to the vendor fails after their response was recorded | Response already committed (status/reveal/ledger); `stageFailed`; vendor sees the result next turn | Rolling back a recorded response over a push |

## 15. Idempotency & exactly-once

- **Duplicate taps**: the delivery's `status` guard in `recordVendorResponse` makes the second tap a no-op reply; the ledger's unique `providerReference` (`responseDebitReference(requestId, vendorId)`) independently prevents a double debit.
- **Duplicate webhook deliveries** of the same tap: `MessageIngestionService` dedupes by provider message id (message-ingestion.service.ts:77-98), so the turn runs once.
- **Failed asks**: not retried by design. The ask is a notification, not a state transition; a retry would only re-mint buttons. A vendor never asked is honestly recorded as `request.timeout`.

## 16. Security

- The reserved `vendor-response` id cannot collide with workflow instances (UUIDs).
- A tap can only mutate the delivery of the vendor whose conversation received the button: `findByUserId` resolves the identity, and `recordVendorResponse` keys on the `requestId_vendorId` compound — the payload's `requestId` alone grants nothing.
- The reply path makes no LLM call, so there is no prompt-injection surface on the intake.
- Inbound signature verification and the always-200 webhook contract are unchanged.

## 17. Clean code & boundary compliance

- `TurnProcessor` stays an orchestrator: it gains a branch that delegates to `VendorResponseHandler`; billing and delivery-state logic remain in `RequestDistributionService`.
- `VendorFanoutNotifier` is total by contract (never throws), exactly like `WalletNotifier`.
- The resolver is a pure function (`vendor-response.ts`) like `system-actions.ts`.
- No workflow instance is minted for a vendor response: it is a marketplace action, not a conversational objective.
- Distribution strategy and response semantics remain owned by the fulfilment service; the Conversation OS only carries the message.

## 18. Testing plan

### 18.1 Unit (`src/**/*.spec.ts`, no network)

- `vendor-response.ts`: round-trip encode/decode of accept and decline payloads; rejects a non-`vendor-response` workflow id, unknown action, missing value, and a non-`mm` payload; `null` in → `null` out.
- `VendorFanoutNotifier`: renders the ask text + two buttons with the exact payloads; guards on `supports('whatsapp')`; best-effort when the channel rejects (no throw); records the assistant turn on success.
- `VendorResponseHandler`: accept → revealed reply; accept with insufficient credits → not-revealed reply; decline → decline reply; delivery not pending → "no longer open" reply; non-vendor conversation → inert reply; non-vendor-response payload → `null`.

### 18.2 Integration (`test/**/*.test.ts`, real Postgres/Redis, per README)

- Extend `test/integration/marketplace-loop.test.ts`: after `distribute` with several vendors, drive a fanned-out vendor's acceptance through the handler path — delivery flips to `accepted`, `revealedVendors` includes them, the wallet is debited, and `request.accepted` is published. Repeat for decline (hidden, no debit) and for a stale tap (no-op).
- Extend `test/integration/whatsapp-pipeline.test.ts`: enqueue an inbound `button_reply` message whose payload is a vendor-response payload against the vendor's conversation; assert the deterministic reply is delivered and the `RequestDelivery` row flips.

### 18.3 Commands the engineer must run green

```text
npm run typecheck
npm run lint
npm test
npm run test:int
```

## 19. Implementation checklist (ordered)

1. `src/domain/workflows/vendor-response.ts` — reserved id + resolver (+ unit spec).
2. `src/application/fulfilment/vendor-fanout-notifier.service.ts` — ask push (+ unit spec).
3. `src/application/fulfilment/vendor-response-handler.service.ts` — intake (+ unit spec).
4. `request-distribution.service.ts` — fan-out loop: load vendor, capture `deliveryId`, skip missing vendors, enqueue ask; publish `vendor.notified`.
5. `turn-processor.service.ts` — intake hook after the empty-text guard.
6. `conversation.module.ts` — register the two providers and wire the two constructors.
7. Integration tests (marketplace-loop + whatsapp-pipeline).
8. `npm run lint`, `npm run typecheck`, `npm run test:int` green.

## 20. Acceptance criteria

Testable directly via WhatsApp:

1. A buyer's search fans out an ask message with two buttons to every matched vendor beyond the immediate one.
2. Tapping **Yes, I have it** records the acceptance, bills the visibility fee (existing rule), reveals the vendor to the customer, and replies to the vendor.
3. Tapping **I don't have it now** records the decline; the vendor stays hidden; the vendor gets the decline reply.
4. The customer's next message presents every responder with `select_vendor` buttons; tapping one completes the search (existing behavior).
5. Re-tapping an answered or expired button replies "no longer open" and never double-charges.
6. A failed ask push never rolls back distribution or blocks the buyer's turn; it is logged and the delivery times out honestly.
7. `vendor.notified`, `request.accepted`/`rejected`, and `request.timeout` are all published for downstream Evidence Service consumption.

## 21. Out of scope / decisions to confirm with product

- **Free-text replies.** Button-only for now; the resolver makes a later text fallback cheap.
- **Proactive customer re-presentation.** Today the customer sees responders on their next message. If product wants the platform to ping the customer the moment a responder appears, that is a new push (customer-side) with its own copy and 24-hour-window considerations.
- **Template-based asks.** The ask uses interactive messages like the wallet pushes; Meta's 24-hour service-window rules apply. Template messages with buttons are a channel-layer upgrade and can be layered in without touching the intake.
- **Hardening note:** `BuyerSearch.WaitingForVendorResponses` reads `interactivePayload.split('|')[3]` as a chosen vendor id without checking the action is `select` (buyer-search.workflow.ts:288-291). Harmless today because only `select_vendor` buttons are sent to customers, but worth asserting `select` when the customer-side re-presentation is next touched.
