# Vendor Fan-Out End-to-End — Implementation Report

**Date:** 2026-08-07
**Spec:** [`docs/design/Vendor-Fanout-EndToEnd-TDR.md`](design/Vendor-Fanout-EndToEnd-TDR.md)
**Status:** Implemented and tested end to end over the real webhook path. Not yet exercised
against a live WhatsApp number.

---

## 1. What was broken

The demand-driven loop had a hole in the middle. `distribute()` wrote a `requestDelivery` row for
every fanned-out vendor and published `request.delivered` — and then nothing happened. No message
reached the vendor's phone, and `recordVendorResponse()` was called from nowhere in the
application. So the only reachable outcome for a fanned-out vendor was the 30-minute timeout,
which the Evidence Service then recorded as `no_response`, polarity −1.

The platform was quietly building a reputation system out of silence it had never asked for.

Both halves now exist: the ask goes out, the tap comes back.

---

## 2. Architecture fit — verified, then tuned

This TDR was written against the current code and cites live line numbers, so most of it checked
out directly. Every claim I verified:

| TDR claim | Verified |
|---|---|
| `button_reply.id` → interactive part | ✓ whatsapp-payload.mapper.ts:210–214 |
| Ingestion extracts the payload | ✓ `interactivePayloadOf`, message-ingestion.service.ts:237 |
| The button title becomes the turn's text, so the empty-text guard cannot eat the tap | ✓ `collectText` over text artifacts |
| `decodeActionPayload` rejects anything unminted | ✓ action-payload.ts:61 |
| `vendor-response` cannot collide with an instance id | ✓ instance ids are UUIDs |
| Everything the new services need is already resolvable in `ConversationModule` | ✓ no new tokens, no new module |
| No schema change needed | ✓ `RequestDelivery` already carries the whole state machine |
| Unknown event types are harmless to the Evidence Service | ✓ `signalsFor` returns `[]` |

Four changes to what the TDR specified.

**① A bug the fan-out would have made much worse.** The timeout sweep selected
`{ status: 'pending' }` — and an *immediate* delivery is also created `pending`. That vendor was
billed and shown to the customer without ever being asked a question, so thirty minutes later the
sweep was publishing `request.timeout` against them, which the Evidence Service reads as
`no_response`, polarity −1. Every immediate delivery was quietly damaging the reputation of the
best-matched vendor on the platform. The sweep now takes `immediate: false` only: silence is
evidence only where there was a question. Pre-existing, but squarely inside this feature's blast
radius, and there is a regression test that fails without the fix.

**② Vendor records are resolved once, concurrently.** §25.6 already did a `findById` per
candidate in the billing walk, and §9.3 asks for another per fanned-out vendor — up to eighteen
sequential round trips on the buyer's turn, for records a single pass already has. One
`Promise.all` up front builds a map both loops read. Absence from the map *is* "cannot be
contacted", which is exactly the condition V2 asks about.

**③ The ask states the fee.** The TDR's copy mentions the fee only in a conditional aside. A
vendor tapping "Yes, I have it" is agreeing to be charged 100 credits, and learning that
afterwards from the deduction notice would be a worse product than one more line of text. The ask
now says plainly: *"If you accept, the visibility fee (100 credits) is charged and your profile is
sent to them."*

**④ The `select` hardening from §21, done rather than deferred.**
`BuyerSearch.WaitingForVendorResponses` read `interactivePayload.split('|')[3]` as a vendor id
without checking the action. Any other button's fourth segment would have been recorded as a
customer selection — and `vendor.selected` is the strongest signal the Evidence Service accepts,
so a wrong one is expensive to unlearn. It now requires `action === 'select'`. One line, and this
change adds a second button type to vendor-facing conversations, which is exactly the context the
TDR said to fix it in.

One deliberate agreement worth naming: the asks are **awaited** with the wallet pushes rather than
fired and forgotten. Up to eight concurrent sends add a few hundred milliseconds to the buyer's
reply — a turn that already spends seconds in LLM calls — and in exchange the ask cannot be lost
to a process shutdown, and the behaviour is deterministic enough to test.

---

## 3. What ships

| Piece | Where |
|---|---|
| Reserved id + payload codec (pure) | `src/domain/workflows/vendor-response.ts` |
| The ask push (best-effort, never throws) | `src/application/fulfilment/vendor-fanout-notifier.service.ts` |
| The tap intake (deterministic, no LLM) | `src/application/fulfilment/vendor-response-handler.service.ts` |
| Fan-out loop: resolve, skip, ask | `request-distribution.service.ts` |
| Timeout sweep fix | `request-distribution.service.ts` |
| Turn-processor intake branch | `turn-processor.service.ts` |
| `vendor.notified` registered as non-bearing | `evidence-interpretation.ts` |
| `select` action assertion | `buyer-search.workflow.ts` |
| Wiring | `conversation.module.ts` |

No schema change, no new environment variable, no new module, no change to the channel adapters.

---

## 4. The two properties that make it safe

**A tap can only ever affect the vendor who received it.** The payload names a request; it does
not name who is answering. Identity comes from the conversation
(`vendors.findByUserId(conversation.userId)`), and `recordVendorResponse` keys on the
`(requestId, vendorId)` compound unique. A leaked or copied button is inert in anyone else's
hands — tested, and the delivery row stays `pending`.

**Nothing unrecognised is ever read as an accept.** An accept spends the vendor's credits and
reveals them to a stranger, so the resolver returns `null` for every payload it does not
positively recognise — wrong workflow id, wrong action, missing request id, plain text that
happens to look like a payload — and `null` means "route this turn normally", never "assume
decline". There is no LLM anywhere on the path, so there is no prompt-injection surface and no way
for a model having an off day to answer on a vendor's behalf.

Idempotency comes from two independent mechanisms, either of which would be sufficient: the
delivery's `status` guard makes a second tap a no-op, and the ledger's unique
`response:<requestId>:<vendorId>` reference independently prevents a second debit.

---

## 5. Verification

```
Unit:        273 passed, 25 suites   (was 251/22)
Integration: 106 passed,  7 suites   (was  92/7)
Lint + typecheck + build: clean
Boot: clean — /webhooks/whatsapp, /health, /webhooks/paystack
```

The `whatsapp-pipeline` tests drive the whole path in production code: a signed Meta
`button_reply` webhook in, the payload mapper, the ingestion service, the turn processor's intake
branch, `recordVendorResponse`, the debit, and the outbound reply — with only the LLM, the channel
and the media queue faked at the edges.

- **Tapped Yes** → billed, `revealedToCustomer: true`, balance 2000 → 1900, and the vendor gets two
  messages: the deduction notice and the confirmation.
- **Insolvent Yes** → acceptance recorded honestly, never revealed, balance untouched. The full
  explanation comes from the wallet push; the handler only confirms the tap was heard.
- **Tapped No** → `rejected`, hidden, nothing charged, and **zero LLM operations** on the turn.
- **No workflow instance is created** for a vendor reply.
- **Stale tap** (already answered or timed out) → "no longer open", nothing mutated.
- **Non-vendor tap** → inert reply, delivery untouched.

And in `marketplace-loop`, against real Postgres and the real wallet:

- Every fanned-out vendor is asked; the immediate vendor is not (they are already in front of the
  customer — asking would be noise).
- A vendor who no longer exists gets no delivery row at all, so no spurious timeout can be
  manufactured for them.
- A tapped Yes flows all the way to `accepted` evidence via the Evidence Service.
- Only vendors who were actually asked can time out.

---

## 6. Trying it on a real phone

1. Onboard a vendor (they receive 2,000 free credits automatically).
2. Onboard a second vendor with the same capability.
3. From a third number, search for what they sell.
4. The top-ranked vendor is delivered to the buyer and charged; the second receives
   **"A customer near … is looking for …"** with **Yes, I have it** / **I don't have it**.
5. Tap **Yes** → the deduction notice and *"You're in"* arrive.
6. Message the platform again as the buyer → the responder is presented with a select button.

---

## 7. Flags for you

- **The 24-hour service window is the real-world limiter.** The ask is an interactive message, not
  a template, so Meta will reject it for any vendor who has not messaged the business in the last
  24 hours. In production that is most vendors most of the time. The failure is handled correctly
  — logged, no `vendor.notified`, honest timeout — but the *feature* is limited until approved
  template messages with buttons are added at the channel layer. §21 lists it as out of scope; it
  is the single biggest gap between this working in test and working in the market.
- **Free-text replies still fall through.** A vendor who types "yes I have it" instead of tapping
  routes as an ordinary message. The resolver makes a text fallback cheap to add later; §21 has it
  as a product decision.
- **The customer is not pinged when a responder appears.** They see responders on their next
  message (unchanged). Pushing between turns is a separate customer-side notification with its own
  window considerations.
- **At most three buttons per WhatsApp message.** The ask uses two, so there is exactly one slot
  left if you ever want a third option ("Ask me later").
