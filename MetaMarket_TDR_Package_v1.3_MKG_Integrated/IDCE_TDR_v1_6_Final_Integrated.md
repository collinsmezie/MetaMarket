# Intent Discovery & Classification Engine (IDCE) v1.6

**Document status:** Production-oriented Technical Design Requirements
**Revision:** Final integration hardening; executable service request/response contracts, deterministic correlation, logical-turn input, clarification handoff, and prompt/schema binding
**System:** MetaMarket / BizApp Conversational Commerce Platform
**Primary runtime:** TypeScript / Node.js
**Orchestration owner:** MCOS + LangGraph
**Semantic peer:** Commercial Semantic Resolution Engine (CSRE)
**Version:** 1.6

---

## 1. Purpose

The Intent Discovery & Classification Engine (IDCE) determines **what the user is trying to accomplish** in a conversational turn.

IDCE is deliberately independent from semantic object resolution. CSRE determines **what the user is referring to**; IDCE determines **what the user wants to do with, about, or through those things**; LangGraph determines **what the system should do next**.

The engine is designed for real-world commerce conversations where a single message may contain:

- one intent;
- several intents;
- several intents over the same object;
- several intents over different objects;
- intents with no commercial object;
- an intent continuing a previous workflow;
- a new intent interrupting an existing workflow;
- a request that mixes transaction, information, clarification, comparison, location, venue, and other objectives;
- Nigerian English, Nigerian Pidgin, slang, abbreviations, phonetic spelling, informal grammar, code switching, ellipsis, pronouns, and omitted context.

The target behavior is not simply high classification accuracy. It is **actionable intent understanding**: IDCE must expose enough structure for LangGraph to plan, sequence, clarify, execute, resume, suspend, or gracefully decline work without requiring a second opaque interpretation step.

---

## 2. Architectural Position

```text
                           RAW MESSAGE
                                │
                                ▼
                    ┌───────────────────────┐
                    │        MCOS           │
                    │ channel + identity +  │
                    │ conversation context  │
                    └───────────┬───────────┘
                                │
                      same turn context
                         ┌──────┴──────┐
                         ▼             ▼
                ┌─────────────┐ ┌─────────────┐
                │    CSRE     │ │    IDCE     │
                │ What is it? │ │ What do they│
                │             │ │ want to do? │
                └──────┬──────┘ └──────┬──────┘
                       │               │
                       └───────┬───────┘
                               ▼
                      ┌───────────────────┐
                      │     LangGraph     │
                      │ understanding +   │
                      │ planning + routing│
                      └─────────┬─────────┘
                                │
                                ▼
                         Workflows / Tools
```

### 2.1 Responsibility boundary

| Component | Primary question | Owns | Does not own |
|---|---|---|---|
| MCOS | How does the conversation operate? | channels, identity, persistence, locking, delivery, runtime | semantic truth, final intent meaning |
| CSRE | What is the user referring to? | expression segmentation, referents, semantic concepts, commercial interpretation | authoritative transaction intent |
| IDCE | What is the user trying to accomplish? | intent discovery, classification, scope, relations, priority, dependencies, confidence | object identity, workflow execution |
| LangGraph | What should happen next? | context assembly, intent/object coordination, planning, dependencies, routing, clarification, execution control | domain semantics, direct business-state mutation |
| Workflow | How is the business process executed? | deterministic domain state machine | open-ended interpretation |


---

## 2.3 Logical-Turn Input Contract

IDCE does not operate directly on transport-level message events. MCOS assembles one or more inbound messages into a **logical conversational turn** before invoking IDCE.

A logical turn may contain:

```typescript
export interface LogicalTurnInput {
  conversationId: string;
  turnId: string;
  messageIds: readonly string[];
  currentMessages: readonly TurnMessage[];
  assembledText: string;
  assemblyReason:
    | 'SINGLE_MESSAGE'
    | 'COALESCED_MESSAGES'
    | 'CONTINUATION_WINDOW'
    | 'EXPLICIT_USER_BATCH';
  previousTurnSummary: ConversationTurnSummary | null;
  contextSnapshot: IntentContext;
}
```

IDCE MUST reason over `assembledText` together with the ordered `currentMessages` because message boundaries can carry conversational meaning.

### Multi-message examples

```text
Message 1: "I need brake pads"
Message 2: "Toyota Camry"
Message 3: "2018"
Message 4: "near Warri"
```

The correct interpretation is one logical request:

```text
BUY/FIND_PRODUCT
object = brake pads
vehicle = Toyota Camry
model_year = 2018
location = Warri
```

IDCE MUST NOT create four unrelated BUY intents merely because four transport messages were received.

### Explicit corrections

```text
Message 1: "I need 10"
Message 2: "sorry make that 20"
```

The second message is a correction/modification of the quantity constraint, not necessarily a second purchase intent.

### Explicit cancellation / replacement

```text
"I need brake pads"
"Actually forget that"
"Find me a plumber"
```

This should resolve as a control transition plus a new objective, for example:

```text
CANCEL / CORRECT previous request
FIND_SERVICE(plumber)
```

The relationship between the new and prior objectives MUST be preserved so LangGraph can determine whether the earlier action should be cancelled, rolled back, abandoned, or merely superseded.

### Important boundary

IDCE does not decide whether two physical messages belong to one logical turn. **Turn Assembly is an MCOS responsibility.** IDCE receives the assembled result and determines the objectives expressed by that logical turn.


### 2.2 Non-goals

IDCE MUST NOT:

1. Resolve arbitrary terms into product meanings when CSRE should do so.
2. Assign GPC or taxonomy IDs.
3. Match or rank vendors.
4. Decide inventory truth.
5. Persist durable market knowledge.
6. Directly mutate domain workflow state.
7. Treat a workflow name as an intent.
8. Collapse multiple materially distinct intents into one simply because they share a workflow.
9. Create an intent merely because a token resembles an intent keyword.
10. Require the user to speak formal marketplace terminology.

---

## 3. Design Principles

### 3.1 Intent and object are independent dimensions

The same semantic object can participate in different intents:

```text
"I need a hammer"
    object = hammer
    intent = BUY / FIND_PRODUCT

"I sell hammers"
    object = hammer
    intent = SELL / OFFER

"How much is a hammer?"
    object = hammer
    intent = PRICE_INQUIRY

"Does anyone have a hammer?"
    object = hammer
    intent = AVAILABILITY_INQUIRY / FIND_VENDOR
```

### 3.2 Multiple intents are first-class

A turn may contain:

```text
"I need a hammer and nails. How much are they and who sells them around Warri?"

intents:
  BUY / FIND_PRODUCT
  PRICE_INQUIRY
  FIND_VENDOR
```

The intents MUST preserve their object scopes and relationships.

### 3.3 Scope is mandatory

Every resolved intent MUST identify what it applies to, unless it is genuinely conversation/account/system scoped.

Supported scopes include:

```text
OBJECT
OBJECT_SET
CONVERSATION
ACCOUNT
VENDOR
LOCATION
VENUE
WORKFLOW
TRANSACTION
MESSAGE
SYSTEM
```

### 3.4 Intent is not workflow

```text
INTENT
  ↓
ROUTING POLICY
  ↓
WORKFLOW / SPECIALIST / TOOL
```

Examples:

```text
RECHARGE_CREDITS → account/recharge workflow
BUY → buyer search workflow
PRICE_INQUIRY → buyer search or price inquiry operation
GREETING → greeting response node
CANCEL → workflow-specific cancellation operation
```

The engine may return routing hints, but LangGraph owns the authoritative routing decision.

### 3.5 Intent discovery must be context aware

IDCE MUST consume a bounded, explicit context package assembled by LangGraph. It MUST be capable of resolving elliptical turns such as:

```text
User: I want Bosch brake pads.
User: How much?

→ PRICE_INQUIRY
  scope.object = brake pads
  scope.brand = Bosch
```

Context must be evidence. It must not be used to invent an objective unsupported by the current turn.

### 3.6 Do not over-detect

The engine must not turn every clause into an intent.

```text
"I need a red hammer"

BUY

not:
BUY + COLOR_SPECIFICATION
```

Color is an object constraint/attribute and may be represented by CSRE/object state.

### 3.7 Do not under-detect

```text
"I need a hammer, and tell me if you have nails too"

BUY hammer
AVAILABILITY_INQUIRY nails
```

### 3.8 Only the strongest defensible decision wins

IDCE MUST rank candidate intents and select the strongest defensible interpretation. It MUST expose ambiguity only when multiple materially different interpretations remain plausible after context and evidence are considered.

### 3.9 Partial correctness is explicit

One intent can be highly confident while another is ambiguous:

```text
BUY hammer        confidence 0.98
PRICE_INQUIRY     confidence 0.96
FIND_VENDOR nails confidence 0.54, ambiguous
```

The engine MUST NOT downgrade the entire turn merely because one intent is uncertain.

---

## 4. Intent Taxonomy

The taxonomy is extensible. The following base set is required for production MVP.

### 4.1 Commercial transaction intents

```text
BUY
SELL
OFFER
REQUEST_QUOTE
PLACE_ORDER
CANCEL_ORDER
MODIFY_ORDER
CONFIRM_PURCHASE
NEGOTIATE
```

### 4.2 Discovery and marketplace intents

```text
FIND_PRODUCT
FIND_VENDOR
FIND_SERVICE
SEARCH
DISCOVER
RECOMMEND
COMPARE
ALTERNATIVES
SUBSTITUTE
```

### 4.3 Information intents

```text
PRICE_INQUIRY
AVAILABILITY_INQUIRY
PRODUCT_INFORMATION
VENDOR_INFORMATION
DELIVERY_INFORMATION
LOCATION_INFORMATION
PLATFORM_INFORMATION
POLICY_INFORMATION
```

### 4.4 Account and system intents

```text
RECHARGE_CREDITS
CHECK_BALANCE
VIEW_ACCOUNT
UPDATE_PROFILE
CHANGE_SETTINGS
HELP
CONTACT_SUPPORT
REPORT_PROBLEM
```

### 4.5 Conversation-control intents

```text
GREETING
THANKS
ACKNOWLEDGE
CONFIRM
DENY
CORRECT
CLARIFY
CANCEL
RESUME
PAUSE
REPEAT
REPHRASE
```

### 4.6 Vendor workflow intents

```text
START_VENDOR_ONBOARDING
CONTINUE_VENDOR_ONBOARDING
UPDATE_INVENTORY
UPDATE_CAPABILITY
UPDATE_LOCATION
UPDATE_SERVICE_AREA
```

### 4.7 Unsupported / meta intents

```text
NON_ACTIONABLE
OUT_OF_SCOPE
UNKNOWN_INTENT
```

These are not failure strings. They are explicit states that allow graceful routing.

---

## 5. Intent Model

Each detected intent MUST have the following conceptual shape.

```json
{
  "intent_id": "intent_123",
  "type": "BUY",
  "role": "PRIMARY",
  "status": "RESOLVED",
  "confidence": 0.97,
  "explicitness": "EXPLICIT",
  "scope": {
    "type": "OBJECT_SET",
    "object_ids": ["object_1", "object_2"],
    "conversation_scope": false
  },
  "evidence": {
    "signals": ["need", "looking for"],
    "explicit": true,
    "implicit": false,
    "context_used": true
  },
  "dependencies": [],
  "related_intents": [],
  "constraints": [],
  "routing_hints": [],
  "source_spans": ["I need a hammer and nails"],
  "priority": 0.91
}
```

---

## 6. Intent Roles

### 6.1 PRIMARY

The main objective most directly requested by the current turn.

### 6.2 SECONDARY

An independently requested objective that matters but is not the main objective.

### 6.3 SUPPORTING

An intent that assists another objective, such as `CLARIFY`, `COMPARE`, or a constraint-setting operation.

### 6.4 DEPENDENT

An intent that cannot execute until another intent resolves.

Example:

```text
"Find engine oil and tell me the cheapest option."

FIND_PRODUCT
PRICE_INQUIRY

PRICE_INQUIRY depends_on FIND_PRODUCT
```

---

## 7. Dependency Model

IDCE MUST identify semantic dependencies between intents.

Supported dependency relations:

```text
DEPENDS_ON
REQUIRES
PRECEDES
SUPPORTS
REFINES
CONTRADICTS
ALTERNATIVE_TO
```

Example:

```text
FIND_VENDOR
    ↓ enables
REQUEST_CONTACT
```

Another:

```text
FIND_PRODUCT
    ↓
COMPARE
    ↓
RECOMMEND
```

Independent intents MUST remain independent even if they happen to use the same workflow.

---

## 8. Intent Graph

```text
                  ┌──────────────┐
                  │    Intent    │
                  └──────┬───────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
     targets          depends_on       supports
        │                │                │
        ▼                ▼                ▼
     Object          Intent B          Intent C
```

The intent graph is transient orchestration input. Durable business graph state belongs to MCOS/workflows/evidence systems.

---

## 9. Context Contract

LangGraph MUST provide IDCE a normalized `IntentContext`.

```typescript
export interface IntentContext {
  conversationId: string;
  turnId: string;
  userId: string;
  channel: 'WHATSAPP' | 'WEB' | 'SMS' | 'USSD' | 'OTHER';
  /** Deprecated compatibility field. When logicalTurn is present, use logicalTurn.assembledText/currentMessages as authoritative. */
  currentMessage?: string | null;
  logicalTurn: LogicalTurnInput;
  recentMessages: readonly ConversationMessageContext[];
  activeWorkflows: readonly ActiveWorkflowContext[];
  suspendedWorkflows: readonly SuspendedWorkflowContext[];
  semanticObjects: readonly SemanticObjectContext[];
  priorIntentState: readonly IntentContextRecord[];
  locationContext: LocationContext | null;
  venueContext: VenueContext | null;
  userRole: 'BUYER' | 'VENDOR' | 'UNKNOWN';
  interactionMetadata: InteractionMetadata;
}
```

Context must be bounded to prevent prompt bloat. LangGraph owns the selection of relevant context; IDCE consumes it.

---

## 10. Relationship to CSRE

IDCE and CSRE are peers.

```text
                   Current Message
                         │
                  ┌──────┴──────┐
                  ▼             ▼
                CSRE           IDCE
             object truth    intent truth
                  │             │
                  └──────┬──────┘
                         ▼
                  LangGraph State
```

### 10.1 Object binding

Where possible, every commercial intent MUST reference `object_ids` produced by CSRE.

For example:

```json
{
  "intents": [
    {
      "type": "BUY",
      "scope": {
        "type": "OBJECT_SET",
        "object_ids": ["object_1", "object_2"]
      }
    }
  ]
}
```

### 10.2 Missing object resolution

IDCE may identify an intent even when CSRE has not resolved the object.

```text
"I need that one again"

intent = BUY
object = unresolved reference
```

The resulting state becomes `INCOMPLETE`, and LangGraph decides whether clarification or contextual recovery is necessary.

### 10.3 Intent without object

```text
"Hello"
"Recharge my credits"
"Cancel that"
"Help me"
```

These are valid IDCE outputs without commercial object IDs.

---

## 11. Discovery Pipeline

```text
RAW TURN
   ↓
LINGUISTIC NORMALIZATION
   ↓
CONTEXT ALIGNMENT
   ↓
ACT / OBJECT / RELATION SIGNAL EXTRACTION
   ↓
CANDIDATE INTENT GENERATION
   ↓
MULTI-INTENT STRUCTURING
   ↓
OBJECT BINDING
   ↓
DEPENDENCY + CONTRADICTION ANALYSIS
   ↓
CONFIDENCE ADJUDICATION
   ↓
STATUS CLASSIFICATION
   ↓
STRUCTURED INTENT OUTPUT
```

IDCE MAY perform these stages in one optimized model call for easy turns or multiple bounded calls for difficult turns. LangGraph decides which path is warranted.

---

## 12. Nigerian Language Requirements

IDCE MUST treat Nigerian language behavior as a first-class input condition.

### Required language patterns

- Nigerian English
- Nigerian Pidgin
- slang
- market shorthand
- pronunciation-driven spelling
- phonetic spellings
- code switching
- omitted subjects or verbs
- repeated words for emphasis
- informal spelling and punctuation
- local trade language
- role-dependent language
- location-dependent expressions

Examples:

```text
"abeg find person wey sell gen"
→ FIND_VENDOR / FIND_PRODUCT

"how much e be?"
→ PRICE_INQUIRY

"you get am?"
→ AVAILABILITY_INQUIRY

"I wan sell my phones"
→ SELL / OFFER

"where person dey do phone repair?"
→ FIND_SERVICE / FIND_VENDOR
```

The exact classification must depend on context, not keyword substitution alone.

---

## 13. Informal Conversation Phenomena

IDCE MUST support:

### Ellipsis

```text
User: I need Toyota brake pads.
User: How much?

→ PRICE_INQUIRY scoped to prior object
```

### Pronouns / references

```text
"Get me the smaller one"
→ BUY / SELECT / MODIFY depending on active context
```

### Corrections

```text
"I need 20, sorry, 30"
→ MODIFY the quantity constraint, not a second BUY intent
```

### Negation

```text
"I don't want the red one"
→ CORRECT / MODIFY constraint
```

### Contrast

```text
"I want a blender, not a mixer"
→ BUY blender + negative constraint on mixer
```

### Bundling

```text
"Find a plumber and also where I can buy PVC pipe"
→ FIND_SERVICE plumber
→ FIND_PRODUCT PVC pipe
```

### Digression

```text
Vendor onboarding active
"By the way, how much is your listing fee?"
→ PLATFORM_INFORMATION
```

### Return to prior workflow

```text
"Okay continue the registration"
→ RESUME / CONTINUE_VENDOR_ONBOARDING
```

---


---

## 13A. Multi-Message Semantic Behavior

When a logical turn contains multiple messages, IDCE MUST preserve the ordered discourse structure.

### 13A.1 Additive continuation

```text
"I need engine oil"
"for a 2015 Camry"
"5 litres"
```

Later messages refine the same objective.

Expected model:

```text
BUY/FIND_PRODUCT(engine oil)
constraints:
  vehicle = Toyota Camry 2015
  quantity/capacity = 5 litres
```

### 13A.2 Correction

```text
"Toyota"
"sorry Honda"
```

Represent the new information as a correction to the previously stated constraint.

### 13A.3 Retraction

```text
"Find brake pads"
"leave that"
```

Represent the second message as withdrawal/cancellation of the preceding objective.

### 13A.4 Topic switch

```text
"Find brake pads"
"also, how do I recharge my credits?"
```

These may belong to one logical turn if MCOS assembles them together, but IDCE MUST emit two distinct objectives:

```text
FIND_PRODUCT(brake pads)
RECHARGE_CREDITS(account)
```

### 13A.5 Independent batch

```text
"Find a plumber."
"And find someone selling PVC."
```

Emit independent intents with distinct object scopes and no false dependency.

### 13A.6 Pronoun and ellipsis carry-over

```text
"I need Bosch brake pads"
"How much?"
```

The second message inherits the relevant object from the current logical context:

```text
PRICE_INQUIRY
scope.object = prior brake pads
scope.brand = Bosch
```

### 13A.7 Do not use message count as intent count

Transport-message count, sentence count, clause count, and intent count are different quantities.

> **Intent boundaries are semantic/action boundaries, not punctuation or message boundaries.**


## 13B. Intent Context Precedence and Input Authority

When both `LogicalTurnInput` and legacy/current context fields are present, the following precedence is mandatory:

```text
LogicalTurnInput.assembledText
        ↓
LogicalTurnInput.currentMessages
        ↓
LogicalTurnInput.previousTurnSummary
        ↓
IntentContext.recentMessages / workflow context
```

The current logical turn is always the primary evidence for discovering current-turn intents. Historical context may resolve references, continuity, corrections, or omitted fields, but MUST NOT introduce unsupported new objectives.

The implementation MUST assign a stable `turnId` to every IDCE invocation. Re-running the same logical turn with the same context snapshot and schema/prompt versions MUST be idempotent.

---

## 14. Ambiguity Policy

IDCE MUST distinguish among:

```text
RESOLVED
INCOMPLETE
AMBIGUOUS
CONFLICTING
UNSUPPORTED
```

### RESOLVED

One interpretation clearly dominates.

### INCOMPLETE

The objective is known but required scope or context is missing.

### AMBIGUOUS

Two or more materially different objectives remain plausible.

### CONFLICTING

The message contains incompatible objectives or constraints that cannot safely be combined.

### UNSUPPORTED

The objective is understood but no currently supported capability can fulfill it.

---

## 15. Clarification Contract

IDCE may recommend clarification, but LangGraph owns whether and when the question is asked.

The question must:

- target the highest-value uncertainty;
- resolve multiple downstream decisions where possible;
- be natural in the conversation;
- avoid taxonomy terminology;
- not repeat information already known;
- preferably offer a small set of meaningful choices where suitable;
- never ask several unrelated questions at once.

Recommended output:

```json
{
  "clarification": {
    "required": true,
    "reason": "INTENT_SCOPE_AMBIGUITY",
    "target_intent_ids": ["intent_2"],
    "question": "Do you want to buy the engine oil, or are you asking which sellers stock it?"
  }
}
```

LangGraph may defer clarification if other parts of the turn can execute independently.

---


---

## 15A. Clarification Handoff Contract

IDCE may generate a clarification recommendation, but it MUST NOT send the question to the user.

The complete ownership chain is:

```text
IDCE
  ↓
clarification recommendation
  ↓
LangGraph clarification gate
  ↓
Response planning
  ↓
MCOS delivery engine
  ↓
User
```

IDCE's question is a **candidate conversational artifact**, not a delivery command.

IDCE MUST include:

```json
{
  "clarification": {
    "required": true,
    "reason": "INTENT_SCOPE_AMBIGUITY",
    "target_intent_ids": ["i2"],
    "question": "Are you looking to buy the pump, or are you asking which sellers stock it?",
    "blocking": true
  }
}
```

`blocking=true` means the unresolved issue blocks the target action, not necessarily every other action in the same turn.

LangGraph may therefore execute:

```text
A1 → independent platform information → complete
A2 → ambiguous product objective → pause
A3 → independent account action → complete
```

and ask one question specifically for A2.

IDCE MUST never directly invoke:
- channel adapters;
- WhatsApp/Web/SMS/USSD delivery;
- response delivery ports;
- user notification APIs.


## 16. Confidence Model

Confidence is distinct from semantic confidence.

```text
CSRE semantic confidence
        ≠
IDCE intent confidence
        ≠
GPC mapping confidence
        ≠
Vendor capability belief
```

Suggested factors:

```text
explicit linguistic signal
+ contextual fit
+ conversation continuity
+ object compatibility
+ dependency coherence
+ contradiction penalty
+ language certainty
+ prior interaction consistency
```

Scores use `0.000–1.000`.

IDCE MUST NOT imply certainty solely from a strong keyword.

---

## 17. Conflict Detection

The engine MUST detect conflicts such as:

```text
"I want to buy this, actually don't buy it"
```

or:

```text
"I need a Toyota Camry brake pad, but make it for a Honda Civic"
```

The conflict should be represented, not hidden.

```json
{
  "status": "CONFLICTING",
  "conflicts": [
    {
      "type": "OBJECT_CONSTRAINT_CONFLICT",
      "intents": ["intent_1"],
      "details": "vehicle model constraints disagree"
    }
  ]
}
```

---

## 18. Output Contract

The IDCE output is a **machine contract**, not merely an illustrative JSON example.
The canonical wire format is **snake_case JSON**. TypeScript types use camelCase internally and are serialized/deserialized at the service boundary.

```typescript
export interface IDCEResolution {
  resolutionStatus:
    | 'RESOLVED'
    | 'PARTIAL'
    | 'AMBIGUOUS'
    | 'CONFLICTING'
    | 'INCOMPLETE'
    | 'UNSUPPORTED';
  intents: readonly DiscoveredIntent[];
  relations: readonly IntentRelation[];
  clarification: ClarificationRecommendation | null;
  unresolved: readonly UnresolvedIntentIssue[];
  contextUsed: ContextUseRecord;
  modelMetadata: ResolutionModelMetadata;
}

export interface DiscoveredIntent {
  intentId: string;
  type: IntentType;
  role: 'PRIMARY' | 'SECONDARY' | 'SUPPORTING' | 'DEPENDENT';
  status:
    | 'RESOLVED'
    | 'AMBIGUOUS'
    | 'INCOMPLETE'
    | 'CONFLICTING'
    | 'UNSUPPORTED';
  confidence: number;
  explicitness: 'EXPLICIT' | 'IMPLICIT' | 'CONTEXTUAL';
  priority: number;
  scope: IntentScope;
  evidence: IntentEvidence;
  dependencies: string[];
  relatedIntents: string[];
  constraints: IntentConstraint[];
  sourceSpans: string[];
  routingHints: string[];
}

export interface IntentRelation {
  from: string;
  type:
    | 'DEPENDS_ON'
    | 'REQUIRES'
    | 'PRECEDES'
    | 'SUPPORTS'
    | 'REFINES'
    | 'CONTRADICTS'
    | 'ALTERNATIVE_TO'
    | 'CORRECTS'
    | 'CANCELS'
    | 'SUPERSEDES';
  to: string;
}

export interface ClarificationRecommendation {
  required: boolean;
  reason:
    | 'INTENT_SCOPE_AMBIGUITY'
    | 'MISSING_REQUIRED_INFORMATION'
    | 'CONFLICTING_OBJECTIVE'
    | 'UNRESOLVED_REFERENCE'
    | 'UNRESOLVED_CONTEXT'
    | 'OTHER';
  targetIntentIds: string[];
  question: string | null;
  blocking: boolean;
  expectedResolution: string | null;
}
```

### 18.1 Canonical JSON wire format

The following JSON is the canonical example and uses the exact field names expected by the validator and model adapter:

```json
{
  "resolution_status": "RESOLVED",
  "intents": [
    {
      "intent_id": "i1",
      "type": "BUY",
      "role": "PRIMARY",
      "status": "RESOLVED",
      "confidence": 0.980,
      "explicitness": "EXPLICIT",
      "priority": 0.910,
      "scope": {
        "type": "OBJECT_SET",
        "object_ids": ["object_1", "object_2"],
        "conversation_scope": false
      },
      "evidence": {
        "explicit": true,
        "implicit": false,
        "signals": ["need"],
        "context_used": true
      },
      "dependencies": [],
      "related_intents": [],
      "constraints": [],
      "source_spans": ["I need a hammer and nails"],
      "routing_hints": ["BUYER_SEARCH_WORKFLOW"]
    }
  ],
  "relations": [],
  "clarification": null,
  "unresolved": [],
  "context_used": {
    "conversation_history": true,
    "active_workflows": true,
    "semantic_objects": true,
    "location": false,
    "venue": false
  },
  "model_metadata": {
    "prompt_version": "idce-1.2",
    "schema_version": "idce-resolution-1.0"
  }
}
```

### 18.2 Executable JSON Schema

The implementation MUST maintain an executable schema equivalent to the following JSON Schema. The application MAY implement it directly in JSON Schema Draft 2020-12, Zod, TypeBox, Joi, or another validator, but the accepted wire contract MUST remain semantically equivalent.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/idce-resolution-1.0.json",
  "title": "IDCE Resolution",
  "type": "object",
  "additionalProperties": false,
  "required": ["resolution_status", "intents", "relations", "clarification", "unresolved", "context_used", "model_metadata"],
  "properties": {
    "resolution_status": { "enum": ["RESOLVED", "PARTIAL", "AMBIGUOUS", "CONFLICTING", "INCOMPLETE", "UNSUPPORTED"] },
    "intents": { "type": "array", "items": { "$ref": "#/$defs/intent" } },
    "relations": { "type": "array", "items": { "$ref": "#/$defs/relation" } },
    "clarification": { "anyOf": [{ "$ref": "#/$defs/clarification" }, { "type": "null" }] },
    "unresolved": { "type": "array", "items": { "$ref": "#/$defs/unresolvedIssue" } },
    "context_used": { "$ref": "#/$defs/contextUsed" },
    "model_metadata": { "$ref": "#/$defs/modelMetadata" }
  },
  "$defs": {
    "intent": {
      "type": "object",
      "additionalProperties": false,
      "required": ["intent_id", "type", "role", "status", "confidence", "explicitness", "priority", "scope", "evidence", "dependencies", "related_intents", "constraints", "source_spans", "routing_hints"],
      "properties": {
        "intent_id": { "type": "string", "minLength": 1 },
        "type": { "type": "string", "minLength": 1 },
        "role": { "enum": ["PRIMARY", "SECONDARY", "SUPPORTING", "DEPENDENT"] },
        "status": { "enum": ["RESOLVED", "AMBIGUOUS", "INCOMPLETE", "CONFLICTING", "UNSUPPORTED"] },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "explicitness": { "enum": ["EXPLICIT", "IMPLICIT", "CONTEXTUAL"] },
        "priority": { "type": "number", "minimum": 0, "maximum": 1 },
        "scope": { "$ref": "#/$defs/scope" },
        "evidence": { "$ref": "#/$defs/evidence" },
        "dependencies": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "related_intents": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "constraints": { "type": "array", "items": { "$ref": "#/$defs/constraint" } },
        "source_spans": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "routing_hints": { "type": "array", "items": { "type": "string", "minLength": 1 } }
      }
    },
    "scope": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "object_ids", "workflow_ids", "conversation_scope"],
      "properties": {
        "type": { "enum": ["OBJECT", "OBJECT_SET", "CONVERSATION", "ACCOUNT", "VENDOR", "LOCATION", "VENUE", "WORKFLOW", "TRANSACTION", "MESSAGE", "SYSTEM"] },
        "object_ids": { "type": "array", "items": { "type": "string" } },
        "workflow_ids": { "type": "array", "items": { "type": "string" } },
        "conversation_scope": { "type": "boolean" }
      }
    },
    "evidence": {
      "type": "object",
      "additionalProperties": false,
      "required": ["explicit", "implicit", "context_used", "signals"],
      "properties": {
        "explicit": { "type": "boolean" },
        "implicit": { "type": "boolean" },
        "context_used": { "type": "boolean" },
        "signals": { "type": "array", "items": { "type": "string" } }
      }
    },
    "constraint": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "value", "polarity", "source_span"],
      "properties": {
        "type": { "type": "string", "minLength": 1 },
        "value": {},
        "polarity": { "enum": ["POSITIVE", "NEGATIVE"] },
        "source_span": { "type": "string", "minLength": 1 }
      }
    },
    "relation": {
      "type": "object",
      "additionalProperties": false,
      "required": ["from", "type", "to"],
      "properties": {
        "from": { "type": "string", "minLength": 1 },
        "to": { "type": "string", "minLength": 1 },
        "type": { "enum": ["DEPENDS_ON", "REQUIRES", "PRECEDES", "SUPPORTS", "REFINES", "CONTRADICTS", "ALTERNATIVE_TO", "CORRECTS", "CANCELS", "SUPERSEDES"] }
      }
    },
    "clarification": {
      "type": "object",
      "additionalProperties": false,
      "required": ["required", "reason", "target_intent_ids", "question", "blocking", "expected_resolution"],
      "properties": {
        "required": { "type": "boolean" },
        "reason": { "enum": ["INTENT_SCOPE_AMBIGUITY", "MISSING_REQUIRED_INFORMATION", "CONFLICTING_OBJECTIVE", "UNRESOLVED_REFERENCE", "UNRESOLVED_CONTEXT", "OTHER"] },
        "target_intent_ids": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "question": { "type": ["string", "null"] },
        "blocking": { "type": "boolean" },
        "expected_resolution": { "type": ["string", "null"] }
      }
    },
    "unresolvedIssue": {
      "type": "object",
      "additionalProperties": false,
      "required": ["issue_id", "type", "status", "description", "related_intent_ids", "source_spans"],
      "properties": {
        "issue_id": { "type": "string", "minLength": 1 },
        "type": { "type": "string", "minLength": 1 },
        "status": { "enum": ["AMBIGUOUS", "INCOMPLETE", "CONFLICTING", "UNRESOLVED"] },
        "description": { "type": "string", "minLength": 1 },
        "related_intent_ids": { "type": "array", "items": { "type": "string" } },
        "source_spans": { "type": "array", "items": { "type": "string" } }
      }
    },
    "contextUsed": {
      "type": "object",
      "additionalProperties": false,
      "required": ["conversation_history", "active_workflows", "semantic_objects", "location", "venue"],
      "properties": {
        "conversation_history": { "type": "boolean" },
        "active_workflows": { "type": "boolean" },
        "semantic_objects": { "type": "boolean" },
        "location": { "type": "boolean" },
        "venue": { "type": "boolean" }
      }
    },
    "modelMetadata": {
      "type": "object",
      "additionalProperties": false,
      "required": ["prompt_version", "schema_version"],
      "properties": {
        "prompt_version": { "type": "string", "minLength": 1 },
        "schema_version": { "type": "string", "minLength": 1 }
      }
    }
  },
  "allOf": [
    {
      "if": {
        "properties": {
          "clarification": {
            "type": "object",
            "properties": { "required": { "const": true } },
            "required": ["required"]
          }
        },
        "required": ["clarification"]
      },
      "then": {
        "properties": {
          "clarification": {
            "type": "object",
            "required": ["question", "target_intent_ids"]
          }
        }
      }
    }
  ]
}
```

### 18.3 Validation and serialization invariants

1. The LLM adapter MUST request structured output using the executable schema where the selected model/provider supports schema-constrained generation.
2. The adapter MUST validate every response before returning it from `IntentDiscoveryPort`.
3. Exactly one schema-repair attempt is permitted for syntactically or structurally invalid output.
4. A repair attempt MUST NOT invent missing business facts; it may only repair formatting/shape.
5. The service MUST normalize snake_case wire fields into camelCase internal types.
6. Serialization back to the wire format MUST normalize camelCase into snake_case.
7. Unknown top-level fields MUST be rejected.
8. `confidence` and `priority` MUST be clamped/rejected outside `[0,1]`.
9. Empty intent arrays are valid only for turn states explicitly permitted by policy and MUST NOT be used to hide model failure.
10. `clarification.required=true` MUST imply a non-null `clarification.question` and at least one target issue.
11. If `clarification.required=false`, the clarification object MUST be `null` or contain `question=null` with no target IDs.
12. Every relation endpoint and dependency MUST reference an existing intent ID; dependency edges MUST be acyclic for execution relations.

---

## 19. Candidate Generation Strategy

Candidate generation should combine:

1. linguistic action signals;
2. conversation context;
3. prior workflow state;
4. semantic object availability;
5. local language knowledge;
6. interaction patterns;
7. constrained intent taxonomy retrieval;
8. domain policy where available.

The engine MUST not blindly enumerate every intent. Candidate generation should be selective and context-aware.

---

## 20. Adjudication Strategy

The adjudicator MUST evaluate candidate intent sets, not only individual intents.

For each candidate set:

```text
set_score =
    semantic_fit
  + context_fit
  + object_scope_fit
  + discourse_fit
  + dependency_coherence
  - contradiction_penalty
  - unsupported_assumption_penalty
```

The final decision is the highest-scoring **defensible** interpretation.

A lower-scoring alternative is exposed only when it remains materially plausible and changes downstream action.

---

## 21. Idempotency and Determinism

Given the same:

```text
normalized message
+ context snapshot
+ model configuration
+ taxonomy version
```

IDCE should produce materially equivalent intent structure.

Every intent receives a turn-scoped stable ID.

The service must support an idempotency key:

```text
idce:{conversation_id}:{turn_id}:{understanding_revision}
```

Repeated requests MUST NOT create duplicate persistent intent records because IDCE's core output is turn-scoped orchestration state.

---

## 22. Performance Requirements

Target budgets:

| Path | Target |
|---|---:|
| simple intent fast path | < 500 ms p95 excluding model cold start |
| normal multi-intent turn | < 2.5 s p95 |
| difficult ambiguity path | < 6 s p95 before clarification |
| timeout | bounded by MCOS turn deadline |

The engine must support provider failover through the shared MCOS LLM provider abstraction. Direct provider SDK calls from IDCE are prohibited when they bypass platform failover, circuit breakers, tracing, or token accounting.

---

## 23. Failure Handling

### LLM timeout

Return a typed `TEMPORARY_FAILURE` result to LangGraph. Do not fabricate intent.

### Provider failure

Use the shared provider failover chain.

### malformed model output

Run schema validation; attempt one constrained repair; otherwise return typed failure.

### partial CSRE failure

Proceed with non-object intents where possible.

### partial IDCE failure

LangGraph may fall back to deterministic handlers for explicit interaction payloads, workflow buttons, commands, or strong deterministic identifiers.

### unsupported intent

Return `UNSUPPORTED`; LangGraph routes to capability fallback or Triage.

---

## 24. Security and Safety

IDCE MUST treat user text as data, not executable policy.

Prompt injection, instruction-like content, quoted messages, pasted documents, and vendor-originated free text must not change IDCE's system boundaries.

External evidence or retrieved content may inform candidate interpretation only after passing through trusted evidence/context interfaces.

---

## 25. Observability

Every invocation MUST emit structured telemetry:

```text
conversation_id
turn_id
model_provider
model_name
latency_ms
input_token_count
output_token_count
candidate_count
intent_count
resolved_count
ambiguous_count
clarification_required
context_items_used
fallback_used
schema_repair_used
failure_type
```

The platform should also log:

```text
input span → intent type → confidence → resulting workflow/action
```

without exposing secrets or sensitive payloads in general logs.

---

## 26. Evaluation Suite

The benchmark MUST include:

### Single intent

```text
"I need a generator"
→ BUY / FIND_PRODUCT
```

### Multi-intent

```text
"I need a generator, how much is it and who sells one in Warri?"
→ BUY/FIND_PRODUCT
→ PRICE_INQUIRY
→ FIND_VENDOR
```

### Different object scopes

```text
"Find a plumber and buy PVC"
→ FIND_SERVICE(plumber)
→ BUY(PVC)
```

### Context continuation

```text
Turn 1: "I need Toyota brake pads"
Turn 2: "How much?"
→ PRICE_INQUIRY(brake pads)
```

### Workflow continuation

```text
"Yes continue the onboarding"
→ CONTINUE_VENDOR_ONBOARDING
```

### Digression

```text
"By the way, what is the monthly listing fee?"
→ PLATFORM_INFORMATION
```

### Pidgin

```text
"you get engine oil?"
→ AVAILABILITY_INQUIRY(engine oil)
```

### Correction

```text
"Give me 10. Sorry, make that 20"
→ MODIFY(previous quantity)
```

### Negative constraint

```text
"I want a blender, not a mixer"
→ BUY(blender) + negative constraint(mixer)
```

### Ambiguous

```text
"Find me a pump"
```

Must not invent a pump subtype if context cannot distinguish it.

### Non-object

```text
"Hello"
→ GREETING
```

### Unsupported

```text
[syntactically understandable but unsupported action]
→ UNSUPPORTED
```

---

## 27. Quality Gates

The implementation is production-ready only when:

1. multi-intent recall is measured separately from single-intent accuracy;
2. object binding accuracy is measured;
3. intent-scope accuracy is measured;
4. dependency accuracy is measured;
5. Nigerian language test coverage exists;
6. false-positive intent detection is below the agreed threshold;
7. ambiguous cases are preserved rather than hallucinated;
8. the engine can operate without a resolved product object;
9. schema validation rejects malformed output;
10. all LLM calls pass through MCOS's provider abstraction;
11. latency and token budgets are observable;
12. regression tests cover previous production failures.

---


---

# 28. Production Master Prompt

The following prompt is the authoritative behavioral instruction for the IDCE model. Implementations MUST version this prompt independently from application code.

```text
SYSTEM ROLE: INTENT DISCOVERY & CLASSIFICATION ENGINE (IDCE)

You are the Intent Discovery & Classification Engine for a conversational commerce platform.

YOUR SINGLE PRIMARY RESPONSIBILITY

Determine what the user is trying to accomplish in the current logical conversational turn.

You answer:

    "What does the user want the system to accomplish?"

You do NOT answer:

    "What exactly is the object?"
    "Which taxonomy category is this?"
    "Which vendor should be selected?"
    "Which workflow state should be mutated?"

Those decisions belong to other systems.

==================================================
ARCHITECTURAL BOUNDARY
==================================================

CSRE owns semantic referent resolution:
    "What is the user referring to?"

IDCE owns intent resolution:
    "What are they trying to do with, about, or through it?"

LangGraph owns orchestration:
    "What should the system do next?"

Deterministic workflows own business execution:
    "How is the requested operation actually performed?"

Never silently cross these boundaries.

==================================================
INPUT
==================================================

You receive a LOGICAL CONVERSATIONAL TURN.

It may contain one or multiple transport messages that MCOS has assembled
because they form one conversational unit.

The input may include:

- ordered current messages
- assembled turn text
- preceding conversation context
- active workflows
- suspended workflows
- prior intent context
- CSRE semantic objects
- locations
- venues
- user role
- interaction metadata

Do not treat each transport message as a separate intent merely because
it is separately delivered.

Intent boundaries are semantic/action boundaries.

==================================================
PRIMARY TASK
==================================================

Discover every materially distinct user objective expressed by the current
logical turn.

For each objective determine:

1. intent type
2. role
3. status
4. confidence
5. explicitness
6. scope
7. object binding
8. evidence
9. constraints
10. dependencies
11. relations to other intents
12. source spans
13. routing hints where useful

==================================================
MULTI-INTENT RULE
==================================================

A turn may contain multiple independent objectives.

Example:

"I need a generator, how much is it and who sells one in Warri?"

Discover:

- BUY/FIND_PRODUCT
- PRICE_INQUIRY
- FIND_VENDOR

Bind all three to the same semantic object if that is what the user means.

Do not collapse them simply because one workflow can execute them.

==================================================
MULTI-OBJECT RULE
==================================================

Different objects may have different intents.

Example:

"Find a plumber and help me buy PVC pipe."

Return:

- FIND_SERVICE -> plumber
- BUY/FIND_PRODUCT -> PVC pipe

Do not merge the objects.

==================================================
OBJECT INDEPENDENCE
==================================================

CSRE owns object identity.

Use CSRE object IDs whenever supplied.

If object identity is unresolved, the intent may still be detected,
but mark the intent INCOMPLETE or appropriately scoped as unresolved.

Never invent an object merely to make an intent look complete.

==================================================
CONTEXT
==================================================

Use provided conversation context aggressively but legitimately.

Context may resolve:

- pronouns
- ellipsis
- omitted objects
- references to previous turns
- workflow continuation
- corrections
- implied scope

Example:

User: "I need Bosch brake pads."
User: "How much?"

Resolve the second objective as PRICE_INQUIRY for the prior brake pads.

Context is evidence, not permission to invent a new objective.

==================================================
MULTI-MESSAGE DISCOURSE
==================================================

Treat ordered messages as discourse when they are part of the same logical turn.

ADD:

"I need brake pads"
"Toyota Camry"
"2018"

→ one BUY/FIND_PRODUCT objective with accumulated constraints.

CORRECTION:

"I need 10"
"sorry make that 20"

→ one objective with a corrected quantity constraint.

RETRACTION:

"Find brake pads"
"forget that"

→ CANCEL/CORRECT previous objective.

TOPIC SWITCH:

"Find brake pads"
"Actually what is the listing fee?"

→ two objectives when both belong to the assembled logical turn:
  FIND_PRODUCT
  PLATFORM_INFORMATION

Do not confuse transport-message count with intent count.

==================================================
NEGATION AND CORRECTION
==================================================

Distinguish:

"I want a blender, not a mixer"

from:

"I want a blender and a mixer."

The first contains a negative constraint.
The second contains two positive object references.

Distinguish:

"Toyota — sorry Honda"

as a correction from two simultaneous vehicle requests.

==================================================
INTENT TYPES
==================================================

Use the provided intent taxonomy.

Do not manufacture a novel intent label merely because the wording is unusual.

When the taxonomy lacks a supported objective:

- use UNKNOWN_INTENT or UNSUPPORTED appropriately
- preserve the evidence
- let LangGraph determine the next handling path

==================================================
NIGERIAN LANGUAGE
==================================================

Understand meaning expressed through:

- Nigerian English
- Nigerian Pidgin
- slang
- market shorthand
- phonetic spelling
- pronunciation-driven spelling
- code switching
- informal grammar
- omitted words
- repeated words
- local trade terminology
- regional usage

Examples:

"you get engine oil?"
→ AVAILABILITY_INQUIRY

"abeg find person wey sell gen"
→ FIND_VENDOR / FIND_PRODUCT

"how much e be?"
→ PRICE_INQUIRY using relevant context

"I wan sell my phones"
→ SELL / OFFER

Do not perform keyword substitution without discourse and context analysis.

==================================================
ROLE AND OBJECTIVE SEPARATION
==================================================

"I sell phones"
→ SELL/OFFER

"I need phones"
→ BUY/FIND_PRODUCT

"How much are phones?"
→ PRICE_INQUIRY

Same object, different objective.

==================================================
DO NOT OVER-DETECT
==================================================

Do not turn every noun, attribute, qualifier, or relationship into an intent.

"I need a red hammer"

→ BUY

"red" is a constraint, not a separate intent.

==================================================
DO NOT UNDER-DETECT
==================================================

"I need a hammer and tell me if you have nails too"

→ BUY/FIND_PRODUCT(hammer)
→ AVAILABILITY_INQUIRY(nails)

==================================================
DEPENDENCIES
==================================================

Identify true semantic dependencies.

Example:

FIND_PRODUCT
    ↓
PRICE_INQUIRY("cheapest")

or:

FIND_VENDOR
    ↓
REQUEST_CONTACT

Do not create a dependency merely because two intents are related.

==================================================
CONFLICTS
==================================================

Preserve materially conflicting objectives or constraints.

Example:

"I need Toyota Camry brake pads, but make it Honda Civic"

→ CONFLICTING constraint state

Do not silently choose one side unless the input itself clearly establishes
a correction or final replacement.

==================================================
STRONGEST DEFENSIBLE DECISION
==================================================

Generate plausible candidates internally, but return only the strongest
defensible interpretation.

Do not expose weak alternatives unless they remain materially plausible
AND would change downstream execution.

Never manufacture ambiguity to appear cautious.

Never manufacture certainty to appear decisive.

==================================================
CLARIFICATION
==================================================

You may recommend exactly one high-information clarification question.

Recommend clarification ONLY when:

- the unresolved issue materially affects action selection;
- available context and evidence cannot resolve it;
- the question can significantly reduce uncertainty.

The question must:

- be natural
- be concise
- use everyday language
- avoid taxonomy terminology
- avoid repeating known information
- preferably distinguish concrete alternatives

You are NOT sending the question.

Return it as a structured recommendation for LangGraph.

==================================================
NO WORKFLOW DECISION
==================================================

Routing hints are allowed.

Do not claim:

"this must use workflow X"

as authoritative business routing.

LangGraph owns routing.

==================================================
NO TAXONOMY / MATCHING
==================================================

Never:

- assign GPC
- choose vendors
- rank vendors
- determine stock truth
- mutate inventory
- mutate workflows
- persist market knowledge

==================================================
OUTPUT DISCIPLINE
==================================================

Return valid JSON conforming exactly to the IDCE schema.

Do not return prose outside the schema.

Confidence must be numeric 0.000–1.000.

Do not assign 0.999 or 1.000 casually.

==================================================
FINAL INTERNAL CHECK
==================================================

Before responding verify:

1. Did I discover all materially distinct objectives?
2. Did I avoid inventing objectives?
3. Did I bind intents to the correct objects/scopes?
4. Did I use context without hallucinating?
5. Did I detect corrections and retractions?
6. Did I distinguish constraints from intents?
7. Did I identify true dependencies?
8. Did I preserve genuine conflicts?
9. Did I understand local/informal language?
10. Did I recommend clarification only if necessary?
11. Did I keep workflow routing outside my authority?
12. Is the output schema-valid?
```

### 28.1 Prompt variables

The runtime MUST inject structured values rather than concatenating uncontrolled instructions into the system prompt.

Recommended variables:

```text
{{current_messages}}
{{assembled_text}}
{{previous_turn_summary}}
{{semantic_objects}}
{{active_workflows}}
{{suspended_workflows}}
{{prior_intent_state}}
{{location_context}}
{{venue_context}}
{{user_role}}
{{intent_taxonomy_version}}
{{policy_version}}
```

User content and retrieved evidence MUST be clearly delimited as data.

### 28.2 Prompt safety

Quoted text, pasted documents, vendor messages, retrieved web text, and user-authored instructions inside the input MUST be treated as data.

They MUST NOT override the system prompt or IDCE's architectural boundaries.


## 29. Reference Runtime Interface

```typescript
export interface IntentDiscoveryPort {
  discover(context: IntentContext): Promise<IDCEResolution>;
}
```

Implementation layering:

```text
IntentDiscoveryPort
      │
      ├── IntentContextBuilder
      ├── CandidateIntentGenerator
      ├── IntentAdjudicator
      ├── ScopeBinder
      ├── DependencyAnalyzer
      ├── ConflictAnalyzer
      ├── ClarificationRecommender
      └── IntentSchemaValidator
```

No component below IDCE should call another provider directly.

---

## 29A. Runtime Failure Envelope

Transport-level and model execution failures are not encoded as fabricated intent results. The runtime MUST return a typed failure envelope around the invocation result:

```typescript
export interface IDCEInvocationResult {
  status: 'SUCCESS' | 'TEMPORARY_FAILURE' | 'SCHEMA_FAILURE' | 'POLICY_FAILURE';
  resolution: IDCEResolution | null;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
}
```

`IntentDiscoveryPort.discover()` MAY expose the successful `IDCEResolution` directly for application simplicity, but the underlying adapter MUST preserve this distinction internally so LangGraph never mistakes a provider failure for `UNKNOWN_INTENT`.

---

## 30. Final Architectural Rule

> **CSRE resolves the referent. IDCE resolves the user's objective. LangGraph decides how those truths combine into the next action.**

This separation is the foundation that allows messy language, multiple objects, multiple intents, workflow continuity, and deterministic business execution to coexist without creating one giant opaque reasoning component.


---

## 31. Revision Invariants

This version establishes the following non-negotiable rules:

1. **Logical turns are the IDCE input unit.** Multiple transport messages may form one logical turn.
2. **Clarification is a recommendation, not a delivery action.** LangGraph gates it and MCOS delivers it.
3. **Prompt behavior is part of the production contract.** The master prompt is versioned, schema-bound, observable, and tested alongside the implementation.
4. **The IDCE wire contract is executable.** The JSON Schema is authoritative for LLM structured output and runtime validation.
5. **Wire and TypeScript casing are explicit.** Snake_case is canonical over the service boundary; camelCase is internal.
6. **One clarification recommendation can contain exactly one user-facing question.** It may target multiple dependent issues.
7. **IDCE never directly sends user-facing messages or mutates workflow state.**
8. **A provider/schema failure is never represented as a fabricated intent.**


---

# 22. FINAL IMPLEMENTATION INTEGRATION CONTRACT — v1.4

This section is authoritative for the MCOS/LangGraph ↔ IDCE service boundary. The existing
IDCE model output schema remains a valid internal model-output contract; this section adds the
service-level envelope needed for production integration and correlation.

## 22.1 Canonical IDCE service request

```typescript
export interface IDCEServiceRequest {
  schemaVersion: '1.1';
  requestId: string;
  component: 'IDCE';
  componentVersion: '1.4';
  conversationId: string;
  turnId: string;
  runId: string;
  contextSnapshotId: string;
  logicalTurn: LogicalTurnInput;
  policyVersion: string;
}
```

Canonical wire representation:

```json
{
  "schema_version": "1.1",
  "request_id": "idce-req-001",
  "component": "IDCE",
  "component_version": "1.4",
  "conversation_id": "conv-001",
  "turn_id": "turn-001",
  "run_id": "run-turn-001",
  "context_snapshot_id": "ctx-001",
  "logical_turn": {
    "conversation_id": "conv-001",
    "turn_id": "turn-001",
    "message_ids": ["msg-001", "msg-002"],
    "current_messages": [],
    "assembled_text": "I need brake pads Toyota Camry",
    "assembly_reason": "COALESCED_MESSAGES",
    "previous_turn_summary": null,
    "context_snapshot": {}
  },
  "policy_version": "idce-policy-1.0"
}
```

The `logical_turn` payload MUST be semantically equivalent to the existing `LogicalTurnInput`
contract in this document.

## 22.2 Canonical IDCE service response

```typescript
export interface IDCEServiceResponse {
  schemaVersion: '1.1';
  requestId: string;
  component: 'IDCE';
  componentVersion: '1.4';
  conversationId: string;
  turnId: string;
  runId: string;
  status: 'SUCCESS' | 'PARTIAL' | 'ERROR';
  resolution: IDCEResolution | null;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
}
```

The `resolution` field is the validated output of the executable
`idce-resolution-1.0.json` model contract from Section 18. The service envelope is a transport
and correlation contract; it does not create a second semantic intent model.

## 22.3 Machine-enforceable service envelope schemas

IDCE request schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/idce-service-request-v1.1.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "request_id",
    "component",
    "component_version",
    "conversation_id",
    "turn_id",
    "run_id",
    "context_snapshot_id",
    "logical_turn",
    "policy_version"
  ],
  "properties": {
    "schema_version": { "const": "1.1" },
    "request_id": { "type": "string", "minLength": 1 },
    "component": { "const": "IDCE" },
    "component_version": { "const": "1.4" },
    "conversation_id": { "type": "string", "minLength": 1 },
    "turn_id": { "type": "string", "minLength": 1 },
    "run_id": { "type": "string", "minLength": 1 },
    "context_snapshot_id": { "type": "string", "minLength": 1 },
    "logical_turn": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "conversation_id",
        "turn_id",
        "message_ids",
        "current_messages",
        "assembled_text",
        "assembly_reason",
        "previous_turn_summary",
        "context_snapshot"
      ],
      "properties": {
        "conversation_id": { "type": "string", "minLength": 1 },
        "turn_id": { "type": "string", "minLength": 1 },
        "message_ids": { "type": "array", "items": { "type": "string" } },
        "current_messages": { "type": "array" },
        "assembled_text": { "type": "string" },
        "assembly_reason": {
          "enum": [
            "SINGLE_MESSAGE",
            "COALESCED_MESSAGES",
            "CONTINUATION_WINDOW",
            "EXPLICIT_USER_BATCH"
          ]
        },
        "previous_turn_summary": { "type": ["object", "null"] },
        "context_snapshot": { "type": "object" }
      }
    },
    "policy_version": { "type": "string", "minLength": 1 }
  }
}
```

IDCE response schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/idce-service-response-v1.1.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "request_id",
    "component",
    "component_version",
    "conversation_id",
    "turn_id",
    "run_id",
    "status",
    "resolution",
    "error"
  ],
  "properties": {
    "schema_version": { "const": "1.1" },
    "request_id": { "type": "string", "minLength": 1 },
    "component": { "const": "IDCE" },
    "component_version": { "const": "1.4" },
    "conversation_id": { "type": "string", "minLength": 1 },
    "turn_id": { "type": "string", "minLength": 1 },
    "run_id": { "type": "string", "minLength": 1 },
    "status": { "enum": ["SUCCESS", "PARTIAL", "ERROR"] },
    "resolution": {
      "anyOf": [
        { "$ref": "https://metamarket.local/schemas/idce-resolution-1.0.json" },
        { "type": "null" }
      ]
    },
    "error": {
      "anyOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["code", "message", "retryable"],
          "properties": {
            "code": { "type": "string", "minLength": 1 },
            "message": { "type": "string", "minLength": 1 },
            "retryable": { "type": "boolean" }
          }
        },
        { "type": "null" }
      ]
    }
  }
}
```

## 22.4 Correlation invariants

1. `request_id` is unique per IDCE service invocation.
2. Repeated execution of the same `turn_id` with the same `context_snapshot_id`, prompt version,
   schema version, and policy version is idempotent.
3. `conversation_id`, `turn_id`, and `run_id` MUST match the MCOS invocation envelope.
4. Every returned `intent_id` belongs to the current response and is stable across a retry of the
   same deterministic invocation.
5. `routing_hints` are advisory only. LangGraph owns routing.
6. IDCE MUST NOT fabricate an intent because another specialist failed.
7. A clarification recommendation is returned as data; IDCE never sends the question itself.

## 22.5 Canonical type generation rule

`IntentType`, `IntentScope`, `IntentConstraint`, and related TypeScript types MUST be generated or
maintained from the intent taxonomy and the executable schema. The document's taxonomy in Section 4
is the authoritative base vocabulary. Implementations MUST reject unsupported values unless an
explicit extension namespace/policy is enabled.

## 22.6 MCOS handoff

```text
MCOS TurnInputState
       ↓
IDCE service request
       ↓
IDCE validated resolution
       ↓
LangGraph UnderstandingState.idce
       ↓
Plan Builder
```

The IDCE service response is unwrapped only after schema validation. The raw request/response
envelope, versions, and correlation identifiers remain in telemetry/audit storage.

---

# 10. NORMATIVE AGENDA COMPLETION — v1.5

**Effective:** 2026-09-10  
**Status:** Authoritative amendment.

## 10.1 Final boundary with CSRE and MKG

IDCE owns user objective semantics. CSRE owns referent semantics. MKG does not become an intent engine.

```text
IDCE: "What does the user want to accomplish?"
CSRE: "What are they referring to?"
MKG:  "What durable commercial relationships does the marketplace know about?"
LangGraph: "What should happen next?"
```

IDCE may use MKG-derived context only as supporting information when planning intent scope; it must not infer intent from graph relationships alone.

## 10.2 Multi-intent object binding

For every detected intent, IDCE should bind to `object_id` / `market_concept_id` where available rather than duplicating semantic interpretation. This preserves independent intents over shared and distinct objects.

## 10.3 Evidence of intent

IDCE may emit intent observations for Evidence, but Evidence owns persistence/fusion and no IDCE result directly mutates graph state or business state.



# 23. NORMATIVE AGENDA COMPLETION — v1.6 RUNTIME OPTIMIZATION + CONTRACT LOCK

**Effective:** 2026-09-12  
**Status:** Authoritative amendment.

## 23.1 Final component identity

```text
component               = IDCE
component_version       = 1.6
model output schema     = 1.0
service envelope       = 1.1
```

## 23.2 IDCE remains architecturally separate from CSRE

IDCE and CSRE are independent authorities. A runtime implementation MAY combine their model inference into one optimized model invocation, but MUST emit independently validated IDCE and CSRE outputs and preserve their separate ownership.

The architecture MUST remain:

```text
IDCE → objective semantics
CSRE → referent semantics
LangGraph → coordination/planning
```

## 23.3 MarketConcept/object binding

IDCE SHOULD reference existing `object_id` / `market_concept_id` supplied by the orchestrator when binding intent scope. IDCE MUST NOT reinterpret the physical referent merely to make an intent classification easier.

## 23.4 Intent confidence is not semantic evidence

An IDCE result is an intent decision, not evidence that the referenced object or vendor relationship is true. IDCE outputs MAY be persisted as intent observations for Evidence, but they MUST NOT become graph facts without the normal Evidence evaluation path.

## 23.5 Performance trace

Live Test Mode MUST expose IDCE model invocation count, latency, retries, schema repairs, and whether inference was performed independently or as a shared optimized model call with CSRE.
