# Multi-Channel Conversation Operating System (MCOS)
# Technical Design Requirements (TDR)
## Version 3.0

**Status:** Ready for Implementation

**Audience:** Backend Engineers, AI Engineers, Solution Architects

---

# 1. Purpose

Design and implement a **channel-agnostic conversation platform** capable of handling conversations from multiple communication channels while maintaining a unified conversational experience for every user.

Supported channels include:

- WhatsApp
- SMS
- Voice
- USSD

The architecture must support adding future channels without modifying core business logic.

---

# 2. Goals

The platform must:

- Support multimodal communication.
- Maintain long-running conversations.
- Support multiple concurrent workflows.
- Allow conversations to pause and resume naturally.
- Separate conversation logic from business logic.
- Separate AI from workflow execution.
- Be horizontally scalable.
- Be extensible with minimal coupling.

---

# 3. Core Design Principles

## 3.1 Channel Agnostic

Business logic must never know whether a message originated from WhatsApp, Voice, SMS or USSD.

Only Channel Adapters understand provider-specific payloads.

---

## 3.2 Conversation is the Root Aggregate

Everything revolves around a Conversation.

A Conversation owns:

- conversation context
- workflow registry
- history
- memory
- active workflow pointer

Channels never own conversations.

---

## 3.3 Workflows are Independent

Each business objective executes inside its own workflow instance.

Examples

- Customer Search
- Vendor Onboarding
- Wallet Funding(Recharge)
- Complaint

Multiple instances of the same workflow may coexist.

---

## 3.4 AI Assists

AI performs:

- intent detection
- extraction
- normalization
- reasoning
- summarization

AI never controls workflow execution.

---

## 3.5 Deterministic Workflow Execution

Business processes execute using deterministic state machines.

LLMs provide information.

The Workflow Engine makes decisions.

---

## 3.6 Logical Separation First

Components are separated by responsibility.

Initially they may exist as classes/modules inside one service.

They may later become microservices without architectural changes.

---

# 4. High-Level Architecture

```text
                   External Channels

 WhatsApp      SMS      Voice      USSD
       │         │         │         │
       ▼         ▼         ▼         ▼
               Channel Adapters
                       │
               Canonical Message
                       │
               Media Processing
                       │
                       ▼
        Conversation Context Manager
                       │
                       ▼
     Conversation Continuity Analyzer
                       │
          ┌────────────┴─────────────┐
          │                          │
          ▼                          ▼
 Workflow Manager          Intent Resolution
          │                          │
          │                 Semantic Resolution
          │                          │
          └──────────────┬───────────┘
                         ▼
                  Workflow Engine
                         ▼
                 Business Services
                         ▼
                 Response Composer
                         ▼
                Channel Formatter
                         ▼
                  External Channel
```

---

# 5. Core Components

---

# 5.1 Channel Adapter

One adapter per channel.

Examples

- WhatsAppAdapterPlatform
- SMSAdapter
- VoiceAdapter
- USSDAdapter

Responsibilities

- Receive messages
- Validate requests
- Authenticate provider
- Normalize payload
- Send responses
- Format provider-specific UI

Never:

- Execute workflows
- Call AI directly
- Perform business logic
- Store conversation state

---

# 5.2 Media Processing Service

Purpose

Convert raw media into structured artifacts.

Supports

- Speech-to-text
- OCR
- Vision
- Document Parsing
- Video Analysis
- Location Parsing

Output

```typescript
Artifact[]
```

Example

Voice

↓

Transcript

↓

Artifact(Text)

---

# 5.3 Conversation Context Manager

The owner of conversation state.

Responsibilities

- Create conversation
- Load conversation
- Load memory
- Load workflow registry
- Update history
- Persist conversation
- Maintain conversation locks
- Manage session metadata

Output

```typescript
ConversationContext
```

It never determines intent.

---

# 5.4 Conversation Continuity Analyzer

Purpose

Determine the relationship between the incoming message and the existing conversation.

Possible relationships

- Continuation
- Clarification Response
- Answer
- Correction
- Topic Shift
- Resume Workflow
- Cancel Workflow
- Restart Workflow
- New Conversation

Output

```typescript
interface ConversationRelationship {

    relationship:
        | "continuation"
        | "clarification"
        | "answer"
        | "correction"
        | "topic_shift"
        | "resume"
        | "cancel"
        | "restart"
        | "new";

    confidence:number;

    candidateWorkflowIds:string[];
}
```

This is **not** intent classification.

---

# 5.5 Workflow Manager

Responsible for workflow lifecycle.

Responsibilities

- startWorkflow()
- resumeWorkflow()
- suspendWorkflow()
- completeWorkflow()
- cancelWorkflow()
- archiveWorkflow()
- findRelevantWorkflow()
- setActiveWorkflow()
- listWorkflowInstances()

It decides **which workflow should execute**.

It never executes workflow logic.

---

# 5.6 Intent Resolution

Receives

Conversation Context

+

Incoming Message

Responsibilities

- Intent detection
- Entity extraction
- Language detection
- Command detection
- Confidence scoring

Output

```typescript
IntentResult
```

No GS1 logic belongs here.

---

# 5.7 Semantic Resolution

Purpose

Transform extracted entities into domain meaning.

Responsibilities

- Normalize products
- Resolve ontology
- Resolve GS1 taxonomy
- Expand synonyms
- Detect ambiguity
- Produce semantic request

Output

```typescript
SemanticRequest
```

Example

Input

```
hot flask
```

Output

```
vacuum flask

category:
Insulated Beverage Containers

ambiguity:
false
```

---

# 5.8 Workflow Engine

Executes workflows.

Responsibilities

- Execute states
- Execute transitions
- Validate transitions
- Invoke business services
- Publish events

Never

- Detect intent
- Know channels
- Manage conversations

---

# 5.9 Business Services

Examples

- Product Search
- Capability Inference
- Orders
- Payments
- Wallet
- Authentication
- Notifications

Business services contain business rules only.

---

# 5.10 Response Composer

Produces channel-independent responses.

Output

```typescript
interface Response{

text?:string;

media?:Media[];

actions?:Action[];

metadata?:object;

}
```

---

# 5.11 Conversation Policy Engine

Evaluates operational policies.

Examples

Can workflow be interrupted?

Can workflow expire?

Maximum suspended workflows?

Auto archive?

Maximum idle duration?

Workflow priority?

This keeps policy separate from execution.

---

# 6. Conversation Model

```typescript
Conversation{

id

userId

history

memory

workflowRegistry

activeWorkflowId

lastChannel

createdAt

updatedAt

}
```

---

# 7. Workflow Registry

The registry replaces a simple workflow stack.

```typescript
WorkflowRegistry{

activeWorkflowId

workflowInstances[]

}
```

Every workflow is independent.

---

# 8. Workflow Instance

```typescript
WorkflowInstance{

id

workflowType

currentState

status

summary

semanticFingerprint

importantEntities

createdAt

updatedAt

priority

resumable

expiresAt

}
```

Status

- Active
- Suspended
- Completed
- Cancelled
- Archived

---

# 9. Workflow Lifecycle

```text
Created

↓

Active

↓

Suspended

↓

Resumed

↓

Completed

↓

Archived
```

Multiple workflow instances may exist simultaneously.

---

# 10. Semantic Fingerprint

Every workflow maintains a semantic fingerprint.

Example

```json
{
  "intent":"buyer_search",
  "entities":[
      "vacuum flask",
      "thermal flask"
  ],
  "category":"Kitchenware",
  "keywords":[
      "hot flask",
      "insulated bottle"
  ]
}
```

Purpose

Workflow discovery.

---

# 11. Workflow Summary

Every workflow maintains a continuously updated summary.

Example

```
Customer Search

Searching for vacuum flask.

12 suppliers returned.

Waiting for supplier selection.
```

This summary is preferred over replaying the entire conversation.

---

# 12. Canonical Message Model

```typescript
interface IncomingMessage{

id:string;

conversationId:string;

userId:string;

channel:Channel;

timestamp:Date;

parts:MessagePart[];

metadata:any;

}
```

Message Parts

- Text
- Image
- Audio
- Video
- Document
- Contact
- Location
- Button Reply
- List Selection

---

# 13. Canonical Response Model

```typescript
interface Response{

text?:string;

media?:Media[];

actions?:Action[];

metadata?:object;

}
```

Adapters translate this into provider-specific responses.

---

# 14. Conversation Processing Pipeline

## Case A — Existing Workflow Continuation

```text
Receive Message

↓

Normalize

↓

Media Processing

↓

Load Conversation

↓

Conversation Continuity Analysis

↓

Workflow Manager

↓

Resume Workflow

↓

Workflow Engine

↓

Business Service

↓

Compose Response

↓

Send Response
```

---

## Case B — New Conversation

```text
Receive Message

↓

Normalize

↓

Media Processing

↓

Load Conversation

↓

Conversation Continuity Analysis

↓

Intent Resolution

↓

Semantic Resolution

↓

Workflow Manager

↓

Start Workflow

↓

Workflow Engine

↓

Business Service

↓

Compose Response

↓

Send Response
```

---

# 15. Workflow Discovery Strategy

Workflow Manager must use layered discovery.

Layer 1

Explicit workflow id

↓

Layer 2

Deterministic identifiers

(order id, seller id, product id)

↓

Layer 3

Entity matching

↓

Layer 4

Semantic fingerprint

↓

Layer 5

Embedding similarity

↓

Layer 6

Ask user for clarification

Never rely solely on embeddings.

---

# 16. Context Drift

If the incoming message is unrelated to the active workflow

Workflow Manager should

Suspend Active Workflow

↓

Start New Workflow

Never destroy unfinished workflows unless policy requires it.

---

# 17. Multiple Concurrent Workflows

Supported

Example

```
Customer Search
Hot Flask

Customer Search
Nail Gun

Customer Search
School Bag

Seller Onboarding

Complaint
```

Each owns independent state.

---

# 18. Storage

## PostgreSQL

Conversation

Workflow Registry

Workflow State

History

Memory Metadata

---

## Redis

Distributed Locking

Session Cache

Rate Limiting

Queue Coordination

---

## Object Storage

Images

Videos

Audio

Documents

---

# 19. Events

- MessageReceived
- MediaProcessed
- ConversationLoaded
- ContinuityAnalyzed
- IntentResolved
- SemanticResolved
- WorkflowStarted
- WorkflowResumed
- WorkflowSuspended
- WorkflowCompleted
- BusinessOperationCompleted
- ResponseCreated
- MessageSent
- MessageFailed

---

# 20. Scalability

Every compute component must be stateless.

Conversation state lives in storage.

Use distributed locking so only one worker processes a conversation at a time.

Heavy work

- OCR
- Vision
- STT

must execute asynchronously.

---

# 21. Recommended Technology Stack

Framework

- NestJS

Database

- PostgreSQL

Cache

- Redis

Queue

- BullMQ

Storage

- S3-compatible Object Storage

AI

- OpenAI Responses API (Structured Outputs + Tool Calling)

Observability

- OpenTelemetry
- Prometheus
- Grafana

---

# 22. Directory Structure

```text
src/

adapters/

media/

conversation/

context/

continuity/

workflow/

workflow-manager/

intent/

semantic/

business/

response/

events/

repositories/

shared/
```

---

# 23. Engineering Rules

Never

- Put business logic inside adapters.
- Allow AI to control workflow execution.
- Let workflows know about messaging channels.
- Couple business services to conversation logic.

Always

- Persist conversation state.
- Use canonical message models.
- Keep workflows resumable.
- Keep workflow summaries updated.
- Keep semantic fingerprints updated.

---

# 24. Acceptance Criteria

The implementation is complete when it can:

- Support WhatsApp, SMS, Voice and USSD through adapters.
- Handle multimodal input.
- Maintain one conversation context per user.
- Run multiple workflow instances simultaneously.
- Suspend and resume workflows naturally.
- Detect topic shifts.
- Resume workflows using semantic relevance.
- Maintain workflow summaries.
- Maintain semantic fingerprints.
- Support horizontal scaling.
- Add a new communication channel by implementing only a new adapter.
- Add a new business workflow without modifying the conversation platform.

---

# 25. Guiding Principle

> **The platform is not a chatbot. It is a Conversation Operating System.**

The Conversation Platform owns conversation state, context, continuity, workflow lifecycle, and orchestration. Business capabilities (Customer Search, vendor onboarding, payments, complaints, etc.) are implemented as independent, resumable workflow instances executed within this operating environment.

























---

# Test Input

```text
Channel: WhatsApp

Message Type: Voice Note

Audio:
"I need artist brush"
```

---

# Stage 1 — Channel Adapter (WhatsApp)

### Input

Raw Meta webhook

```json
{
  "provider": "Meta",
  "from": "+2348012345678",
  "timestamp": "2026-07-24T12:00:00Z",
  "type": "audio",
  "audio": {
    "id": "media_456"
  }
}
```

### Responsibilities

* Validate webhook
* Authenticate Meta request
* Normalize provider payload
* Download media (or produce a media reference)

### Output

```json
{
  "id": "msg_001",
  "conversationId": "conv_100",
  "userId": "user_15",
  "channel": "whatsapp",
  "timestamp": "2026-07-24T12:00:00Z",
  "parts": [
    {
      "type": "audio",
      "mediaId": "media_456"
    }
  ]
}
```

At this point the platform knows **nothing** about what was said.

---

# Stage 2 — Media Processing

Input

```json
{
  "type": "audio",
  "mediaId": "media_456"
}
```

Media Processing pipeline

```text
Download Audio

↓

Speech-to-Text

↓

Confidence Check

↓

Create Text Artifact
```

Assume STT returns

```text
"I need artist brush"
```

Output

```json
{
  "artifacts": [
    {
      "type": "text",
      "content": "I need artist brush",
      "confidence": 0.98,
      "source": "speech_to_text"
    }
  ]
}
```

Notice that from this point onward, every downstream component works with text—not audio.

---

# Stage 3 — Conversation Context Manager

Conversation lookup

```json
{
  "conversationId": "conv_100",
  "activeWorkflowId": null,
  "workflowRegistry": [],
  "history": []
}
```

The new message is appended to history.

Output

```json
{
  "conversationContext": {
    "conversationId": "conv_100",
    "activeWorkflowId": null,
    "workflowRegistry": []
  },
  "currentMessage": "I need artist brush"
}
```

---

# Stage 4 — Conversation Continuity Analyzer

Input

```json
{
  "activeWorkflowId": null,
  "message": "I need artist brush"
}
```

Analysis

* No active workflow
* No suspended workflow
* No pending clarification

Output

```json
{
  "relationship": "new",
  "confidence": 1.00,
  "candidateWorkflowIds": []
}
```

Decision

```text
Proceed with New Conversation Pipeline
```

---

# Stage 5 — Intent Resolution

Input

```json
{
  "conversationContext": {
    "activeWorkflowId": null
  },
  "message": "I need artist brush"
}
```

Responsibilities

* Detect intent
* Extract entities

Output

```json
{
  "intent": "buyer_product_search",
  "confidence": 0.99,
  "entities": {
    "product": "artist brush"
  },
  "language": "en"
}
```

No ontology or GS1 logic yet.

---

# Stage 6 — Semantic Resolution

Input

```json
{
  "intent": "buyer_product_search",
  "entities": {
    "product": "artist brush"
  }
}
```

Semantic Resolution performs:

```text
Normalize Product

↓

Resolve Ontology

↓

Resolve GS1 Taxonomy

↓

Expand Synonyms

↓

Detect Ambiguity
```

Suppose the marketplace ontology contains:

* Artist Brush
* Paint Brush
* Makeup Brush
* Cleaning Brush

The phrase "artist brush" is specific enough.

Output

```json
{
  "semanticRequest": {
    "intent": "buyer_product_search",
    "product": {
      "raw": "artist brush",
      "normalized": "Artist Brush",
      "aliases": [
        "paint artist brush",
        "fine art brush"
      ]
    },
    "category": {
      "name": "Artist Painting Brushes",
      "gpc": "GPC_123456"
    },
    "ambiguity": false
  }
}
```

No clarification required.

---

# Stage 7 — Workflow Manager

Input

```json
{
  "relationship": "new",
  "intent": "buyer_product_search"
}
```

Decision

```text
Create New Workflow Instance
```

Workflow instance created

```json
{
  "workflowId": "buyer_search_001",
  "workflowType": "BuyerSearch",
  "status": "Active",
  "currentState": "ResolveProduct"
}
```

Registry becomes

```text
Workflow Registry

Customer Search
(Artist Brush)
Active
```

The active workflow pointer is updated to `buyer_search_001`.

---

# Stage 8 — Workflow Engine

Current state

```text
ResolveProduct
```

The workflow invokes the Product Search Service with the semantic request.

```json
{
  "product": "Artist Brush",
  "gpc": "GPC_123456"
}
```

---

# Stage 9 — Business Service (Customer Search)

Processing

```text
GS1 Category

↓

Capability Inference

↓

Seller Matching

↓

Ranking
```

Suppose results are

```json
{
  "matchedSellers": [
    {
      "sellerId": "seller_12",
      "score": 0.98
    },
    {
      "sellerId": "seller_25",
      "score": 0.95
    },
    {
      "sellerId": "seller_40",
      "score": 0.91
    }
  ]
}
```

---

# Stage 10 — Workflow Engine

Workflow transitions

```text
ResolveProduct

↓

PresentResults
```

Workflow state becomes

```json
{
  "currentState": "PresentResults",
  "status": "WaitingForSelection"
}
```

---

# Stage 11 — Workflow Update

The workflow updates its metadata.

### Summary

```text
Customer Search

Searching for Artist Brush.

Resolved to:
Artist Painting Brushes

Found 3 matching sellers.

Waiting for seller selection.
```

### Semantic Fingerprint

```json
{
  "intent": "buyer_search",
  "entities": [
    "artist brush",
    "artist painting brush"
  ],
  "category": "Artist Painting Brushes",
  "keywords": [
    "paint brush",
    "fine art brush"
  ]
}
```

This is what enables intelligent resumption later.

---

# Stage 12 — Response Composer

Canonical response

```json
{
  "text": "I found 3 suppliers that sell artist brushes.",
  "actions": [
    {
      "type": "view_sellers",
      "payload": {
        "workflowId": "buyer_search_001"
      }
    }
  ]
}
```

Notice an important implementation detail: the action payload includes the `workflowId`. If the user taps the button later, the Workflow Manager can resume this exact workflow without any semantic search.

---

# Stage 13 — WhatsApp Adapter

The adapter converts the canonical response into a WhatsApp interactive message.

```json
{
  "type": "interactive",
  "body": {
    "text": "I found 3 suppliers that sell artist brushes."
  },
  "buttons": [
    {
      "id": "view_sellers",
      "title": "View Suppliers"
    }
  ]
}
```

---

# Final Conversation State

```text
Conversation
│
├── Active Workflow → Customer Search #001
│
└── Workflow Registry
      └── Customer Search #001
            Product: Artist Brush
            State: WaitingForSelection
            Status: Active
```

---

# V3 Validation

This test confirms that Version 3 successfully:

* Accepts a **voice note** through WhatsApp.
* Converts speech into a canonical text artifact before conversation processing.
* Correctly identifies a **new conversation** because no active workflow exists.
* Separates **intent understanding** from **semantic normalization**.
* Resolves the product into a normalized marketplace concept and GS1 category.
* Creates a **new Customer Search workflow instance** and registers it.
* Updates both the **workflow summary** and **semantic fingerprint** for future resumption.
* Produces a **channel-independent response**, which is then rendered appropriately by the WhatsApp adapter.
* Preserves a direct `workflowId` in interactive actions, enabling deterministic workflow resumption without relying on AI when the user responds through those actions.

Overall, this scenario flows through V3 without requiring any architectural changes, which is a good indication that the current design handles the "happy path" for multimodal Customer Searches cleanly.



















# Conversation OS TDR v3 – Additional Requirements (Refinement #11)

> **Purpose**
>
> These requirements extend the existing Conversation OS TDR to support the demand-driven marketplace interaction model. They should be added to the relevant sections of the TDR without replacing the existing Conversation OS architecture.

---

# 1. Customer Search Workflow Changes

Replace the existing Customer Search fulfillment process with a demand-driven fulfillment model.

The Customer Search workflow SHALL execute the following business stages:

```text
Resolve Product
        │
        ▼
Capability Matching
        │
        ▼
Rank Candidate Vendors
        │
        ▼
Immediately Return Highest Capability Vendor(s)
        │
        ▼
Notify Selected Vendor(s)
        │
        ▼
Deduct Vendor Credit
        │
        ▼
Create Customer Request
        │
        ▼
Fan-out Request To Remaining Matched Vendors
        │
        ▼
Wait For Vendor Responses
        │
        ▼
Collect Vendor Responses
        │
        ▼
Present Responding Vendors To Customer
        │
        ▼
Monitor Request Outcome
```

The Customer Search workflow becomes a long-running workflow that remains active until completion or expiration.

---

# 2. Capability-Based Immediate Vendor Delivery

After capability matching and ranking are completed, the system SHALL immediately identify the highest-ranked vendor(s) according to the Capability Matching Engine.

The system SHALL:

- select the highest capability-ranked vendor(s);
- send the selected vendor profile(s) directly to the customer;
- notify each selected vendor that their profile/contact information has been shared with a customer;
- deduct the configured vendor credit immediately after successful delivery of the vendor profile to the customer.

The Conversation OS SHALL invoke the required business services but SHALL NOT implement ranking or billing logic.

---

# 3. Vendor Credit Notification

When a vendor's profile is delivered directly to a customer, the Conversation OS SHALL invoke a business operation that:

- notifies the vendor that a customer has received their contact information;
- records the notification event;
- triggers vendor credit deduction.

This notification must occur only after successful customer delivery.

---

# 4. Fan-out Request Distribution

After immediate delivery of the highest-ranked vendor(s), the system SHALL create a customer request and distribute it to the remaining matched vendors.

The Conversation OS SHALL invoke the Request Distribution Service to perform the fan-out.

The Conversation OS SHALL remain independent of the distribution strategy.

---

# 5. Vendor Response Collection

The Customer Search workflow SHALL transition into a waiting state while vendor responses are collected.

Workflow State

```text
WaitingForVendorResponses
```

Vendor responses SHALL be received asynchronously through business events.

Example events include:

- VendorResponded
- VendorDeclined
- VendorIgnored
- VendorExpired

Each event SHALL resume the workflow for processing.

---

# 6. Customer Visibility Rule

The customer SHALL receive vendor profile information according to the following rules:

1. The highest capability-ranked vendor(s) are presented immediately after ranking.
2. All remaining vendors become visible to the customer only after they explicitly respond to the customer request.

Matched vendors that do not respond SHALL NOT be presented to the customer.

---

# 7. Business Event Integration

The Customer Search workflow SHALL publish business events rather than directly updating marketplace trust or analytics systems.

Minimum events include:

- CustomerRequestCreated
- VendorProfileDelivered
- VendorNotified
- VendorCreditDeducted
- RequestFannedOut
- VendorResponded
- VendorDeclined
- VendorIgnored
- VendorExpired
- CustomerViewedVendor
- CustomerContactedVendor
- WorkflowCompleted

These events SHALL be consumed by downstream business services.

---

# 8. Evidence Service Integration

The Conversation OS SHALL NOT write commercial evidence directly.

Instead, it SHALL publish business events that are consumed by the Evidence Service.

The Evidence Service is responsible for recording commercial interactions such as:

- request distribution;
- vendor response behaviour;
- customer engagement;
- successful fulfillment;
- ignored requests;
- declined requests;
- other marketplace interaction signals.

This separation preserves the independence of the Conversation OS from marketplace trust and reputation logic.

---

# 9. Workflow Completion

The Customer Search workflow SHALL NOT complete immediately after vendor profiles are presented.

The workflow remains active while monitoring marketplace events and SHALL complete only when one of the configured completion policies is satisfied (for example, successful fulfillment, expiration, cancellation, or timeout).

---

# 10. Architectural Constraint

The Conversation OS SHALL remain an orchestration platform.

It SHALL:

- manage conversation state;
- manage workflow lifecycle;
- coordinate business services;
- publish business events.

It SHALL NOT:

- implement capability scoring algorithms;
- implement vendor ranking algorithms;
- implement request distribution algorithms;
- implement billing or credit deduction logic;
- implement evidence computation;
- implement marketplace reputation logic.

These responsibilities belong to dedicated business services invoked by the Workflow Engine.



## Information Before Questions Principle

### Purpose

The Conversation OS SHALL prioritize extracting information from existing conversation before asking additional questions.

The system SHALL always attempt to infer, extract, or resolve required information using AI reasoning before requesting it from the user.

This principle minimizes user effort, reduces onboarding friction, and preserves a natural conversational experience.

---

### Design Principle

**Extract first. Ask second.**

Before asking any workflow question, the Question Engine SHALL determine whether the required information has already been provided explicitly or implicitly within the current conversation.

If the required information can be extracted with sufficient confidence, the corresponding workflow step SHALL be marked as complete without asking another question.

Questions SHALL only be asked when the required information cannot be confidently determined.

---

### Workflow

For every workflow step:

1. Determine the information required.
2. Search the current conversation for relevant information.
3. Attempt semantic extraction using AI reasoning.
4. Estimate confidence.
5. If confidence exceeds the configured threshold:
   - Complete the workflow step.
   - Store the extracted information.
   - Continue to the next workflow step.
6. Otherwise:
   - Generate a natural conversational question.
   - Wait for the user's response.
   - Repeat the extraction process.

---

### Examples

#### Example 1

AI

> What do you sell?

Vendor

> I sell plumbing materials. My shop is called Emeka Plumbing and I'm in Aba.

The system extracts:

- Capability ✓
- Business Name ✓
- City ✓

The Location Reasoner infers:

- State = Abia

The AI asks only:

> "Aba in Abia State, right?"

No additional business name or location questions are required.

---

#### Example 2

Vendor

> I'm Chinedu. I repair generators in Warri.

The system extracts:

- Service Capability ✓
- City ✓

The AI reasons:

Warri → Delta State

The AI asks:

> "Warri in Delta State, right?"

After confirmation:

> "Lastly, what would you like your business to be called?"

Only one additional question is required because the business name has not yet been provided.

---

#### Example 3

Vendor

> I own Bright Electronics in Benin City. We sell televisions, fans and refrigerators.

The system extracts:

- Business Name ✓
- Capability ✓
- Product Evidence ✓
- City ✓

The AI reasons:

Benin City → Edo State

The AI asks:

> "Benin City in Edo State, right?"

After confirmation, onboarding is complete.

---

### Benefits

The Information Before Questions principle ensures that the system:

- minimizes the number of questions asked
- avoids requesting information already provided
- adapts naturally to different user communication styles
- supports users who volunteer multiple pieces of information at once
- reduces onboarding time
- improves the conversational experience
- lowers cognitive load for busy and non-technical users

---

### Requirement

All Conversation OS workflows SHALL follow the Information Before Questions principle.

No workflow SHALL ask for information that has already been extracted or confidently inferred from the current conversation.

This principle SHALL apply uniformly across:

- Vendor Onboarding
- Inventory Updates
- Buyer Onboarding
- Business Verification
- KYC
- Future Conversation OS workflows


### Single-Turn Information Extraction

The Conversation OS SHALL treat every user message as a potential source of information for all remaining workflow steps.

Each incoming message SHALL be analyzed for every unresolved workflow field, not only the field corresponding to the most recently asked question.

Example

AI

> What do you sell?

Vendor

> I sell electrical materials. My business is Divine Electricals in Aba.

Although only capability was requested, the system SHALL also extract:

- Business Name
- City
- State (by inference)

and automatically mark those workflow steps as complete.

The Conversation OS SHALL never ignore useful information simply because it was provided earlier than expected.