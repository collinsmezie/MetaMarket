# Evidence Service

## Purpose

The Evidence Service is a standalone platform component responsible for collecting, storing, aggregating and serving marketplace evidence.

Unlike the reasoning components of the Capability Matching Engine, which rely on semantic understanding, the Evidence Service continuously learns from real marketplace interactions.

Its responsibility is to transform marketplace behaviour into measurable evidence that improves future matching.

---

# Responsibilities

The Evidence Service is responsible for:

- Recording marketplace events.
- Maintaining evidence records.
- Aggregating evidence into searchable scores.
- Providing evidence during vendor ranking.
- Continuously improving marketplace intelligence.

It is **not** responsible for:

- Customer conversations
- Vendor matching
- Request distribution
- Ranking logic

It only provides evidence.

---

# Producers of Evidence

Evidence can originate from any subsystem.

Examples

- Seller Onboarding
- Capability Discovery Engine
- Capability Matching Engine
- Request Distribution Service
- Customer Feedback
- Inventory Synchronisation
- Future Marketplace Services

Every producer writes evidence into the Evidence Service.

---

# Consumers of Evidence

Current consumers include:

- Capability Matching Engine
- Seller Analytics
- Marketplace Analytics
- Future Recommendation Systems
























# Recording Fan-Out Outcomes

Every customer request distributed to vendors becomes an evidence-producing event.

The objective is not only to determine whether a customer found a vendor, but to continuously improve future matching.

---

## Fan-Out Flow

```text
Customer Search
        │
        ▼
Capability Matching Engine
        │
        ▼
Ranked Candidate Vendors
        │
        ▼
Request Distribution Service
        │
        ▼
Fan Out Request
        │
        ├──────────────┬──────────────┬──────────────┐
        ▼              ▼              ▼
    Vendor A       Vendor B       Vendor C
```

Each vendor interaction generates evidence.

---

## Vendor Receives Request

Example

```text
Customer needs Hammer
```

Evidence Event

```yaml
Event:
    Request Delivered

Vendor:
    Vendor A

Product:
    Hammer

Timestamp:
    2026-08-05T10:05Z
```

---

## Vendor Responds

Possible responses

### Accepted

```text
Yes, I have it.
```

Evidence

```yaml
Event:
    Request Accepted

Vendor:
    Vendor A

Product:
    Hammer

Timestamp:
    2026-08-05T10:08Z

Response Time:
    3 minutes
```

---

### Rejected

```text
Sorry, I don't have it.
```

Evidence

```yaml
Event:
    Request Rejected

Vendor:
    Vendor A

Product:
    Hammer

Timestamp:
    2026-08-05T10:09Z
```

---

### No Response

Vendor does not respond within the configured timeout.

Evidence

```yaml
Event:
    No Response

Vendor:
    Vendor A

Product:
    Hammer

Timeout:
    30 minutes
```

---

## Customer Chooses Vendor

The customer receives only vendors who accepted the request.

Example

```text
Vendor A

Vendor D

Vendor G
```

Customer selects Vendor D.

Evidence

```yaml
Event:
    Vendor Selected

Vendor:
    Vendor D

Product:
    Hammer
```

---

## Successful Completion (Optional)

If the platform later confirms the transaction completed, another event is recorded.

```yaml
Event:
    Successful Match

Vendor:
    Vendor D

Product:
    Hammer
```

---

# Evidence Generated From Fan-Out

Each fan-out contributes multiple independent evidence signals.

Examples

- Delivery success
- Vendor response rate
- Vendor response time
- Acceptance rate
- Rejection rate
- No-response rate
- Customer selection rate
- Successful fulfilment rate

These metrics become part of the vendor's marketplace evidence profile.

---

# Marketplace Learning

Over time the Evidence Service learns patterns such as:

- Vendors that consistently respond.
- Vendors that frequently reject certain requests.
- Vendors that reliably stock particular products.
- Vendors that fulfil requests quickly.
- Vendors that customers repeatedly choose.

These learned behaviours become evidence used by the Capability Matching Engine during future ranking.

---

# Relationship With Capability Matching Engine

The Capability Matching Engine retrieves candidate vendors using semantic reasoning.

The Evidence Service does not retrieve vendors.

Instead, it supplies marketplace evidence that influences the ranking of retrieved candidates.

The relationship is therefore:

```text
Semantic Reasoning
        │
        ▼
Candidate Vendors
        │
        ▼
Evidence Service
        │
        ▼
Ranking Engine
        │
        ▼
Final Ranked Vendors
```

This separation ensures that semantic understanding and marketplace learning evolve independently while working together to produce increasingly accurate vendor matches.















---

# Event-Driven Evidence Architecture

## Design Decision

The Evidence Service adopts an **event-driven architecture**.

All platform components publish marketplace events instead of writing directly into the Evidence Service.

The Evidence Service subscribes to these events, processes them asynchronously, and updates marketplace evidence.

This ensures loose coupling between platform services while allowing new evidence producers to be introduced without modifying the Evidence Service.

---

# Event Producers

Any platform component may produce marketplace events.

Current producers include:

- Seller Onboarding System
- Capability Matching Engine (where applicable)
- Request Distribution Service
- Conversation OS
- Customer Feedback Service
- Inventory Synchronisation Service (Future)
- Payment / Transaction Service (Future)

The producer of an event is **not** responsible for updating marketplace evidence.

Its responsibility ends after publishing the event.

---

# Evidence Service

The Evidence Service subscribes to marketplace events.

Responsibilities include:

- Validate incoming events.
- Persist raw events.
- Generate evidence records.
- Aggregate evidence.
- Update vendor evidence scores.
- Update product evidence.
- Update capability evidence.
- Expose evidence through internal APIs.

---

# Standard Marketplace Event Model

Every marketplace event should follow a common schema.

Example

```yaml
eventId:
    UUID

eventType:
    request.accepted

timestamp:
    2026-08-05T10:08:21Z

producer:
    Request Distribution Service

vendorId:
    vendor_001

customerId:
    customer_245

requestId:
    req_90021

product:
    Hammer

capability:
    CAP_HARDWARE

metadata:
    responseTime: 180
    channel: WhatsApp
```

Additional metadata may be attached depending on the event type.

---

# Supported Event Types

## Request Lifecycle

```text
request.created

request.distributed

request.delivered

request.accepted

request.rejected

request.timeout

request.expired
```

---

## Vendor Behaviour

```text
vendor.responded

vendor.selected

vendor.declined

vendor.confirmed_inventory

vendor.updated_capability
```

---

## Marketplace Outcome

```text
match.completed

match.cancelled

customer.feedback

customer.rating
```

---

## Seller Activity

```text
seller.onboarded

seller.capability.confirmed

seller.profile.updated

seller.inventory.updated
```

---

# Evidence Processing Pipeline

```text
Marketplace Services
        │
        ▼
Publish Marketplace Events
        │
        ▼
Event Bus
        │
        ▼
Evidence Service
        │
        ├──────────────┐
        │              │
        ▼              ▼
 Raw Event Store   Evidence Processor
                         │
                         ▼
                 Evidence Records
                         │
                         ▼
                Evidence Aggregator
                         │
                         ▼
              Vendor Evidence Scores
                         │
                         ▼
                  Internal Evidence API
```

---

# Raw Event Store

Every event is stored before processing.

This provides:

- Complete audit trail.
- Event replay capability.
- Historical analytics.
- Debugging.
- Future machine learning datasets.

Raw events are immutable.

They should never be modified after persistence.

---

# Evidence Processor

The Evidence Processor transforms marketplace events into structured evidence.

Example

Incoming Event

```text
request.accepted
```

↓

Generated Evidence

```yaml
Vendor:
    Vendor A

Product:
    Hammer

Evidence:
    Positive Inventory Confirmation

Confidence:
    1.0
```

---

# Evidence Aggregator

The aggregator combines all evidence relating to the same vendor, capability or product.

Example

Vendor A

Evidence

- Seller Onboarding
- Request Accepted
- Match Completed
- Customer Rating

↓

Produces

```yaml
Hammer Evidence Score:
    0.96
```

This aggregated score is what the Capability Matching Engine consumes during ranking.

---

# Internal Evidence API

The Evidence Service exposes evidence through internal APIs.

Examples

```text
recordEvent(event)

getVendorEvidence(vendorId)

getProductEvidence(product)

getCapabilityEvidence(capabilityId)

getEvidenceScore(vendorId, product)

getEvidenceScore(vendorId, capability)
```

The Capability Matching Engine should never access raw events directly.

It only consumes processed evidence.

---

# Design Principles

1. All marketplace interactions are represented as immutable events.
2. Marketplace services publish events but never update evidence directly.
3. The Evidence Service is the single source of truth for marketplace learning.
4. Raw events are permanently stored for replay, auditing and analytics.
5. Evidence is continuously recalculated as new events arrive.
6. The Capability Matching Engine consumes processed evidence rather than raw marketplace events.
7. New evidence producers can be added without changing the Evidence Service or the Capability Matching Engine.