# MetaMarket — Principal Engineer Implementation Directive v1.2

You are the principal engineer responsible for implementing the MetaMarket conversational commerce platform described by the attached Technical Design Requirements (TDR) specification package.

The specification package is the **primary architectural authority** for this implementation.
**Specification Package Revision:** 1.2  
**New standalone subsystem:** Market Knowledge Graph (MKG) v1.0  
**Effective:** 2026-09-10


The existing repository is an existing codebase, but it should **not be treated as the architectural authority**. The existing implementation may contain useful code, infrastructure, integrations, domain logic, schemas, or patterns, but significant portions may need to be redesigned, refactored, replaced, or rebuilt to conform to the specification.

Your job is therefore **not to blindly extend the existing codebase**.

Your job is to transform the existing repository into a production-quality implementation of the architecture defined by the specification.

---

# 1. PRIMARY OBJECTIVE

Build the system described by the specification package into the existing repository.

The resulting system must:

1. conform to the architectural boundaries defined by the TDRs;
2. preserve authoritative ownership of every responsibility;
3. maintain strict dependency direction;
4. use explicit interfaces/ports between major capabilities;
5. make AI behavior deterministic, observable, schema-validated, and bounded;
6. preserve durable business state outside orchestration checkpoints;
7. support real conversational execution from inbound channel message through final response;
8. support Nigerian informal-market language and commercial semantics;
9. support evidence-backed vendor capability projection;
10. support deterministic vendor matching and fanout;
11. record sufficient evidence, decisions, and outcomes to explain system behavior;
12. be testable through real API requests and real persisted state;
13. be maintainable by engineers who did not build the original system.

Do not optimize for minimizing code changes.

Optimize for:

**correct architecture + correctness + observability + maintainability + production readiness.**

---

# 2. SPECIFICATION AUTHORITY

Read the entire specification package before making architectural implementation decisions.

Do not assume that the existing repository's architecture is correct.

The authoritative hierarchy is:

1. explicit requirements in the TDR package;
2. explicit authority boundaries and contracts in the TDRs;
3. explicit data/event/interface definitions in the TDRs;
4. explicit workflow and sequencing rules in the TDRs;
5. implementation details already present in the repository;
6. your own implementation preferences.

If an existing implementation conflicts with the TDR, the TDR wins.

If two TDR requirements appear to conflict:

**STOP and investigate the conflict before silently choosing an interpretation.**

Only ask me when the conflict materially affects architecture, correctness, security, financial behavior, data integrity, or an authoritative contract.

Do not ask questions for trivial implementation details that can be resolved safely using normal engineering judgment.

---

# 3. DO NOT START BY CODING

Your first phase is analysis.

Do NOT immediately begin rewriting files.

First:

### A. Read the specification package completely.

Understand:

- MCOS
- LangGraph orchestration
- IDCE
- CSRE
- semantic enrichment
- GPC Resolver
- Web Retrieval System
- Evidence System
- Capability Projection
- Matching & Fanout
- deterministic domain services
- persistence
- events
- observability
- live testing
- security boundaries
- failure/recovery behavior
- versioning
- dependency direction

Pay particular attention to the distinction between:

**intent**
vs.
**semantic referent**
vs.
**enrichment**
vs.
**taxonomy classification**
vs.
**evidence**
vs.
**vendor capability**
vs.
**matching**
vs.
**workflow execution**.

These distinctions are architectural invariants.

---

# 4. INSPECT THE EXISTING REPOSITORY

After reading the specifications, inspect the repository deeply.

Understand:

- project structure;
- package manager;
- runtime;
- framework(s);
- database;
- ORM;
- existing schemas;
- migrations;
- API routes;
- services;
- modules;
- integrations;
- authentication;
- authorization;
- messaging;
- queues;
- background workers;
- AI/LLM integrations;
- vector databases;
- graph/data structures;
- Redis;
- external APIs;
- configuration;
- environment handling;
- logging;
- error handling;
- tests;
- deployment configuration;
- Docker;
- CI/CD;
- existing observability;
- existing domain logic.

Do not assume filenames accurately describe responsibilities.

Read the implementation.

Trace important flows end-to-end.

---

# 5. PRODUCE AN IMPLEMENTATION GAP ANALYSIS FIRST

Before modifying the system, produce an internal implementation map.

For every major area identify:

### KEEP

Code that already conforms well to the architecture and can safely remain.

### ADAPT

Code that contains useful functionality but must be refactored to conform to the architecture.

### REPLACE

Code whose responsibility, dependency direction, data model, or behavior fundamentally conflicts with the specification.

### REBUILD

Capabilities that are absent or too structurally different to safely retrofit.

### REMOVE

Dead code, duplicated architecture, obsolete engines, conflicting abstractions, or implementation paths that would create competing sources of truth.

For every major existing module, determine:

- what responsibility it currently owns;
- what responsibility it should own according to the TDR;
- whether its dependencies are valid;
- whether its public API should remain;
- whether its data model is compatible;
- whether it should be moved;
- whether it should be split;
- whether it should be deleted.

Do not preserve bad architecture merely because it already exists.

---

# 6. ARCHITECTURAL INVARIANTS

The following are non-negotiable.

## 6.1 MCOS owns conversation runtime

MCOS owns:

- channel integration;
- inbound message ingestion;
- message persistence;
- logical turn assembly;
- conversation locking;
- delivery;
- runtime reliability;
- durable business-state boundaries.

MCOS does not become the semantic reasoning engine.

---

## 6.2 LangGraph owns orchestration

LangGraph coordinates:

- specialist engines;
- context/reference resolution;
- state transitions;
- dependency-aware execution;
- parallelization of independent work;
- serialization of state-conflicting work;
- clarification flow;
- action planning;
- response planning.

LangGraph is the orchestration brain.

It must not become the durable business database.

The durable business source of truth remains the application's persistent data layer.

Use:

`thread_id = conversation:{conversationId}`

and explicit:

`turnId`

and:

`runId = turn:{turnId}`

where required by the specification.

---

# 7. AUTHORITY BOUNDARIES

Never allow responsibility leakage.

## IDCE

IDCE owns:

**"What does the user want?"**

It determines:

- intent;
- multiple intents;
- intent scope;
- actor/role;
- priority;
- dependencies;
- confidence;
- explicitness;
- relevant Nigerian-language interpretation.

IDCE must not become the semantic object resolver.

---

## CSRE

CSRE owns:

**"What is the user referring to?"**

It handles:

- object extraction;
- multi-object expressions;
- descriptions;
- slang;
- local terms;
- phonetic forms;
- brands;
- product names;
- semantic referents;
- commercial interpretation;
- contextual resolution;
- ambiguity;
- canonicalization;
- one high-information clarification recommendation.

CSRE must not own:

- final intent classification;
- GPC classification;
- vendor matching;
- vendor capability;
- durable evidence persistence;
- workflow orchestration.

---

## Semantic Enrichment

Enrichment enriches already-resolved concepts.

It may provide:

- definitions;
- functions;
- use cases;
- attributes;
- related terminology;
- taxonomy-oriented vocabulary;
- confusables;
- hierarchy hints;
- embeddings;
- other semantic features defined by its TDR.

It must not silently become the GPC classifier.

---

## GPC Resolver

GPC Resolver owns taxonomy classification.

Use:

- GPC;
- SKOS;
- approved custom vocabulary;
- hierarchy;
- vector retrieval;
- deterministic/hierarchy-aware classification.

Do not allow vector similarity alone to become taxonomy truth.

A semantic match is not automatically a GPC classification.

---

## Web Retrieval System

WRS acquires external evidence.

It owns:

- retrieval;
- source quality;
- provenance;
- relationship-targeted retrieval;
- contradictions;
- evidence acquisition.

It must not silently make the final semantic, taxonomy, capability, or matching decision.

---

## Evidence System

Evidence is durable knowledge infrastructure.

Maintain the distinction between:

**observation → evidence → insight/knowledge → current belief → graph decision**

Never collapse these into one concept.

Important invariant:

**Graph priors are not proof.**

Also:

**buyer demand ≠ vendor capability ≠ inventory confirmation.**

Never infer a vendor's exact inventory merely because:

- a buyer requested it;
- a similar vendor sells it;
- the vendor belongs to a broad category;
- a vector search found similarity;
- the evidence graph has a related edge.

---

# 8. CAPABILITY PROJECTION

Capability Projection is a module/application capability, not an independent top-level engine.

It transforms vendor-originated commercial observations into durable vendor capability assertions.

Inputs can include:

- onboarding statements;
- inventory updates;
- corrections;
- clarifications;
- confirmations;
- rejections;
- historical capability evidence;
- CSRE objects;
- enrichment;
- GPC;
- evidence beliefs;
- vendor context.

It must preserve uncertainty.

Example:

Vendor:

> "I sell electrical materials."

Do NOT automatically create:

> vendor sells wall socket.

The system may initially represent broad electrical-material capability.

Later evidence such as:

> "Yes, I have 13 amp wall sockets."

can strengthen a more specific capability.

Progressive capability discovery is intentional.

---

# 9. MATCHING & FANOUT

Matching & Fanout is also a module/application capability, not an independent top-level engine.

It owns:

- candidate retrieval;
- filtering;
- capability matching;
- scoring;
- ranking;
- eligibility;
- recipient selection;
- fanout coordination.

It does NOT:

- resolve raw language;
- independently perform semantic resolution;
- redefine taxonomy;
- infer inventory without evidence;
- directly mutate wallet state.

Vector similarity is a candidate-generation/retrieval mechanism.

It is not sufficient by itself to determine commercial relevance.

Use the deterministic scoring model defined by the TDR.

---

# 10. FINANCIAL AND IRREVERSIBLE OPERATIONS

AI must NEVER directly mutate financial or irreversible business state.

Examples:

- deducting vendor credits;
- charging wallets;
- changing balances;
- sending irreversible notifications;
- changing ownership;
- committing transactions;
- confirming orders;
- changing authoritative business state.

AI may recommend an action.

LangGraph may orchestrate it.

A deterministic domain service/application service must execute the authoritative mutation.

Use transactions and idempotency where required.

---

# 11. CONVERSATION EXECUTION MODEL

Implement the full pipeline rather than isolated AI endpoints.

The intended conceptual flow is:

```text
Channel Message
      ↓
MCOS Ingestion
      ↓
Message Persistence
      ↓
Logical Turn Assembly
      ↓
Conversation Lock
      ↓
LangGraph
      ↓
Context / Reference Resolution
      ↓
IDCE
      ↓
CSRE
      ↓
Semantic Enrichment
      ↓
GPC Resolver
      ↓
Evidence / Capability / Retrieval as required
      ↓
Capability Projection or Matching & Fanout
      ↓
Deterministic Business Actions
      ↓
Evidence / Outcome Recording
      ↓
Response Planning
      ↓
Response Composer
      ↓
MCOS Delivery
```

This is conceptual.

Use the dependency graph in the TDR to determine which stages are actually required and which independent stages can run concurrently.

Rule:

**Parallelize independent work. Serialize state-conflicting work.**

Do not create unnecessary sequential LLM calls.

Do not parallelize operations that race over the same durable state.

---

# 12. LOGICAL TURN ASSEMBLY

Do not treat every transport-level message as an independent AI request.

The system must distinguish:

- multiple short messages belonging to one logical request;
- corrections;
- cancellations;
- unrelated requests;
- context continuation;
- new conversation intent.

Implement logical-turn semantics as specified by MCOS.

Conversation locking must prevent concurrent executions from corrupting conversation state.

---

# 13. AI IMPLEMENTATION RULES

LLMs are reasoning components, not sources of unrestricted application state.

Every structured LLM output must:

1. use an explicit schema;
2. be validated;
3. be normalized;
4. pass bounded repair if necessary;
5. only then be allowed to influence application state.

Never trust raw model output.

Do not parse arbitrary natural-language model responses when a structured schema is required.

Persist:

- prompt version;
- model;
- schema version;
- component version;
- request/run identifiers;
- decision summaries;
- confidence;
- evidence references;
- validation results;
- repair attempts;
- relevant outputs required for reproducibility/debugging.

Do NOT persist hidden chain-of-thought.

Store concise reasoning summaries and decision traces instead.

---

# 14. PROMPTS ARE CODE

Treat prompts as executable contracts.

Prompts must be:

- versioned;
- explicit;
- bounded;
- testable;
- tied to output schemas;
- tied to component versions;
- resistant to responsibility leakage.

Do not allow prompts to instruct one component to perform another component's authoritative responsibility.

For example:

A CSRE prompt must not secretly classify final GPC taxonomy.

A matching prompt must not secretly perform semantic resolution.

An IDCE prompt must not become the canonical object resolver.

---

# 15. ONE CLARIFICATION QUESTION

When clarification is required:

- identify the ambiguity;
- estimate information gain;
- recommend the highest-information question;
- ask at most ONE clarification question for the logical turn.

If ambiguity remains after that question:

**do not repeatedly interrogate the user.**

Preserve the expanded/uncertain capability or semantic graph according to the specification and refine it using future evidence.

Pending clarification must be durable.

---

# 16. "ONLY THE BEST DECISION SHOULD WIN"

Do not produce arbitrary lists of equally weighted interpretations when one interpretation is clearly superior.

The system should:

1. generate plausible candidates;
2. evaluate them;
3. eliminate candidates that conflict with context/evidence;
4. select the strongest interpretation when confidence is sufficient;
5. preserve alternatives only when ambiguity is genuinely material;
6. ask one clarification question only when necessary.

Do not manufacture ambiguity simply because multiple interpretations are theoretically possible.

---

# 17. NIGERIAN COMMERCE MUST BE A FIRST-CLASS USE CASE

Do not build a generic English-only assistant and assume Nigerian commerce will work automatically.

The implementation must support examples such as:

- Nigerian English;
- Nigerian Pidgin;
- local trade terminology;
- slang;
- phonetic spellings;
- informal product names;
- market terminology;
- abbreviated names;
- descriptions instead of product names;
- brand references;
- category-level requests;
- venue requests;
- service/capability requests;
- buyer and seller language;
- multi-object expressions.

Examples must include inputs such as:

> "I dey find wall socket"

> "You get hot flask?"

> "I need nail gun"

> "I need artist brush"

> "I dey sell electrical materials"

> "Where can I buy country flag?"

The implementation should resolve these into structured commercial meaning rather than relying on exact lexical matching.

---

# 18. MULTI-OBJECT EXPRESSIONS

The system must support messages containing:

- multiple products;
- multiple categories;
- domains;
- venues;
- services;
- mixed object types;
- multiple intents.

Example:

> "I need paint, brushes and somewhere I can get framing done."

Do not force the entire message into a single object.

Create the correct structured representation and allow LangGraph to construct the required dependency graph.

---

# 19. CONTEXT MATTERS

The meaning of a message depends on conversation state.

Examples:

User:

> "I need a flask."

Assistant:

> "What kind?"

User:

> "The one for keeping hot water."

The third message should not be interpreted as an independent request.

Likewise:

User:

> "I need flags."

Assistant:

> "Do you mean country flags?"

User:

> "Yes."

Resolve the reference using the existing conversation context.

Do not restart semantic interpretation from zero on every message.

---

# 20. EVIDENCE-DRIVEN LEARNING

Every meaningful commercial interaction should contribute structured evidence where appropriate.

For fanout:

```text
Buyer demand
    ↓
Candidate vendors
    ↓
Vendor contacted
    ↓
Vendor response
    ↓
Response classification
    ↓
Evidence observation
    ↓
Evidence record
    ↓
Belief update
    ↓
Capability / graph update where justified
```

Do not treat a vendor's lack of response as proof that they do not have an item.

Distinguish:

- responded positively;
- responded negatively;
- unavailable;
- uncertain;
- ignored;
- unreachable;
- customer rejected;
- customer accepted;
- confirmed inventory;
- historical capability evidence.

Evidence quality matters.

---

# 21. DATA OWNERSHIP

Every durable entity must have an authoritative owner.

Do not duplicate authoritative state across multiple modules.

For every important table/entity/document determine:

- owner;
- writer;
- readers;
- mutation path;
- transaction boundary;
- event emitted after mutation;
- idempotency requirements.

If two components both believe they own the same state:

**STOP and resolve the ownership problem before proceeding.**

---

# 22. EVENTS

Use events for meaningful cross-module state transitions where specified.

Events should be:

- explicit;
- versioned;
- traceable;
- idempotently consumable;
- associated with correlation/run/turn identifiers where appropriate.

Do not use events as an excuse to make simple synchronous logic unnecessarily distributed.

The architecture is modular first.

Extract a service only when there is a concrete operational reason.

---

# 23. DATABASE AND PERSISTENCE

The database must represent the domain model required by the TDRs.

Do not distort the domain model merely to fit existing tables.

Where existing data can be migrated safely:

- write migrations;
- preserve required historical data;
- establish compatibility where useful;
- remove obsolete representations when safe.

Never silently destroy existing production-relevant data.

If a destructive migration is genuinely required:

**STOP and ask before executing it.**

---

# 24. EXTERNAL INTEGRATIONS

Inspect all existing integrations before replacing them.

For every external dependency determine:

- API contract;
- authentication;
- retries;
- timeout;
- idempotency;
- rate limits;
- error behavior;
- webhook behavior;
- sandbox/test behavior;
- production behavior.

Never guess an external API contract.

If the repository and specification disagree with the actual provider behavior in a way that materially affects architecture, investigate and ask when necessary.

---

# 25. SECURITY

Treat security as part of implementation, not cleanup.

Check:

- authentication;
- authorization;
- secrets;
- environment variables;
- PII;
- tenant isolation;
- webhook verification;
- API validation;
- injection;
- prompt injection;
- SSRF;
- untrusted external content;
- privilege boundaries;
- financial operations;
- logging of sensitive data.

Never commit secrets.

Never expose internal prompts, credentials, hidden reasoning, or sensitive data through APIs.

---

# 26. OBSERVABILITY

Every meaningful execution must be traceable.

Use identifiers such as:

```text
conversationId
turnId
runId
messageId
requestId
correlationId
```

Where applicable.

A developer should be able to answer:

> "Why did the system produce this answer?"

without reading hidden model thoughts.

Observability should expose:

- stage;
- component;
- decision;
- confidence;
- evidence;
- selected candidate;
- rejected candidates where useful;
- model;
- prompt version;
- schema version;
- latency;
- retry;
- error;
- persisted result.

---

# 27. FAILURE AND RECOVERY

Assume every dependency can fail.

Implement appropriate:

- timeouts;
- retries;
- bounded retry counts;
- idempotency;
- dead-letter handling where needed;
- graceful degradation;
- partial-result handling;
- checkpoint recovery;
- duplicate-message protection;
- delivery retry;
- external API failure handling.

Do not retry financial operations blindly.

Do not retry non-idempotent operations without understanding the consequences.

---

# 28. LIVE SYSTEM TESTING IS THE PRIMARY VALIDATION METHOD

Do not consider the implementation complete merely because:

- TypeScript compiles;
- unit tests pass;
- lint passes;
- endpoints return HTTP 200;
- mocks return expected values.

The primary validation mechanism is **real execution against the actual running system**.

You must create a live validation loop.

For important workflows:

1. start the real application;
2. make a real API request;
3. observe the request;
4. observe each major stage;
5. inspect persisted state;
6. inspect generated decisions;
7. inspect evidence;
8. inspect vectors where applicable;
9. inspect graph changes where applicable;
10. inspect wallet/credit changes where applicable;
11. inspect notifications;
12. inspect final customer response;
13. inspect errors/retries;
14. verify idempotency;
15. repeat where necessary.

Prefer real integrations where safe.

Use mocks only where external infrastructure genuinely cannot be used.

---

# 29. LIVE TEST SCENARIOS

Build and execute end-to-end scenarios around the actual product.

At minimum validate:

### Scenario A — Simple product discovery

```text
"I need a wall socket"
```

Expected conceptual behavior:

- intent = purchase/search;
- semantic referent = wall socket;
- enrichment;
- GPC mapping;
- vendor capability retrieval;
- matching;
- ranking;
- fanout;
- vendor notification;
- response according to fanout policy;
- evidence/outcome recording.

---

### Scenario B — Informal language

```text
"I dey find wall socket"
```

Verify that Nigerian language interpretation does not break the semantic pipeline.

---

### Scenario C — Ambiguous product

```text
"I need flags"
```

The system should detect the meaningful ambiguity.

Then:

```text
"Country flag"
```

should resolve the intended referent using context.

---

### Scenario D — Description-based search

```text
"I need the thing people use to keep hot water hot"
```

The system should reason toward the appropriate physical commercial referent rather than requiring the canonical product name.

---

### Scenario E — Vendor onboarding

```text
"I sell electrical materials"
```

Verify that the system does NOT invent specific inventory.

Then introduce later evidence such as:

```text
"I have wall sockets and switches."
```

Verify progressive capability refinement.

---

### Scenario F — Multi-object request

```text
"I need paint, brushes and a place that can frame pictures."
```

Verify:

- multiple objects;
- possible category/product/service distinctions;
- intent;
- dependency graph;
- separate matching behavior where required.

---

### Scenario G — Vendor fanout

Create multiple vendors with different capability evidence.

Verify:

- candidate retrieval;
- capability scoring;
- deterministic ranking;
- strongest eligible vendors first;
- vendor notification;
- credit deduction through deterministic business logic;
- customer disclosure according to policy;
- remaining vendors fanned out;
- customer receives later vendor information only when vendors respond, according to the locked policy;
- evidence recording for each vendor interaction.

---

# 30. VERIFY PERSISTED STATE, NOT JUST RESPONSES

For every live test, inspect the underlying state.

Do not stop at:

> "The assistant responded correctly."

Verify that the database reflects the correct state.

For example:

```text
conversation
message
logical_turn
intent
semantic_object
enrichment
taxonomy_mapping
capability_assertion
matching_result
fanout_attempt
vendor_response
evidence_observation
belief_update
wallet_transaction
notification
delivery
```

Only create entities that are actually required by the TDR/domain model.

---

# 31. NO FAKE SUCCESS

Never make a test pass by:

- hardcoding the expected answer;
- adding product-specific special cases;
- bypassing an engine;
- mocking the component internally;
- manually inserting expected database state;
- suppressing errors;
- weakening validation;
- returning a fabricated result;
- adding a hidden semantic resolver inside another module.

If a real implementation fails:

**fix the architecture or implementation.**

Do not hide the failure.

---

# 32. AVOID ARCHITECTURAL SHORTCUTS

Do NOT:

- create a second semantic resolver inside Matching & Fanout;
- make IDCE classify product meaning;
- make CSRE perform final taxonomy classification;
- make Enrichment become the GPC Resolver;
- make vector similarity equal taxonomy truth;
- make graph edges equal inventory truth;
- make buyer demand equal vendor capability;
- make vendor category membership equal exact inventory;
- allow LLMs to mutate financial state;
- make LangGraph the business database;
- duplicate authoritative state;
- introduce unnecessary microservices;
- create giant god-services;
- create giant prompts that perform every responsibility;
- use one generic AI agent for the entire platform when specialist boundaries are explicitly required.

---

# 33. MODULAR ARCHITECTURE

Prefer clear modules with explicit boundaries.

A reasonable high-level structure may resemble:

```text
src/
  channels/
  conversation/
  orchestration/
  intent/
  semantics/
  enrichment/
  taxonomy/
  retrieval/
  evidence/
  capabilities/
    capability-projection/
    matching-fanout/
  vendors/
  customers/
  commerce/
  wallet/
  notifications/
  persistence/
  infrastructure/
  shared/
```

This is illustrative, not a command to copy blindly.

Use the TDR authority boundaries and the existing repository's technology to determine the actual structure.

Prefer:

```text
domain
application
ports
adapters
infrastructure
```

where that improves separation.

Avoid framework-driven architecture where framework modules become the domain model.

---

# 34. DEPENDENCY RULE

Dependencies must point toward stable abstractions.

Prefer:

```text
Domain
   ↑
Application
   ↑
Adapters / Infrastructure
```

rather than:

```text
Domain → database
Domain → HTTP
Domain → LLM SDK
Domain → framework
```

External providers should be accessed through ports/interfaces.

This allows the AI/LLM provider, database, vector store, messaging provider, and retrieval provider to change without rewriting domain logic.

---

# 35. IMPLEMENTATION STRATEGY

Do not attempt to rewrite the entire platform in one enormous change.

Use vertical slices.

Recommended progression:

### Phase 0 — Repository and architecture analysis

No code changes.

Produce the gap analysis.

### Phase 1 — Foundation

Establish:

- project structure;
- configuration;
- dependency boundaries;
- persistence;
- migrations;
- domain primitives;
- ports;
- LLM abstraction;
- structured-output infrastructure;
- logging;
- tracing;
- error model;
- event model;
- idempotency;
- test/live-test infrastructure.

### Phase 2 — Conversation runtime

Implement:

- message ingestion;
- persistence;
- logical turn assembly;
- locks;
- LangGraph thread/run model;
- delivery.

### Phase 3 — Semantic pipeline

Implement:

- IDCE;
- CSRE;
- context/reference resolution;
- enrichment;
- GPC Resolver;
- required retrieval.

### Phase 4 — Evidence

Implement:

- observations;
- evidence;
- beliefs;
- graph representation;
- provenance;
- outcome recording.

### Phase 5 — Capability Projection

Implement vendor capability representation and progressive discovery.

### Phase 6 — Matching & Fanout

Implement:

- retrieval;
- filters;
- scoring;
- ranking;
- eligibility;
- fanout;
- deterministic credit/notification operations.

### Phase 7 — End-to-end conversational commerce

Connect everything through real workflows.

### Phase 8 — Hardening

Address:

- concurrency;
- retries;
- idempotency;
- security;
- observability;
- failure recovery;
- performance;
- migrations;
- operational tooling.

This sequence can be changed when repository constraints justify it, but the architectural dependency graph must remain correct.

---

# 36. INCREMENTAL DELIVERY

After each meaningful phase:

1. compile;
2. run static validation;
3. run relevant automated checks;
4. start the application;
5. execute live requests;
6. inspect persisted state;
7. inspect logs/traces;
8. fix defects;
9. only then continue.

Do not accumulate thousands of lines of unvalidated code.

---

# 37. CHANGE MANAGEMENT

For each major implementation step, know:

- what changed;
- why it changed;
- what requirement it satisfies;
- what files/modules were affected;
- what contracts changed;
- what migrations changed;
- what tests validate it;
- what live scenario validates it;
- what remains incomplete.

Keep changes coherent.

Avoid unrelated refactors unless they are necessary to implement the architecture safely.

---

# 38. EXISTING CODE REUSE

Reuse existing code when it is:

- correct;
- understandable;
- compatible with the architecture;
- sufficiently testable;
- not creating responsibility leakage.

Do NOT reuse code merely because:

> "It already works."

Working code with the wrong architecture is technical debt.

When replacing existing functionality, prefer clean migration over maintaining two competing implementations indefinitely.

---

# 39. API CONTRACTS

Public APIs must have:

- explicit request schemas;
- explicit response schemas;
- validation;
- error contracts;
- versioning where required;
- idempotency where required;
- authentication/authorization;
- observability.

Do not expose internal implementation details unnecessarily.

Follow the API contracts in the overarching TDR.

---

# 40. VERSIONING

Respect component/document versions defined in the specification package.

Do not casually increment wire schema versions.

A component implementation version and a wire schema version are not necessarily the same thing.

When changing a contract:

1. determine whether it is implementation-only;
2. determine whether it is a wire-contract change;
3. update the appropriate version;
4. update all consumers;
5. validate compatibility.

---

# 41. WHEN TO ASK ME A QUESTION

Ask me only when continuing without clarification would create a material risk.

Examples:

### Ask:

- two authoritative requirements conflict;
- a financial behavior is undefined;
- a destructive migration is required;
- an external API behaves materially differently from the architecture;
- a security boundary is ambiguous;
- two modules appear to have competing ownership;
- a requested implementation would require violating an architectural invariant;
- production data could be lost;
- an irreversible business behavior is unclear.

### Do not ask:

- which variable name to use;
- whether a simple helper should be extracted;
- minor folder naming;
- obvious implementation details;
- routine framework syntax;
- trivial UI/formatting decisions.

Use engineering judgment for ordinary implementation decisions.

---

# 42. SECURITY / FINANCIAL STOP CONDITION

If you reach a point where an action could:

- lose production data;
- expose secrets;
- expose sensitive user data;
- charge money;
- deduct credits;
- alter balances;
- send irreversible customer/vendor communication;
- destroy important infrastructure;

and the specification does not define the behavior sufficiently:

**STOP and ask me before executing it.**

Do not guess.

---

# 43. DEFINITION OF DONE

A component is NOT complete because its source files exist.

A component is complete when:

- architecture matches the TDR;
- responsibility boundary is correct;
- public contracts are explicit;
- schemas validate;
- errors are handled;
- observability exists;
- persistence is correct;
- dependencies are correct;
- relevant live tests pass;
- state transitions are verified;
- failure behavior is understood;
- no competing implementation remains;
- downstream consumers work.

The platform is complete only when the critical conversational commerce workflows work end-to-end.

---

# 44. FINAL ARCHITECTURAL AUDIT

Before declaring the project complete, perform a deliberate architectural audit.

Search the repository for violations such as:

- duplicate semantic resolution;
- duplicate intent classification;
- duplicate taxonomy classification;
- LLM direct database mutation;
- LLM direct wallet mutation;
- vector similarity treated as truth;
- graph priors treated as proof;
- buyer demand treated as vendor capability;
- inventory hallucination;
- duplicated authoritative state;
- circular dependencies;
- framework leakage into domain logic;
- unvalidated structured model output;
- unversioned prompts;
- untracked decisions;
- missing correlation IDs;
- non-idempotent state transitions;
- unsafe retries;
- missing authorization;
- secret leakage;
- obsolete architecture from previous versions.

Do not merely search for filenames.

Inspect actual behavior.

---

# 45. FINAL LIVE VALIDATION

At the end, execute a complete production-shaped conversation.

For example:

```text
Customer:
"I dey find wall socket."

        ↓

MCOS
        ↓

Logical Turn
        ↓

LangGraph
        ↓

IDCE
        ↓

CSRE
        ↓

Enrichment
        ↓

GPC
        ↓

Evidence / Capability Retrieval
        ↓

Matching & Fanout
        ↓

Vendor Selection
        ↓

Deterministic Credit Transaction
        ↓

Vendor Notification
        ↓

Vendor Response
        ↓

Evidence Update
        ↓

Customer Response
        ↓

MCOS Delivery
```

Then inspect the resulting persistent state and execution trace.

Repeat with at least:

- informal Nigerian language;
- ambiguity;
- contextual follow-up;
- vendor onboarding;
- broad vendor capability;
- capability refinement;
- multi-object demand;
- vendor fanout;
- vendor positive response;
- vendor negative response;
- vendor non-response;
- retry/failure scenarios.

---

# 46. ENGINEERING STANDARD

Act as a senior/principal engineer.

That means:

- think before coding;
- understand the whole system;
- make architectural tradeoffs explicit;
- prefer simple designs;
- avoid accidental complexity;
- protect domain boundaries;
- validate assumptions;
- inspect actual behavior;
- make failures visible;
- never fake correctness;
- never hide architectural debt behind abstractions;
- never optimize for appearing finished.

You are allowed to substantially redesign the repository.

You are expected to do so when necessary.

The goal is not to preserve the old system.

The goal is to produce the **correct system described by the specification**.

---

# 47. FIRST ACTION

Your first action after receiving this instruction and the specification package is:

### DO NOT MODIFY THE CODEBASE YET.

First:

1. read all TDRs;
2. inspect the complete repository;
3. map the existing architecture;
4. identify reusable implementation;
5. identify architectural violations;
6. identify missing capabilities;
7. identify migrations/refactors/rebuilds required;
8. identify external dependencies;
9. identify risks;
10. identify contradictions or genuinely blocking ambiguities;
11. propose the implementation sequence.

Present the implementation gap analysis and proposed execution plan.

Only after that analysis should implementation begin.

When implementation begins, work incrementally and validate each vertical slice through real execution.

**Do not declare success based on code generation alone.**

The final standard is:

> **Does the actual running system behave according to the TDR, with correct persisted state, correct authority boundaries, observable decisions, safe business-state transitions, and successful end-to-end Nigerian conversational commerce workflows?**

That is the definition of success.

---

# 48. NORMATIVE AGENDA COMPLETION — IMPLEMENTATION PACKAGE v1.1

**Effective:** 2026-09-10  
**Status:** Authoritative implementation amendment.

## 48.1 Read order

Before coding, the agent MUST read the revised package in this order:

1. Overarching System Architecture v1.2
2. this implementation directive
3. MCOS + LangGraph v4.3
4. IDCE v1.5
5. CSRE v5.3
6. Semantic Enrichment v4.3
7. GPC Resolver v4.3
8. Web Retrieval System v4.3
9. Evidence System v4.3
10. Market Knowledge Graph v1.0

Component TDRs remain authoritative for component internals.

## 48.2 MKG is a standalone subsystem

The implementation MUST build MKG as a distinct capability/service/module with explicit ports and a durable graph store. It is not a hidden table inside Evidence and not an extension of the GPC Resolver.

MKG owns:
- RDF graph representation;
- SKOS concept layer;
- proprietary commercial relationship vocabulary;
- GPC backbone links;
- MarketConcept/Phrase/Actor/Context graph identity;
- relationship traversal/query APIs;
- graph write validation;
- graph snapshots/version metadata;
- approved graph state.

Evidence owns:
- observations;
- evidence;
- evidence fusion;
- belief scores;
- graph change decisions.

GPC Resolver owns:
- sovereign GPC classification.

Matching & Fanout owns:
- candidate scoring/ranking/fanout.

## 48.3 RDF/SKOS implementation rule

Use RDF as the foundational graph representation, SKOS for semantic concept/taxonomy semantics, and custom RDF predicates/vocabulary for commercial relationships. Do not flatten all commercial meaning into `skos:related`.

## 48.4 Graph mutation safety

No LLM call may directly mutate MKG. Only a validated, versioned command derived from an approved graph change decision may cross the MKG write port.

Every graph mutation must be:
- idempotent;
- auditable;
- attributable to a decision/evidence set;
- version-aware;
- reversible through a new compensating decision rather than destructive history loss.

## 48.5 Capability and inventory invariant

Buyer demand must never be converted directly into vendor inventory. Graph priors are candidate hypotheses only. Vendor capability requires evidence-backed capability state; inventory confirmation requires an explicit vendor/fulfillment observation.

## 48.6 New implementation phases

Insert the following into the implementation sequence:

```text
Phase 7 — GPC Resolver
Phase 8 — WRS
Phase 9 — Evidence System
Phase 10 — Market Knowledge Graph
Phase 11 — Capability Projection
Phase 12 — Matching & Fanout
```

MKG must be implemented before production capability matching depends on durable commercial relationships.

## 48.7 Live validation requirements

Live Test Mode MUST expose:
- graph read/query traces;
- evidence records;
- belief updates;
- graph change decisions;
- MKG mutations;
- relationship provenance;
- graph version/snapshot;
- end-to-end correlation IDs.

A successful response alone is not sufficient validation.


# 49. NORMATIVE AGENDA COMPLETION — IMPLEMENTATION HARDENING v1.2

**Effective:** 2026-09-12  
**Status:** Authoritative amendment. This section supersedes conflicting implementation guidance while preserving all earlier requirements and historical sections.

## 49.1 Contract-first preflight gate

Before implementation begins, the agent MUST verify the executable cross-component contracts against the final Contract Lock in the Overarching TDR. The agent MUST NOT rely on an earlier section containing a stale component version or dependency version.

For each boundary, verify:

```text
caller
adapter
wire/schema version
component version
required fields
field mapping
response mapping
failure semantics
sync/async behavior
persistence owner
observability requirements
```

A contract mismatch is an implementation blocker even when the individual component code is otherwise valid.

## 49.2 Final component versions

```text
MCOS + LangGraph                 4.4
IDCE                              1.6
CSRE                              5.4
Semantic Enrichment               4.4
GPC Resolver                      4.4
WRS                               4.4
Evidence System                   4.4
Market Knowledge Graph            1.1
Overarching Architecture          1.3
This implementation directive     1.2
```

Existing wire schemas remain backward-compatible unless explicitly changed in the final Contract Lock. Component version is not the same as wire/schema version.

## 49.3 Do not merge semantic authorities

The agent MUST NOT merge IDCE and CSRE into one architectural component.

A runtime optimization MAY use one model invocation to produce both intent and semantic hypotheses when the outputs are subsequently projected into the separate authoritative IDCE and CSRE contracts and independently validated.

The architecture remains:

```text
IDCE = authoritative user objective semantics
CSRE = authoritative referent semantics
LangGraph = authoritative orchestration
```

## 49.4 Performance is measured, not assumed

Live Test Mode MUST record:

- number of LLM invocations per turn;
- sequential LLM depth;
- parallel LLM width;
- per-call latency;
- total turn latency;
- p50/p95/p99 latency;
- retry count;
- schema-repair count;
- specialist failure count;
- prompt/model versions.

No architectural consolidation may be justified solely from an assumed compound error or assumed latency figure. Optimizations MUST be supported by live measurements.

## 49.5 GPC is not a universal synchronous gate

The implementation MUST allow buyer/vendor discovery workflows to proceed from a valid MarketConcept into Matching & Fanout without requiring a successful GPC mapping when GPC is not required by the active workflow.

GPC classification MAY execute synchronously when a workflow requires it and SHOULD execute asynchronously when it is useful for learning, analytics, or future retrieval but does not block the current transaction.

## 49.6 Market-language learning

The implementation MUST treat merchant-originated and buyer-originated market-language observations as first-class evidence sources. Deep Nigerian trade language may not be web-indexed; the marketplace itself therefore becomes an important language-grounding source.

The resulting learning path is:

```text
market interaction / audio transcript / text
        ↓
CSRE observation
        ↓
Evidence
        ↓
corroboration / independence evaluation
        ↓
MKG lexical-commercial knowledge
        ↓
future CSRE / Enrichment context
```

The learning loop MUST remain uncertainty-aware and provenance-preserving.

## 49.7 No self-proving promotion

The agent MUST preserve the rule that an Evidence-derived knowledge record cannot serve as independent direct evidence for the same claim.

Novel phrase-to-concept or commercial-relationship knowledge SHOULD begin as a candidate/provisional state and require corroboration appropriate to the claim type before becoming a strong durable relationship.

Corroboration may include:

- explicit merchant confirmation;
- explicit buyer confirmation;
- multiple independent vendors;
- multiple independent buyers;
- repeated observations across time/locations;
- authoritative or high-quality external evidence where available.

Do not require manual confirmation for every relationship; confidence policy MUST be claim-sensitive.

## 49.8 Datastore strategy

Do not introduce distributed transaction assumptions across PostgreSQL, Redis, pgvector, graph storage, and object storage.

Use explicit ownership and asynchronous projection/outbox patterns where cross-store propagation is required:

```text
transactional write
   ↓
outbox/event
   ↓
projection / Evidence / MKG update
```

The graph store remains the source of truth for graph relationships; PostgreSQL remains the source of truth for transactional application records; Redis remains coordination/cache state; object storage remains large artifact/media storage.

Replacing graph/RDF with relational JSON solely to reduce infrastructure is NOT an architectural requirement and must not be done without a measured workload-driven decision.

## 49.9 Live implementation acceptance gate

A vertical slice is not accepted until Live Test Mode can show:

```text
input
→ logical turn
→ IDCE result
→ CSRE result
→ enrichment result
→ optional GPC mapping
→ capability/matching decision
→ evidence observations
→ belief updates
→ GraphChangeDecision
→ MKG reads/writes
→ persisted domain state
→ final response
```

The agent MUST expose the exact adapter payloads at specialist boundaries in safe diagnostic mode so contract failures are directly inspectable.
