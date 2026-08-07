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

---

## 8. Two production bugs from the 2026-08-07 local run

Both came out of one terminal log: a user said "hi", was asked "buying or selling?", tapped
**I want to sell** — and the reply never reached their phone.

### 8.1 The reply was silently lost: `WhatsApp send failed: fetch failed`

**Root cause.** `graph.facebook.com` publishes an AAAA record; this host has no default IPv6
route. Node 22 defaults to `verbatim` DNS ordering, hands the AAAA address to undici, and the
connection fails. Measured on the box:

| | GET success rate |
|---|---|
| `verbatim` (Node default) | **3/10** |
| `ipv4first` | **10/10** |

**Second finding, and the more important one.** Re-measuring later, even `ipv4first` POSTs failed
7/8 in one window and then recovered to 8/8. The upstream link to Meta from this host is
*intermittently unreliable independent of address family*. IPv4-first is a real improvement and
never measured worse — but it is not the whole fix, and I would have been wrong to report it as
one.

**Three changes:**

1. **`DNS_RESULT_ORDER`** (default `ipv4first`), applied in `main.ts` before any outbound call.
   Configurable rather than hard-coded, because `ipv4first` is wrong on an IPv6-only host; that
   operator sets `verbatim`.
2. **Retry with backoff and jitter** in `WhatsAppNotifier`, which is the load-bearing fix. This
   was the real gap: the LLM path has had retries and a circuit breaker since Phase 1, while the
   outbound channel — the last mile, with no queue behind it — had exactly one attempt.
3. **Surface `error.cause`.** `fetch` throws a bare `TypeError: fetch failed` and hides the reason
   underneath. Unwinding the chain is why the log now says `ETIMEDOUT` instead of four useless
   words. This is what made the bug hard to triage rather than hard to fix.

**Retry policy is deliberately narrow.** Only connection-phase failures and 429/5xx are retried —
cases that prove nothing was sent, or that Meta answered and definitively refused. A reset socket
or a client-side timeout mid-flight is ambiguous: Meta may have accepted and delivered. WhatsApp
offers no idempotency key, and sending a vendor two credit-deduction notices is worse than sending
none. Every other 4xx is a decision (bad token, invalid recipient, outside the 24-hour window) and
retrying only burns quota and delays an honest failure.

**Retries are bounded to 20s total**, below `CONVERSATION_LOCK_TTL_MS` (30s). Delivery runs inside
the turn that holds the conversation lock; unbounded retrying would let the lock expire mid-send
and a second worker pick up the same conversation. "Retry harder" must not become a concurrency
bug.

**Still not solved:** a sustained outage — the 7/8-failure window — still loses the reply. The
complete fix is a durable outbound queue (BullMQ is already in the stack for media), so a message
survives the process and retries over minutes rather than seconds. That is a real piece of work
and I have not done it; say the word.

### 8.2 The platform told a user a shipped feature did not exist

Tapping **I want to sell** answered *"Seller onboarding opens shortly, and I will walk you through
it right here when it does."* Onboarding shipped in Phase 2.

**Root cause.** Triage is designed to be superseded by priority — but only for *new* messages. The
tap resumed the parked Triage instance by id (discovery Layer 1), which never passes through
intent routing again, so priority could not help. Triage then answered from its Phase-1
placeholder table. Every one of those placeholders except `complaint` had become a lie.

**Fix: a `handoff` primitive on the workflow contract.** A state can now name an intent to hand
the turn to; the engine reports it, and `TurnProcessor` starts the workflow that owns it and runs
it in the same turn. Triage hands off `buyer_product_search`, `vendor_onboarding` and
`wallet_funding`, and keeps answering `complaint` itself because nothing else implements it.

This is the mechanism MCOS always implied ("Triage is designed to be replaced") but only ever
half-delivered. It is bounded to one hop, ignores a handoff that resolves back to the same
workflow, and keeps the placeholder text as the fallback for a deployment where nothing claims the
intent — so a workflow that hands off is still honest when there is nowhere to hand off to.

An existing test asserted "exactly one workflow instance" after this exchange. That expectation
was itself encoding the bug; it now asserts exactly one *Triage*, plus the workflow it handed to.

### 8.3 Verification

```
Unit:        291 passed, 27 suites
Integration: 108 passed,  7 suites
Lint + typecheck + build: clean
```

Both fixes have regression tests that I confirmed **fail without the fix** — the handoff test
reproduces the exact "opens shortly" string from your log, and the notifier tests reproduce the
undici `TypeError: fetch failed` / `AggregateError: ETIMEDOUT` shape.

---

## 9. The durable outbound queue

§8.1 closed with a gap I had not fixed: in-request retries ride out a blip, but a sustained
outage — the window where even IPv4 POSTs failed 7/8 — still lost the reply. This closes it.

### 9.1 Shape: write-ahead, not try-then-save

Every outbound message is persisted **before** the send is attempted. The inline attempt becomes
an optimisation; the row is the guarantee. The alternative — try first, save on failure — leaves
a window where a crash between the failed attempt and the insert loses the message, and it cannot
preserve ordering because a later reply may succeed inline while an earlier one is still queued.

This is the same pattern as the `OutboxEvent` + `OutboxRelay` pair the platform already uses for
domain events, applied to the last mile. Nothing new to learn: an interval sweep, a bounded batch,
an attempt ceiling, failures parked for an operator.

| Piece | Where |
|---|---|
| `OutboundMessage` model, backoff, attempt budget (pure) | `src/domain/models/outbound-message.ts` |
| Repository port | `src/domain/ports/outbound/outbound-message-repository.port.ts` |
| Postgres adapter, `FOR UPDATE SKIP LOCKED` claim | `prisma-outbound-message.repository.ts` |
| Write-ahead decorator | `src/adapters/outbound/channel/durable-channel-notifier.ts` |
| Sweeper | `src/application/delivery/outbound-delivery.sweeper.ts` |
| Table | migration `20260807180000_outbound_message_queue` |

Durability is applied by **wrapping every notifier in the registry factory**, not by changing
callers. `TurnProcessor`, `WalletNotifier` and `VendorFanoutNotifier` all send through the
registry, and "don't lose the message" is not a concern each of them should have to remember to
opt into.

### 9.2 Three decisions worth stating

**A queued message is late, not lost.** `DeliveryResult` gains `queued`, and callers branch on
`isAccepted(result)` rather than `delivered`. This matters beyond logging noise: `TurnProcessor`
records the assistant turn for a queued reply, because the user *will* receive it and the next
turn must not reason as though the platform stayed silent.

**Ordering is enforced, because a chat that answers the second question first reads as broken.**
`enqueue` reports, in the same transaction as the insert, whether the conversation already has an
older undelivered message; if so the inline attempt is skipped entirely and the sweep drains that
conversation in composition order. The sweeper applies the same rule — a conversation stops at its
first failure rather than delivering past it. The transaction is what makes this safe: two replies
composed concurrently for one conversation cannot both conclude they are first in line.

**Only unambiguous failures are queued.** The same analysis as §8.1 and reusing the same
classification: a connection refused proves nothing was sent; a socket reset mid-flight does not.
No channel here offers an idempotency key, so an ambiguous failure is parked rather than retried.
A partially delivered multi-part reply is likewise never replayed wholesale — the user would
receive the earlier parts twice.

**The claim is a lease, not a status.** `claimDue` pushes `next_attempt_at` forward under
`FOR UPDATE SKIP LOCKED` instead of moving rows to a `processing` state. Concurrent sweepers take
disjoint rows, and a worker that dies mid-batch strands nothing — the lease expires and the
message becomes due again. No reaper to write, no stuck state to explain.

Eight attempts on a jittered 5s-doubling schedule spans about ten minutes. I originally wrote
"roughly half an hour" in the doc comment; the test I wrote to pin that claim failed at 10.6
minutes, so I corrected the comment rather than the schedule. Ten minutes covers a transient
outage, and a conversational reply arriving half an hour late is often worse than one that never
arrives.

### 9.3 Verification

```
Unit:        317 passed, 30 suites   (was 291/27)
Integration: 121 passed,  8 suites   (was 108/7)
Lint + typecheck + build: clean
Boot: clean, migration applied
```

`test/integration/outbound-queue.test.ts` runs against real Postgres, because the two properties
that would corrupt a user's conversation if wrong are database properties, not code properties:
two concurrent sweepers claiming ten rows receive **disjoint** sets totalling exactly ten, and the
backlog check is transactional. The rest — backoff schedule, ordering, retry classification,
bookkeeping that never fails a delivered message — is unit-tested against an in-memory queue that
enforces the same rules.

### 9.4 What this still does not do

- **Nothing rescues a message past the attempt budget.** After ~10 minutes it is parked as
  `failed` and queryable, but there is no operator surface — the same gap as `failed` payment
  notifications (Credits §5).
- **Meta's 24-hour service window is unaffected.** A queued vendor ask that ages past the window
  will be rejected as a decision, not a blip, and parked. Template messages remain the fix.
- **The queue is per-database, not global.** Two deployments against separate databases would each
  drain their own; that is the intended topology, but worth stating.
