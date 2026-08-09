# Contributing to MetaMarket — Engineering Standards

**Status:** Mandatory. Applies to every change: new feature, refactor, one-line fix, generated
or hand-written, human or AI.

This document expands [`Execution.md §2`](Execution.md) (Mandatory Clean Code Design Principles)
and [`docs/architecture/ADR-001`](docs/architecture/ADR-001-Hexagonal-Architecture.md) into rules
you can apply and a reviewer can check. Those two are the constitution; this is the case law.

Rules are numbered so code comments can cite them, the way the codebase already cites
`Execution.md §2.5` and `MCOS §15`. Write `CONTRIBUTING §4.2` in a comment when a line exists
because of a rule — that is how a rule survives the next refactor.

Most rules below carry a **Why** drawn from a defect that actually reached the running platform.
They are not hypothetical. A rule with a scar is a rule people keep.

---

## 1. The one-paragraph version

Dependencies point inward. The domain knows nothing about the outside world. Every external
thing sits behind a port. Money and user-visible promises are never decided by an LLM. Never
tell a user something that is not true. Leave the quality gate green.

---

## 2. Layering — the non-negotiable structure

```
  adapters/inbound  ──►  application  ──►  domain  ◄──  application  ◄──  adapters/outbound
        (translate)        (orchestrate)    (decide)                          (execute)
                                   ▲
                                config/  (wiring only — no logic)
```

### 2.1 Dependencies point inward, always
`domain` may import only from `domain`. It must never import `adapters`, `application`, `config`,
or any framework, driver or SDK (`@nestjs/*`, `@prisma/*`, `ioredis`, `openai`, `express`, …).

*Enforced:* ESLint `no-restricted-imports` on `src/domain/**`. Currently clean — keep it that way.

### 2.2 `application` must not import `adapters`
An application service that imports a concrete adapter has silently welded the platform to that
technology. Depend on a port in `src/domain/ports/outbound` and let `config/` inject the
implementation.

*Known violation:* `RequestDistributionService` imports `PrismaService`. It is the only one. Do
not add a second, and prefer to remove this one when you next touch that file.

*Not yet enforced* — see §10.

### 2.3 Adapters translate; they do not decide
An inbound adapter maps a provider payload to a canonical model and calls an inbound port. It
must not run workflows, call an LLM, or make business decisions.

*Enforced:* ESLint on `src/adapters/inbound/**`.

### 2.4 `config/` is wiring, not logic
Modules, factories and DI tokens only. If a factory contains a branch that a product person
would have an opinion about, it belongs in `application`.

### 2.5 Every external dependency goes behind a port
Database, LLM, channel, payment provider, queue, clock, id generator. The test for whether you
need a port: *could this ever be swapped, mocked, or fail?* If yes, port it.

**Why:** because we honoured this, swapping Paystack for another provider is four adapter files.
The entire domain and application layers contain two references to Paystack, one of them a log
string.

### 2.6 One reserved concept per file, and put it where it belongs
Pure functions over canonical models → `domain/models`. State machines → `domain/workflows`.
Contracts → `domain/ports`. Orchestration → `application`. I/O → `adapters`.

Helper predicates over a DTO belong in `domain/models`, not in the port file that declares the
DTO. A port is a contract; adding functions to it blurs what implementers must provide.

---

## 3. Size and responsibility

### 3.1 One reason to change, per class
Single Responsibility is not a style preference here — it is what keeps a 20-file feature from
becoming a 3-file feature you cannot review.

### 3.2 Hard limits that trigger a split
| Signal | Threshold | Action |
|---|---|---|
| File length | > 400 lines | Justify in review or split |
| Constructor dependencies | > 7 | Split the class |
| Function length | > 60 lines | Extract |
| Nesting depth | > 3 | Invert, guard-clause, or extract |

These are review triggers, not lint errors. "It is cohesive" is an acceptable answer — once.

**Why:** `RequestDistributionService` is 800 lines with 10 injected dependencies and owns request
creation, billing, fan-out, notification and sweeping. It is the hardest file in the codebase to
change safely, and it got there one reasonable-looking addition at a time.

### 3.3 Extend by adding a collaborator, not by growing the caller
When a feature needs new behaviour in a big class, the default is a new service the class calls,
not another 80 lines and two more injections.

---

## 4. Correctness rules that have already cost us

### 4.1 Never tell a user something that is not true
No placeholder copy that outlives the feature. No promise the platform cannot keep. If a
capability is unavailable, say so plainly and say what happens next.

Before writing user-facing copy that promises anything, answer: **what code makes this true?**
If you cannot name it, do not write it.

**Why:** three separate incidents. Triage answered "Seller onboarding opens shortly" months after
onboarding shipped. The wallet answered "ready in a few minutes" for a Paystack feature that was
permanently disabled. Buyer search promised "we will notify you as soon as suppliers are
available" with no waitlist, no register and no notifier anywhere in the system.

### 4.2 `FALLBACK_ENVELOPE` is the failure envelope. It is not a greeting
It is emitted for `no_readable_content`, `conversation_locked`, `routing_produced_no_workflow`,
`no_response_produced` and total LLM failure. Its metadata says `understanding_failed`. Putting a
welcome message in it means a user whose voice note failed to transcribe gets greeted, and a user
who hit a lock mid-conversation gets greeted.

`Execution.md §2.5` requires the fallback specifically so the platform never falls into generic
`"Hi there!"` loops. Making the fallback a greeting inverts the rule it exists to satisfy.

A greeting is a separate response used on first contact only.

### 4.3 Deterministic paths stay deterministic
Anything that spends a vendor's credits, reveals a profile, or acts on a tapped button is decided
by code, not by a model. A tapped button carries no ambiguity — classifying it can only agree,
cost latency, or be wrong.

*Pattern to follow:* `system-actions.ts` and `vendor-response.ts` — a pure resolver over the
payload, `null` for anything unrecognised, and `null` means "route normally", never "assume yes".

### 4.4 Routing decisions belong to the understanding layer
`ConversationContinuityAnalyzer` decides how a message relates to what came before;
`IntentResolutionService` decides what it wants. `WorkflowManager` acts on those verdicts.

Do not hardcode lexical rules in the router. They cannot be overridden by context, they duplicate
a decision that already has an owner, and they are almost always English-only — which on a
Nigerian platform silently excludes "Ndewo", "Sannu", "Abeg" and "How far".

If a deterministic shortcut is genuinely required, it must sit *after* the continuity verdict so
it cannot interrupt live work, and it must be justified in the code comment.

**Why:** a greeting regex placed before the continuation check suspends a vendor's half-finished
onboarding when they type "Hi".

### 4.5 Never reference a workflow by string literal
The registry resolves workflows by intent and priority precisely so no component needs to know
their names. Use the exported constant, or add a registry capability. A magic `'Triage'` in the
manager reintroduces the coupling the registry removed, and turns a missing registration from a
clean degradation into a dead-letter.

### 4.6 Money: the database enforces the invariant, not the caller
- Exactly-once comes from a unique constraint on the ledger row, inserted **before** the balance
  moves.
- Never-negative comes from checking and decrementing inside one transaction with the row locked.
- Every billable event has a deterministic reference (`delivery:<requestId>:<vendorId>`).
- A caller must not be able to get this wrong by forgetting to check first — checking first must
  not be what makes it safe.

### 4.7 Retry only what cannot duplicate
Classify every failure before retrying it:

| Failure | Retry? | Reason |
|---|---|---|
| Connection refused / DNS / connect timeout | Yes | Nothing was sent |
| HTTP 429 / 5xx | Yes | The server answered and refused |
| Socket reset mid-flight, client-side timeout | **No** | It may have succeeded |
| HTTP 4xx (bad token, invalid recipient, window closed) | **No** | A decision; retrying burns quota |

None of our channels offer an idempotency key. A missing message is bad; a duplicate credit
deduction notice is worse.

### 4.8 Bound every retry loop against the thing that owns the deadline
Outbound delivery runs inside the turn that holds the conversation lock. If retries can outlive
the lock TTL, a second worker picks up the same conversation. Retrying harder must never become a
concurrency bug.

### 4.9 Best-effort means best-effort
A notifier fired after committed state must never throw and must never roll anything back. Log
the failure and return. This is a contract, not a defensive habit — callers rely on it.

### 4.10 Silence is only evidence when there was a question
Before recording a negative signal about anyone, verify the thing you are measuring actually
happened to them.

**Why:** the timeout sweep marked *every* pending delivery as a no-response, including immediate
deliveries — vendors who were billed and shown to a customer without ever being asked anything.
The platform was quietly degrading the reputation of its best-matched vendor on every search.

---

## 5. Types, errors and observability

### 5.1 No `any`
*Enforced.* Use `unknown` and narrow, or define the type.

### 5.2 Make illegal states unrepresentable
Prefer discriminated unions over boolean flags plus optional fields. `{ outcome: 'insufficient';
balance: number } | { outcome: 'debited'; balanceAfter: number }` cannot be misread; `{ ok:
boolean; balance?: number }` can.

### 5.3 Return outcomes, throw for bugs
Expected failures (provider refused, balance too low, delivery rejected) are return values.
Exceptions are for programmer error. A caller should not need a `try` to handle the ordinary.

### 5.4 Never swallow the cause
`fetch` throws a bare `TypeError: fetch failed` and hides the reason in `cause`. Unwind it. An
error message that does not say what failed costs hours.

**Why:** an IPv6 routing problem reached production logs as four uninformative words.

### 5.5 Every stage logs Input / Action / Output
Per `Execution.md §3`. The action line is prose a human can read at 2am, not a symbol dump.

### 5.6 Log what an operator can act on
When a failure needs a human — a provider feature disabled, an orphaned debit — say so in the log
line. Do not hide an operator problem behind a user-facing platitude.

---

## 6. Workflows

### 6.1 The engine decides transitions; the LLM only supplies data
`Execution.md §2.2`. A state handler returns a declarative result; it does not send messages,
start other workflows, or write to other aggregates directly.

### 6.2 Declare every transition
A state's `allowedTransitions` is the audit trail. If you add a terminal path, declare it —
the engine rejecting an undeclared transition is the machine working, not an obstacle.

### 6.3 Information before questions
`Execution.md §2.3`. Never ask for something the conversation, the profile or the memory already
contains. Recognise a returning user before treating them as new.

### 6.4 Bound every re-ask
A question the user has ignored three times will not work the fourth. Loops must terminate with
something useful.

### 6.5 Summaries are replayed into prompts — keep them bounded
A summary that appends a sentence per turn costs tokens and latency on every subsequent message
and eventually crowds out the history it summarises. Count, do not concatenate.

---

## 7. Security

1. Verify webhook signatures over the **raw** body, with `timingSafeEqual`. Never over a
   re-serialised object.
2. Always answer authenticated webhooks `200`, except an unsigned one → `403`. Provider retry
   storms are an outage.
3. Identity comes from the authenticated conversation, never from a payload field. A payload may
   name *what* is being acted on; it may never name *who* is acting.
4. Never log secrets. Account numbers and balances are the user's own data and may be logged;
   tokens, keys and signatures never are.
5. Never commit `.env`. Configuration is validated at boot and absent secrets fail loudly.
6. Deterministic paths have no prompt-injection surface — that is a reason to prefer them for
   anything that spends money.

---

## 8. Testing

Per `Execution.md §4`. In addition:

1. **Test the property, not the implementation.** Name the test after the behaviour a user or
   operator depends on.
2. **Database guarantees need a real database.** Locking, `SKIP LOCKED`, unique constraints and
   transactional reads cannot be proven against a fake.
3. **A regression test must fail without the fix.** Verify that it does. An untested test proves
   nothing.
4. **Hand-write fakes that enforce the real contract.** A fake that returns canned values lets a
   caller violating the invariant pass.
5. When a comment states a measurable claim ("about ten minutes"), pin it with a test — and if
   the test disagrees, fix the comment, not the test.

---

## 9. The quality gate

```bash
npm run lint       # must be clean
npm run typecheck  # must be clean
npm run test:unit
npm run test:int   # needs npm run infra:up and a *_test database
npm run build
```

### 9.1 Never commit a red build
A stray brace reached `main` and left `demand.ts` uncompilable. `typecheck` catches this in
seconds. Run it.

### 9.2 Use the project's formatter, not your editor's
Prettier config is in the repo and enforced through ESLint. An editor formatting with its own
defaults produces large, meaningless diffs that bury real changes and turn the gate red for
cosmetic reasons — which is how a team learns to ignore the gate.

### 9.3 Read what `--fix` changed
`eslint --fix` is a code change and gets the same scrutiny as any other.

**Why:** after an edit failed to apply, `--fix` rewrote a never-reassigned `let retryable = false`
to `const` — silently locking a bug in place and disabling the durable outbound queue entirely
for the exact failure it was built for.

### 9.4 Do not weaken a gate to pass it
If a rule is wrong, change it deliberately, in its own commit, with the reason.

---

## 10. Enforcement status

| Rule | Today | Plan |
|---|---|---|
| §2.1 domain imports nothing outward | ESLint | — |
| §2.3 inbound adapters run no workflows or LLMs | ESLint | — |
| §5.1 no `any` | ESLint | — |
| §9 formatting | ESLint + Prettier | — |
| §2.2 application must not import adapters | **Reviewer** | Add ESLint rule once `RequestDistributionService` uses a delivery port |
| §3.2 size limits | Reviewer | Consider a warn-level rule |
| §4.1 no untrue copy | Reviewer | Not mechanisable — this is what review is for |

A rule that is enforced is worth ten that are documented. When you fix a violation, consider
whether you can close the gate behind you.

---

## 11. Before you open a change

- [ ] `lint`, `typecheck`, `build` clean; tests for what I touched pass
- [ ] Dependencies point inward; no new `application → adapters` import
- [ ] Every new external dependency is behind a port
- [ ] No file I grew past 400 lines or 7 dependencies without saying why
- [ ] Every user-facing sentence is true, and I can name the code that makes it true
- [ ] Nothing that spends money or reveals a profile depends on an LLM
- [ ] Retries classified: nothing ambiguous is repeated
- [ ] New failure paths log something an operator can act on
- [ ] Any behaviour I removed was removed on purpose — no orphaned handlers or unreachable cases
- [ ] Comments explain **why**, and cite the rule or spec section where one applies

---

## 12. A note on generated code

Most contributions here are written with AI assistance, including this document. That is fine and
expected. It changes nothing about the standard: generated code is held to exactly the rules
above, and the author who submits it owns it.

Two failure modes are worth naming because both have happened. An assistant given a narrow
instruction will optimise for it and quietly trade away a constraint it was not told about — a
greeting was added to the fallback envelope, and cancel/restart routing disappeared in the same
edit. And an assistant working without the repo's formatter or without running `typecheck` will
produce a diff that looks plausible and does not compile.

The defence is not to avoid generated code. It is §9: run the gate, read the whole diff, and ask
of every deletion whether it was intended.
