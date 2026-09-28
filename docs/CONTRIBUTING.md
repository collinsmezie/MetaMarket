# Contributing to MetaMarket — Design & Engineering Standards

**Status:** Mandatory. Applies to every change: new feature, refactor, one-line fix, generated
or hand-written, human or AI.

This document expands [`Execution.md §2`](Execution.md) (Mandatory Clean Code Design Principles)
and [`docs/architecture/ADR-001`](docs/architecture/ADR-001-Hexagonal-Architecture.md) into rules
you can apply and a reviewer can check. Those two are the constitution; this is the case law.

Rules are numbered so code comments can cite them, the way the codebase already cites
`Execution.md §2.5` and `MCOS §15`. Write `CONTRIBUTING §5.2` in a comment when a line exists
because of a rule — that is how a rule survives the next refactor.

Many rules carry a **Why** drawn from a defect that actually reached the running platform. They
are not hypothetical. A rule with a scar is a rule people keep.

### Contents

| | |
|---|---|
| §1 | The one-paragraph version |
| §2 | **The contribution workflow** — the sequence every change follows |
| §3 | Architecture: layering and the hexagon |
| §4 | Domain-Driven Design: contexts, language, aggregates |
| §5 | Event-driven design |
| §6 | SOLID, applied here |
| §7 | Sanctioned patterns — and banned ones |
| §8 | Size and responsibility |
| §9 | Concurrency, idempotency and money |
| §10 | Data and persistence |
| §11 | Correctness rules that have already cost us |
| §12 | Types, errors and observability |
| §13 | Workflows |
| §14 | Security |
| §15 | Testing |
| §16 | The quality gate |
| §17 | Enforcement status |
| §18 | Pre-merge checklist |
| §19 | A note on generated code |

---

## 1. The one-paragraph version

Dependencies point inward. The domain knows nothing about the outside world. Every external
thing sits behind a port. Each bounded context owns its data and talks to the others through
events. Money and user-visible promises are never decided by an LLM. Never tell a user something
that is not true. Leave the quality gate green.

---

## 2. The contribution workflow

Follow this sequence. The gates exist because the expensive mistakes in this codebase were all
made by skipping straight to step 4.

### 2.1 Understand before you change
Read the spec section that governs the area (`docs/design/*`, `Execution.md`, the relevant TDR)
**and** the code that implements it. If they disagree, that disagreement is your first finding —
raise it rather than silently picking one.

### 2.2 Locate the seam
Name, before writing anything:

- which **bounded context** (§4.1) owns this behaviour;
- which **layer** the change belongs in (§3);
- which **port** it needs, if it touches anything external (§3.5);
- what **already exists** that you should extend rather than duplicate.

If the change spans two contexts, the answer is almost always an event (§5), not a new import.

### 2.3 Design the seam before the implementation
Write the port, the type, or the state transition first. A discriminated union or an interface
settles most design arguments in ten lines, before there is code to be attached to.

**Gate:** if you cannot express the change as a small addition to an existing abstraction, stop
and say so. That is a signal about the abstraction, and it is cheap now and expensive later.

### 2.4 Implement the smallest correct thing
Extend by adding a collaborator, not by growing the caller (§8.3). Match the surrounding style,
comment density and idiom.

### 2.5 Verify against reality, not just types
Run the gate (§16). For anything touching money, concurrency or delivery, prove the property —
a regression test that fails without your fix, or a live run against the real dependency.

### 2.6 Leave the reasoning behind
Comment the **why**, never the what. Cite the rule or spec section. Update the spec if behaviour
changed. If you found a defect on the way, fix it or record it — never leave it silently.

### 2.7 Review your own diff before anyone else does
Read every hunk. Ask of every deletion: *was that intended?* Removed behaviour is the most
common accidental damage in this repo (§19).

---

## 3. Architecture: layering and the hexagon

```
  adapters/inbound  ──►  application  ──►  domain  ◄──  application  ◄──  adapters/outbound
        (translate)        (orchestrate)    (decide)                          (execute)
                                   ▲
                                config/  (wiring only — no logic)
```

### 3.1 Dependencies point inward, always
`domain` may import only from `domain`. Never `adapters`, `application`, `config`, or any
framework, driver or SDK (`@nestjs/*`, `@prisma/*`, `ioredis`, `openai`, `express`, …).

*Enforced:* ESLint on `src/domain/**`. Currently clean — keep it that way.

### 3.2 `application` must not import `adapters`
An application service importing a concrete adapter has welded the platform to that technology.
Depend on a port and let `config/` inject the implementation.

*Known violation:* `RequestDistributionService` imports `PrismaService`. It is the only one. Do
not add a second; prefer to remove it when you next touch that file. *Not yet enforced* — §17.

### 3.3 Adapters translate; they do not decide
An inbound adapter maps a provider payload to a canonical model and calls an inbound port. No
workflows, no LLM calls, no business decisions. *Enforced* on `src/adapters/inbound/**`.

### 3.4 `config/` is wiring, not logic
Modules, factories, DI tokens. If a factory contains a branch a product person would have an
opinion about, it belongs in `application`.

### 3.5 Every external dependency goes behind a port
Database, LLM, channel, payment provider, queue, clock, id generator. The test: *could this ever
be swapped, mocked, or fail?* If yes, port it.

**Why:** because we honoured this, swapping Paystack is four adapter files — the entire domain and
application layers contain two references to it, one a log string.

### 3.6 Put each concept where it belongs
Pure functions over canonical models → `domain/models`. State machines → `domain/workflows`.
Contracts → `domain/ports`. Orchestration → `application`. I/O → `adapters`.

A helper predicate over a DTO belongs in `domain/models`, not in the port file that declares the
DTO. A port is a contract; adding functions blurs what an implementer must provide.

---

## 4. Domain-Driven Design

### 4.1 Respect the bounded contexts
The platform has six. Each owns its language, its rules and its data:

| Context | Code | Owns |
|---|---|---|
| **MCOS** — Conversation OS | `application/{pipeline,conversation,understanding,response,workflow}` | Conversations, turns, workflow lifecycle, routing |
| **CDE** — Capability Discovery | `application/capability` | Vendor Capability DNA, beliefs, onboarding understanding |
| **CME** — Capability Matching | `application/matching` | Demand understanding, retrieval, ranking |
| **Evidence** | `application/evidence` | Marketplace behaviour → trust scores |
| **Fulfilment** | `application/fulfilment` | Requests, deliveries, fan-out, visibility billing |
| **Wallet** | `application/wallet` | Credits, ledger, funding, grants |

These names are already the log `COMPONENT` prefixes. Keep them aligned.

### 4.2 A context never reaches into another's data
Cross-context communication happens through a **domain event** (§5) or an **injected port** —
never by querying another context's tables. A context that reads another's schema is coupled to
its storage decisions forever.

### 4.3 Ubiquitous language — use the platform's words
These terms have precise meanings. Use them in code, comments, logs and user-facing copy. Do not
invent synonyms.

*Capability DNA*, *belief*, *evidence*, *information density*, *archetype*, *demand object*,
*ranked vendor*, *request*, *delivery*, *fan-out*, *reveal*, *visibility fee*, *credit*, *grant*,
*wallet*, *turn*, *workflow instance*, *handoff*, *fallback envelope*.

If you need a new term, define it in the relevant spec first. A concept with two names becomes two
concepts within a month.

### 4.4 Model the domain, do not anaemically describe it
Business rules belong on the domain model as pure functions over canonical types — not scattered
across services. `toCredits`, `nextOutboundAttemptAt`, `proximityScore`, `computeEvidenceScore`
are the pattern: total, deterministic, unit-testable without a database.

A service that reaches into a model's fields to compute something the model should know is a
missing domain function.

### 4.5 Aggregates and transaction boundaries
The aggregates are **Conversation** (with its workflow instances), **Vendor** (with its DNA and
evidence), **CustomerRequest** (with its deliveries), and **Wallet** (with its ledger).

- One transaction should modify one aggregate. Where we knowingly cross — the credit transaction
  also settles the payment notification — the reason is documented at the call site.
- Consistency *across* aggregates is eventual, via events. Do not reach for a distributed
  transaction.
- A transaction is owned entirely by the adapter. **Never pass a transaction handle across a
  port** — it leaks the driver into the domain and lets a caller perform half an atomic
  operation. Express the whole operation as one port method instead (`creditAtomically`,
  `debitAtomically`).

### 4.6 Value objects over primitives for domain concepts
Credits, kobo, confidence, densities and statuses are domain concepts. Prefer named types and
`as const` unions to bare `number` and `string`. `WALLET_DEBIT_REASONS`, `InformationDensity`,
`OutboundMessageStatus` are the pattern.

### 4.7 Adapters are the anti-corruption layer
A provider's shape stops at the adapter. Meta's `button_reply`, Paystack's nested
`dedicated_account`, an LLM's raw JSON — all become canonical models before crossing inward. If a
provider field name appears in `domain` or `application`, the layer leaked.

---

## 5. Event-driven design

### 5.1 Contexts integrate through events, not calls
`Execution.md §2.6`. When something happens that another context may care about, publish a fact.
Do not import that context's service to tell it what to do.

**Why:** the wallet grants onboarding credits by subscribing to `seller.onboarded`. The Capability
Discovery Engine has no idea the wallet exists, and "successfully onboarded" means exactly one
thing across the platform.

### 5.2 Use the standard envelope
Every event is a `DomainEvent`: `eventId`, `eventType`, `timestamp`, `producer`, `payload`, plus
whichever correlation ids apply (`conversationId`, `workflowId`, `vendorId`, `customerId`,
`requestId`). Correlation ids are how anything is traceable afterwards — set the ones you have.

### 5.3 Events are facts, not commands
Name what happened, in the past: `wallet.debited`, `seller.onboarded`, `vendor.notified`. Never
name an instruction (`send.welcome`). A fact has many possible consumers; a command has one, and
it is really just a method call in disguise.

Namespace as `<subject>.<fact>`. A few older names (`request.timeout`) are nouns — match the
established name in that family rather than inventing a new convention.

### 5.4 Publish through the outbox, always
Use `EVENT_PUBLISHER`. It writes the event in the same transaction as the state change and the
relay dispatches after commit. Emitting directly from a service risks announcing something that
then rolls back.

### 5.5 Consumers are idempotent and never throw
An event may be redelivered. A consumer must reach the same end state — use a deterministic
idempotency key (§9.4). A consumer that throws takes unrelated subscribers down with it: catch,
log via `stageFailed`, return.

### 5.6 Carry ids and facts, not object graphs
Payloads are small and stable. A consumer that needs more resolves it through its own port. Fat
payloads become a second, undocumented schema.

### 5.7 A new event type is a deliberate decision at both ends
When you add one, register it in `evidence-interpretation.ts` — even as `[]` for "carries no
behavioural signal". An unregistered event silently means nothing to the Evidence Service, and
silence should be a choice, not an oversight.

### 5.8 Derived state must be rebuildable from its source
Raw events and evidence are append-only, by contract. Beliefs and aggregates are *derived* and
may be recomputed wholesale. Never edit a derived row in place as a shortcut, and never mutate an
append-only one at all.

---

## 6. SOLID, applied here

Not recited — these are the specific forms these principles take in this codebase.

### 6.1 Single Responsibility — one reason to change
See §8. The measurable proxies are file length and constructor arity.

### 6.2 Open/Closed — extend through registration, not modification
Adding a workflow means writing a definition and registering it. Adding a channel means writing a
notifier. Adding an LLM provider means writing an adapter. If your new capability requires editing
a `switch` in the core, you have found a missing abstraction.

### 6.3 Liskov — an implementation must honour the port's promises
The contract includes documented behaviour, not just the signature. `ChannelNotifierPort.send`
promises to *return* a result rather than throw; a notifier that throws breaks callers written
against the contract, and the sweeper has to defend against it.

### 6.4 Interface Segregation — narrow ports
A port describes one capability. `ClockPort` is `now()`. Do not merge related-looking ports; a fat
port forces every fake in every test to grow.

### 6.5 Dependency Inversion — depend on the abstraction, inject the concrete
Both sides point at the port: the domain declares it, the adapter implements it, `config/` binds
them. This is the whole architecture in one line, and §3.2 is where it is currently violated.

---

## 7. Sanctioned patterns — and banned ones

### 7.1 The patterns this codebase uses
Reach for the one already in play before inventing a new shape.

| Pattern | Where it lives | Use it when |
|---|---|---|
| **Ports & Adapters** | everywhere | Anything external |
| **Repository** | `*-repository.port.ts` + `prisma-*.repository.ts` | Persistence for an aggregate |
| **Adapter / ACL** | `adapters/{inbound,outbound}` | Translating a provider's shape |
| **Strategy** | workflow definitions, LLM adapters | Interchangeable behaviour chosen at runtime |
| **Registry** | `WorkflowDefinitionRegistry`, `ChannelNotifierRegistry` | Resolving one of many by key/priority |
| **State machine** | `WorkflowEngine` + definitions | Multi-turn business processes |
| **Decorator** | `DurableChannelNotifier` | Adding a cross-cutting guarantee to every implementation |
| **Transactional outbox** | `OutboxEvent` + `OutboxRelay` | Publishing a fact with a state change |
| **Work queue claim** | `FOR UPDATE SKIP LOCKED` + lease | Multiple workers draining one table |
| **Circuit breaker + backoff** | `circuit-breaker.ts`, `LlmProviderService` | Any flaky external call |
| **Materialised view** | `EvidenceAggregate`, vendor beliefs | Expensive reads over append-only facts |
| **Degradation envelope** | `FALLBACK_ENVELOPE` | A turn that cannot produce a real answer |

### 7.2 Patterns that are banned here

- **God service.** See §8.
- **Anaemic domain model.** Business rules living in services while models are bare data (§4.4).
- **Service locator / global container access.** Dependencies are constructor-injected, always.
- **Inheritance for code reuse.** Compose or extract a function. Inheritance is for implementing a
  port, nothing else.
- **Business logic in adapters or in `config/`.** §3.3, §3.4.
- **Cross-context table reads.** §4.2.
- **Transaction handles across a port.** §4.5.
- **Boolean flag parameters** that select behaviour — pass a discriminated option or split the
  method. `send(x, true)` is unreadable at the call site.
- **Primitive obsession** for money, ids, confidences and statuses. §4.6.
- **Shared mutable module state.** Anything stateful is a provider with a lifecycle.
- **An LLM in a decision path** that spends money, reveals a profile or interprets a tapped
  button. §11.3.
- **Magic strings for registered types.** §11.5.

---

## 8. Size and responsibility

### 8.1 One reason to change, per class
Not a style preference — it is what keeps a 20-file feature from becoming a 3-file feature nobody
can review.

### 8.2 Thresholds that trigger a split
| Signal | Threshold | Action |
|---|---|---|
| File length | > 400 lines | Justify in review or split |
| Constructor dependencies | > 7 | Split the class |
| Function length | > 60 lines | Extract |
| Nesting depth | > 3 | Guard-clause, invert, or extract |

Review triggers, not lint errors. "It is cohesive" is acceptable — once.

**Why:** `RequestDistributionService` is 800 lines with 10 dependencies and owns request creation,
billing, fan-out, notification and sweeping. It is the hardest file here to change safely, and it
got there one reasonable-looking addition at a time.

### 8.3 Extend by adding a collaborator, not by growing the caller
When a big class needs new behaviour, the default is a new service it calls — not another 80 lines
and two more injections.

---

## 9. Concurrency, idempotency and money

### 9.1 The database enforces invariants, not the caller
- Exactly-once comes from a unique constraint on the ledger row, inserted **before** the balance
  moves.
- Never-negative comes from checking and decrementing inside one transaction with the row locked
  `FOR UPDATE`.
- A caller must not be able to get this wrong by forgetting to check first — checking first must
  not be what makes it safe.

### 9.2 One writer per conversation
A turn runs under the distributed conversation lock. Anything that can outlive that lock must be
bounded below its TTL (§9.6).

### 9.3 Claim work with `FOR UPDATE SKIP LOCKED`
The standard pattern for any table multiple workers drain. Prefer a **lease** (push the due time
forward) over a `processing` status: a worker that dies mid-batch strands nothing, and there is no
reaper to write.

### 9.4 Every idempotent operation needs a deterministic key
Derive it from the business event, never from a random id: `delivery:<requestId>:<vendorId>`,
`onboarding:<vendorId>`. The key is the guarantee; the code around it is just plumbing.

### 9.5 Retry only what cannot duplicate

| Failure | Retry? | Reason |
|---|---|---|
| Connection refused / DNS / connect timeout | Yes | Nothing was sent |
| HTTP 429 / 5xx | Yes | The server answered and refused |
| Socket reset mid-flight, client-side timeout | **No** | It may have succeeded |
| HTTP 4xx (bad token, invalid recipient, window closed) | **No** | A decision; retrying burns quota |

No channel here offers an idempotency key. A missing message is bad; a duplicate credit deduction
notice is worse.

### 9.6 Bound every retry loop against whatever owns the deadline
Retrying harder must never become a concurrency bug.

### 9.7 Order matters in a conversation
A chat that answers the second question first reads as broken. Where messages can queue, preserve
composition order per conversation.

---

## 10. Data and persistence

### 10.1 Every schema change ships as a reviewed migration
Hand-author the SQL, verify with `prisma migrate dev`, and explain the intent in a comment. A
migration is a permanent artefact — the comment is for whoever reads it in a year.

### 10.2 Nullable means "no value", not "zero"
A debit records no naira, so `amountKobo` is `null`; `0` would claim a payment of nothing arrived.
Model absence honestly.

### 10.3 Index every query path you add
Including the ones the sweeper uses. An unindexed background scan is invisible until the table is
large.

### 10.4 Append-only means append-only
Raw events and evidence have no update or delete by contract, so history cannot be quietly
rewritten. Derived tables (beliefs, aggregates) are replaced wholesale from their source (§5.8).

### 10.5 Queues are not archives
Anything that accumulates needs a retention rule at the time it is introduced.

---

## 11. Correctness rules that have already cost us

### 11.1 Never tell a user something that is not true
No placeholder copy that outlives the feature. No promise the platform cannot keep. If something
is unavailable, say so plainly and say what happens next.

Before writing copy that promises anything, answer: **what code makes this true?** If you cannot
name it, do not write it.

**Why:** three incidents. Triage answered "Seller onboarding opens shortly" months after
onboarding shipped. The wallet answered "ready in a few minutes" for a permanently disabled
Paystack feature. Buyer search promised "we will notify you as soon as suppliers are available"
with no waitlist, register or notifier anywhere in the system.

### 11.2 `FALLBACK_ENVELOPE` is the failure envelope. It is not a greeting
It is emitted for `no_readable_content`, `conversation_locked`, `routing_produced_no_workflow`,
`no_response_produced` and total LLM failure; its metadata says `understanding_failed`. Put a
welcome in it and a user whose voice note failed to transcribe gets greeted, as does one who hit a
lock mid-conversation.

`Execution.md §2.5` mandates the fallback precisely so the platform never falls into generic
`"Hi there!"` loops. Making it a greeting inverts the rule it exists to satisfy. A greeting is a
separate response used on first contact only.

### 11.3 Deterministic paths stay deterministic
Anything that spends credits, reveals a profile, or acts on a tapped button is decided by code,
not a model. A tapped button carries no ambiguity — classifying it can only agree, cost latency,
or be wrong.

*Pattern:* `system-actions.ts`, `vendor-response.ts` — a pure resolver, `null` for anything
unrecognised, and `null` means "route normally", never "assume yes".

### 11.4 Routing decisions belong to the understanding layer
`ConversationContinuityAnalyzer` decides how a message relates to what came before;
`IntentResolutionService` decides what it wants; `WorkflowManager` acts on those verdicts.

Do not hardcode lexical rules in the router. They cannot be overridden by context, they duplicate
a decision that already has an owner, and they are almost always English-only — which on a
Nigerian platform silently excludes "Ndewo", "Sannu", "Abeg" and "How far". If a deterministic
shortcut is genuinely required it must sit *after* the continuity verdict, so it cannot interrupt
live work.

**Why:** a greeting regex placed before the continuation check suspends a vendor's half-finished
onboarding when they type "Hi".

### 11.5 Never reference a registered type by string literal
The registry resolves workflows by intent and priority so no component needs their names. Use the
exported constant or add a registry capability. A magic `'Triage'` reintroduces the coupling the
registry removed and turns a missing registration from a clean degradation into a dead-letter.

### 11.6 Best-effort means best-effort
A notifier fired after committed state must never throw and never roll anything back. Log and
return. A contract, not a defensive habit — callers rely on it.

### 11.7 Silence is only evidence when there was a question
Before recording a negative signal about anyone, verify the thing you are measuring actually
happened to them.

**Why:** the timeout sweep marked every pending delivery as a no-response, including immediate
deliveries — vendors billed and shown to a customer without being asked anything. The platform was
quietly degrading the reputation of its best-matched vendor on every search.

---

## 12. Types, errors and observability

### 12.1 No `any`
*Enforced.* Use `unknown` and narrow, or define the type.

### 12.2 Make illegal states unrepresentable
Prefer discriminated unions to a boolean plus optional fields. `{ outcome: 'insufficient';
balance: number } | { outcome: 'debited'; balanceAfter: number }` cannot be misread; `{ ok:
boolean; balance?: number }` can.

### 12.3 Return outcomes, throw for bugs
Expected failures are return values. Exceptions are for programmer error. A caller should not need
a `try` to handle the ordinary.

### 12.4 Never swallow the cause
`fetch` throws a bare `TypeError: fetch failed` and hides the reason in `cause`. Unwind it.

**Why:** an IPv6 routing problem reached production logs as four uninformative words.

### 12.5 Every stage logs Input / Action / Output
Per `Execution.md §3`. The action line is prose a human can read at 2am.

### 12.6 Log what an operator can act on
When a failure needs a human — a provider feature disabled, an orphaned debit — say so. Never hide
an operator problem behind a user-facing platitude.

---

## 13. Workflows

### 13.1 The engine decides transitions; the LLM only supplies data
`Execution.md §2.2`. A state handler returns a declarative result. It does not send messages,
start other workflows, or write to other aggregates directly.

### 13.2 Declare every transition
`allowedTransitions` is the audit trail. If you add a terminal path, declare it — the engine
rejecting an undeclared transition is the machine working.

### 13.3 Information before questions
`Execution.md §2.3`. Never ask for what the conversation, profile or memory already contains.
Recognise a returning user before treating them as new.

### 13.4 Bound every re-ask
A question ignored three times will not work the fourth. Loops terminate with something useful.

### 13.5 Summaries are replayed into prompts — keep them bounded
A summary that appends a sentence per turn costs tokens and latency on every later message and
eventually crowds out the history it summarises. Count, do not concatenate.

### 13.6 A workflow that learns it is not the right one hands off
Use `handoff`; do not answer on behalf of a capability you do not implement. Keep a fallback
response for the case where nothing claims the intent.

---

## 14. Security

1. Verify webhook signatures over the **raw** body with `timingSafeEqual` — never over a
   re-serialised object.
2. Always answer authenticated webhooks `200`; an unsigned one `403`. Retry storms are an outage.
3. Identity comes from the authenticated conversation, never a payload field. A payload may name
   *what* is acted on; never *who* is acting.
4. Never log secrets. Account numbers and balances are the user's own data and may be logged;
   tokens, keys and signatures never are.
5. Never commit `.env`. Config is validated at boot; absent secrets fail loudly.
6. Deterministic paths have no prompt-injection surface — a reason to prefer them wherever money
   moves.

---

## 15. Testing

Per `Execution.md §4`. In addition:

1. **Test the property, not the implementation.** Name the test after the behaviour someone
   depends on.
2. **Database guarantees need a real database.** Locking, `SKIP LOCKED`, unique constraints and
   transactional reads cannot be proven against a fake.
3. **A regression test must fail without the fix.** Verify that it does.
4. **Hand-write fakes that enforce the real contract.** A fake returning canned values lets a
   caller that violates the invariant pass.
5. **Pin measurable claims.** If a comment says "about ten minutes", test it — and if the test
   disagrees, fix the comment, not the test.

---

## 16. The quality gate

```bash
npm run lint       # must be clean
npm run typecheck  # must be clean
npm run test:unit
npm run test:int   # needs npm run infra:up and a *_test database
npm run build
```

### 16.1 Never commit a red build
A stray brace reached `main` and left `demand.ts` uncompilable. `typecheck` catches that in
seconds.

### 16.2 Use the project's formatter, not your editor's
Prettier config is in the repo and enforced through ESLint. An editor formatting with its own
defaults produces large meaningless diffs that bury real changes and turn the gate red for
cosmetic reasons — which is how a team learns to ignore the gate.

### 16.3 Read what `--fix` changed
`eslint --fix` is a code change and gets the same scrutiny as any other.

**Why:** after an edit failed to apply, `--fix` rewrote a never-reassigned `let retryable = false`
to `const` — silently locking a bug in place and disabling the durable outbound queue for the
exact failure it was built for.

### 16.4 Do not weaken a gate to pass it
If a rule is wrong, change it deliberately, in its own commit, with the reason.

---

## 17. Enforcement status

| Rule | Today | Plan |
|---|---|---|
| §3.1 domain imports nothing outward | ESLint | — |
| §3.3 inbound adapters run no workflows or LLMs | ESLint | — |
| §12.1 no `any` | ESLint | — |
| §16 formatting | ESLint + Prettier | — |
| §3.2 application must not import adapters | **Reviewer** | Add ESLint rule once `RequestDistributionService` uses a delivery port |
| §4.2 no cross-context table reads | Reviewer | Same rule would cover most of it |
| §8.2 size limits | Reviewer | Consider a warn-level rule |
| §11.1 no untrue copy | Reviewer | Not mechanisable — this is what review is for |

A rule that is enforced is worth ten that are documented. When you fix a violation, consider
whether you can close the gate behind you.

---

## 18. Pre-merge checklist

- [ ] `lint`, `typecheck`, `build` clean; tests for what I touched pass
- [ ] I named the bounded context, the layer and the port before writing code (§2.2)
- [ ] Dependencies point inward; no new `application → adapters` import
- [ ] No context reads another's tables; cross-context work goes through an event
- [ ] Every new external dependency is behind a port
- [ ] Business rules live on the domain model, not scattered in a service
- [ ] No file grew past 400 lines or 7 dependencies without a stated reason
- [ ] Every user-facing sentence is true, and I can name the code that makes it true
- [ ] Nothing that spends money or reveals a profile depends on an LLM
- [ ] Idempotency keys are deterministic; retries classified; nothing ambiguous is repeated
- [ ] New events use the standard envelope, are named as facts, and are registered with the
      Evidence Service
- [ ] Schema changes have a reviewed migration and an index for every new query path
- [ ] New failure paths log something an operator can act on
- [ ] Any behaviour I removed was removed on purpose — no orphaned handlers or unreachable cases
- [ ] Comments explain **why** and cite the rule or spec section

---

## 19. A note on generated code

Most contributions here are written with AI assistance, including this document. That is fine and
expected. It changes nothing about the standard: generated code is held to exactly the rules
above, and whoever submits it owns it.

Two failure modes are worth naming because both have happened. An assistant given a narrow
instruction optimises for it and quietly trades away a constraint it was not told about — a
greeting was added to the fallback envelope, and cancel/restart routing disappeared in the same
edit. And an assistant working without the repo's formatter, or without running `typecheck`,
produces a diff that looks plausible and does not compile.

If you are an AI agent contributing here: §2 is your workflow, not a suggestion. State the context,
layer and port before you write code. Run the gate before you report success. Read your own diff
and justify every deletion. Report what you did **not** verify as plainly as what you did.

The defence is not to avoid generated code. It is §2 and §16: follow the sequence, run the gate,
read the whole diff, and ask of every deletion whether it was intended.
