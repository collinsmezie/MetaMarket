# MetaMarket — Market Knowledge Graph (MKG) v1.1
## Standalone Technical Design Requirements, RDF/SKOS Model, Commercial Relationship Vocabulary, Query Contracts, Write Contracts, and Production Prompt/Integration Rules

**Document status:** Production-oriented standalone subsystem TDR  
**Version:** 1.1  
**Effective:** 2026-09-10  
**Primary market:** Nigerian informal + formal commerce  
**Runtime:** TypeScript / Node.js  
**Architecture:** Hexagonal / Ports & Adapters  
**Graph representation:** RDF  
**Semantic concept layer:** SKOS  
**Sovereign classification backbone:** GS1 GPC  
**Authority:** This document is authoritative for MKG internals. It does not replace the authority of CSRE, GPC Resolver, Evidence System, or Matching & Fanout for their respective decisions.

---

# 1. Purpose

The Market Knowledge Graph (MKG) is the platform's proprietary, evolving representation of **how commerce relates in the real market**.

MKG exists because the sovereign GS1 GPC hierarchy is a classification system, not a complete model of marketplace behavior. The marketplace must maintain relationships that emerge from buyer demand, vendor capability, usage, venue context, language, substitution, accessories, and other observed commercial interactions without mutating the sovereign GPC taxonomy.

The central rule is:

> **GPC classifies. MKG models commercial relationships. Evidence learns and validates. Matching & Fanout operationalizes.**

---

# 2. Non-Goals and Hard Boundaries

MKG MUST NOT become:

- a replacement for GS1 GPC;
- the authoritative semantic resolver;
- the authoritative intent engine;
- an evidence store;
- a vendor-ranking engine;
- an inventory database;
- a workflow engine;
- an unrestricted LLM memory store.

Specifically:

- CSRE owns what a phrase/object means.
- GPC Resolver owns where a resolved concept belongs in GPC.
- Evidence System owns observations, evidence, beliefs, and graph-change decisions.
- Capability Projection owns vendor capability representation.
- Matching & Fanout owns operational candidate scoring, ranking, and distribution.
- MCOS/LangGraph owns orchestration.

MKG owns the **durable graph representation and queryable commercial relationship state** after authorized validation.

---

# 3. Architectural Position

```text
                         RAW HUMAN EXPRESSION
                                  │
                                  ▼
                               CSRE
                                  │
                         Phrase + MarketConcept
                                  │
                                  ▼
                             Enrichment
                                  │
                                  ▼
                           GPC Resolver
                                  │
                         GPC mapping fact
                                  │
                                  ▼
                           Evidence System
                     observation/evidence/belief
                                  │
                         GraphChangeDecision
                                  │
                                  ▼
                         ┌───────────────────┐
                         │       MKG         │
                         │ RDF + SKOS + GPC  │
                         │ commercial graph  │
                         └────────┬──────────┘
                                  │
                         graph reads/traversal
                                  │
                                  ▼
                 Capability Projection / Matching & Fanout
```

MKG is therefore both:

1. a read-side knowledge service; and
2. a write-side validated graph state service.

---

# 4. Core Principles

## 4.1 Sovereignty

GS1 GPC is immutable from MetaMarket's perspective. MKG can reference GPC nodes and retain dataset/version provenance, but MUST NOT alter the official hierarchy.

## 4.2 Evidence-backed evolution

Graph relationships become durable through an Evidence-approved change process, not because an LLM suggested them.

## 4.3 Relationship specificity

Commercial meaning MUST be represented by explicit predicates. Do not reduce all relationships to `skos:related`.

## 4.4 Distance is not meaning

Graph distance is a traversal measure, not a universal relevance score. Candidate priors MUST consider relationship type, direction, path, context, and Evidence-derived strength.

## 4.5 History is preserved

Graph state may change, but mutation history and provenance remain auditable.

## 4.6 Generic commercial topology

The graph model must work across:

- products/items;
- product categories/subcategories/domains;
- services;
- capabilities/professions;
- venues;
- activities/use cases;
- brands/models/variants;
- actors/vendors/buyers;
- locations;
- phrases/aliases;
- demand signals;
- GPC nodes.

---

# 5. Graph Representation Decision

Use:

> **RDF as the foundational graph representation, SKOS for the semantic concept scheme, and custom RDF predicates/vocabulary for commercial relationships and evidence-linked assertions.**

SKOS provides semantic concept primitives including:

- `skos:Concept`
- `skos:ConceptScheme`
- `skos:prefLabel`
- `skos:altLabel`
- `skos:broader`
- `skos:narrower`
- `skos:related`

Custom predicates carry domain meaning where a generic SKOS relationship would be insufficient.

---

# 6. RDF Namespace and Vocabulary

Use a versioned platform namespace, for example:

```text
mkg: https://metamarket.example/ontology/mkg#
```

The exact production namespace is configuration, but the vocabulary itself MUST be versioned.

Recommended core predicates:

```text
mkg:EXPRESSES
mkg:MAPPED_TO_GPC
mkg:REQUESTED
mkg:SUPPLIES
mkg:OFFERS
mkg:IN_STOCK
mkg:OUT_OF_STOCK
mkg:USED_FOR
mkg:ACCESSORY_OF
mkg:COMPONENT_OF
mkg:SUBSTITUTE_FOR
mkg:COMMONLY_SOLD_WITH
mkg:RELATED_TO
mkg:SERVES
mkg:LOCATED_IN
mkg:HAS_BELIEF
mkg:HAS_PRIOR
mkg:SUPPORTED_BY
mkg:CONTRADICTED_BY
mkg:OBSERVED_IN
mkg:HAS_ALIAS
```

Predicates MUST have documented subject type, object type, direction, inverse semantics where applicable, temporal semantics, and whether inference is permitted.

---

# 7. Node Model

## 7.1 Sovereign GPC nodes

`GpcSegment`, `GpcFamily`, `GpcClass`, and optional `GpcBrick` mirror the installed GPC dataset.

Example lineage:

```text
GpcClass → BELONGS_TO → GpcFamily
GpcFamily → BELONGS_TO → GpcSegment
```

Each node retains:

```text
code
title
definition
parentCode
segmentCode
familyCode
brickCode (where applicable)
gpcDatasetVersion
```

## 7.2 MarketConcept

A MarketConcept is the stable semantic identity created/managed by CSRE and represented in MKG when durable graph identity is required.

Recommended properties:

```text
id
preferredLabel
entityType
definition
specificityLevel
schemeId
createdAt
updatedAt
status
```

MKG MUST NOT overwrite the semantic meaning of a MarketConcept merely because a later graph relationship points to another concept.

## 7.3 Phrase

A Phrase represents a surface expression observed in a conversation or market source.

```text
id
text
rawInput
conversationId
turnId
objectId
language
region
createdAt
```

## 7.4 Actor

An Actor represents a market participant.

```text
id
role(s)
uniqueBusinessName
location
```

A single actor may be buyer, vendor, or both depending on context.

## 7.5 Context

Context captures places, activities, use cases, venues, domains, situations, and other reusable contextual concepts.

## 7.6 Assertion

Where a relationship has independent provenance or belief state, represent the relationship as a first-class assertion resource rather than attaching unstructured metadata to a raw triple.

---

# 8. Commercial Relationship Model

## 8.1 Phrase semantics

```text
Phrase ──mkg:EXPRESSES──> MarketConcept
```

## 8.2 Taxonomy anchoring

```text
MarketConcept ──mkg:MAPPED_TO_GPC──> GpcClass
```

The mapping carries provenance such as:

```text
mappingConfidence
mappingState
resolverVersion
gpcDatasetVersion
mappedAt
```

## 8.3 Demand

```text
Actor ──mkg:REQUESTED──> MarketConcept
```

For interaction-level auditability, an explicit request/demand event node is preferred.

Demand is market evidence/knowledge and does **not** imply vendor inventory.

## 8.4 Vendor capability

Capability relationships can be represented as:

```text
Actor ──mkg:SUPPLIES──> MarketConcept
Actor ──mkg:SUPPLIES──> GpcClass
```

Operational capability state should reference Evidence/capability records and MUST distinguish confirmed, believed, inherited/derived, negated, and inactive states.

## 8.5 Commercial relationships

Use explicit relationships such as:

```text
MarketConcept ──mkg:USED_FOR──────────────> Context
MarketConcept ──mkg:ACCESSORY_OF───────────> MarketConcept
MarketConcept ──mkg:COMPONENT_OF───────────> MarketConcept
MarketConcept ──mkg:SUBSTITUTE_FOR─────────> MarketConcept
MarketConcept ──mkg:COMMONLY_SOLD_WITH─────> MarketConcept
Actor ─────────mkg:SERVES─────────────────> Location
```

The model is intentionally generic; the same relationship framework applies to products, categories, services, domains, venues, activities, capabilities, and other commercial entities where the predicate contract permits it.

---

# 9. Relationship Semantics and Inverses

Every predicate must define:

- semantic meaning;
- direction;
- valid subject/object classes;
- inverse predicate, where meaningful;
- whether transitive inference is allowed;
- whether symmetric behavior is allowed;
- whether temporal state applies;
- whether belief/evidence is required for durable assertion;
- business interpretation when traversed for candidate discovery.

Examples:

```text
SUPPLIES(vendor, concept)
inverse: SUPPLIED_BY(concept, vendor)

ACCESSORY_OF(accessory, product)
inverse: HAS_ACCESSORY(product, accessory)

SUBSTITUTE_FOR(a, b)
inverse: SUBSTITUTE_FOR(b, a)
```

The implementation MUST NOT assume inverse/symmetric semantics from predicate names alone. They are vocabulary configuration.

---

# 10. Prior and Traversal Model

Graph traversal may be used to discover plausible related concepts or vendor capabilities, but a graph path does not prove a relationship.

The relevance model must consider at least:

```text
relationshipType
pathLength
pathDirection
edgeStrength / belief
edgeEvidence
geography
recency
context compatibility
source/target specificity
```

The production prior policy should be versioned. A relationship type can have a stronger prior than another even at the same graph distance.

For example, a direct `ACCESSORY_OF` relationship may produce a stronger candidate prior for a search context than a generic `RELATED_TO` edge at the same distance.

Priors remain priors. They MUST NOT be persisted as direct evidence.

---

# 11. Graph State Model

Relationship state should distinguish at minimum:

```text
CANDIDATE
ACTIVE
REINFORCED
WEAKENING
INACTIVE
PRUNED
REJECTED
```

A state transition must be explainable by a versioned GraphChangeDecision and its referenced Evidence.

History MUST remain queryable even after a relationship becomes inactive or pruned.

---

# 12. Graph Change Command Boundary

Only a validated command may cross the MKG write port.

Example:

```typescript
export interface GraphChangeCommand {
  decisionId: string;
  operation: 'ADD' | 'REINFORCE' | 'DECAY' | 'DEACTIVATE' | 'PRUNE' | 'REJECT';
  subjectId: string;
  predicate: string;
  objectId: string;
  beliefScore?: number;
  evidenceIds: string[];
  policyVersion: string;
  correlationId: string;
  occurredAt: string;
}
```

Validation MUST check:

1. identity existence;
2. predicate validity;
3. subject/object type constraints;
4. immutable GPC protection;
5. duplicate/idempotency key;
6. evidence/decision provenance;
7. version compatibility;
8. allowed state transition.

No LLM output may bypass this port.

---

# 13. Query Contracts

## 13.1 Get concept

```typescript
export interface GetMarketConceptRequest {
  marketConceptId: string;
  includeRelationships?: boolean;
  relationshipPredicates?: string[];
  maxDepth?: number;
  snapshotId?: string;
}
```

## 13.2 Relationship traversal

```typescript
export interface TraverseGraphRequest {
  startNodeId: string;
  predicates?: string[];
  direction?: 'OUTGOING' | 'INCOMING' | 'BOTH';
  maxDepth: number;
  includeInactive?: boolean;
  minBelief?: number;
  geography?: string | null;
  contextNodeIds?: string[];
  snapshotId?: string | null;
}
```

## 13.3 Vendor capability context

```typescript
export interface GetCapabilityContextRequest {
  marketConceptId?: string;
  gpcCode?: string;
  locationId?: string;
  includeInheritedPriors?: boolean;
  minBelief?: number;
}
```

MKG returns graph facts and provenance; it does not return a final ranked vendor list. Matching & Fanout owns ranking.

---

# 14. Response Envelope

All service calls should use a stable envelope:

```json
{
  "request_id": "string",
  "correlation_id": "string",
  "graph_schema_version": "1.0",
  "snapshot_id": "string",
  "status": "SUCCESS | PARTIAL | NOT_FOUND | ERROR",
  "nodes": [],
  "relationships": [],
  "inference": {
    "applied": false,
    "policy_version": "string",
    "derived_from": []
  },
  "provenance": []
}
```

The response must distinguish stored graph facts from graph-derived inference.

---

# 15. Evidence Integration

Evidence is not stored as a substitute for graph state, but graph assertions must retain evidence lineage.

```text
Observation
   ↓
Evidence
   ↓
Insight / Knowledge
   ↓
Current Belief
   ↓
GraphChangeDecision
   ↓
MKG mutation
```

MKG should expose relationship provenance sufficient to answer:

- Why does this edge exist?
- Which evidence supports it?
- What belief score is current?
- Which policy produced the decision?
- When was it last reinforced/decayed?
- What geographic/temporal scope applies?

MKG must not itself calculate evidence fusion. It consumes the resulting approved state.

---

# 16. CSRE Integration

CSRE remains the source of semantic referent identity.

MKG consumes:

```text
Phrase
MarketConcept
object_id
semantic-origin provenance
```

A new concept proposal may be created by CSRE, but graph persistence must be validated through the MKG write boundary and any required Evidence process.

---

# 17. GPC Resolver Integration

GPC Resolver sends a classification mapping fact:

```text
MarketConcept
      ↓
MAPPED_TO_GPC
      ↓
GpcClass
```

MKG uses that link for taxonomy anchoring and graph traversal.

GPC hierarchy itself remains outside proprietary mutation and continues to be governed by the installed GPC dataset.

---

# 18. Enrichment Integration

Enrichment can read MKG for approved contextual relationships. For example:

```text
hammer
  ├─ USED_FOR → roofing
  ├─ COMMONLY_SOLD_WITH → nails
  └─ ACCESSORY_OF → tool kit
```

These relationships can help form richer semantic retrieval context, but Enrichment must not treat every graph relation as semantic equivalence.

---

# 19. WRS Integration

WRS can be asked to acquire external evidence for a relationship target. WRS returns evidence/provenance; it does not write MKG.

Example request conceptually:

```text
consumer = MKG / Evidence
relationship_target =
  MarketConcept(A) → SUBSTITUTE_FOR → MarketConcept(B)
```

Local and temporal relevance must be retained because a relationship can be commercially true in one region or period and weaker elsewhere.

---

# 20. Capability Projection and Matching & Fanout Integration

Capability Projection converts vendor-originated observations into vendor capability representations, linked to MarketConcept/GPC identities as appropriate.

Matching & Fanout reads capability and graph context to generate and rank candidates.

MKG provides:

- relationship traversal;
- concept context;
- approved graph priors/relationships;
- vendor-to-concept relationship state where authorized.

MKG does NOT select the final vendors and does NOT infer exact inventory from demand.

---

# 21. Demand and Learning Model

Buyer searches and requests are valuable market observations because they expand knowledge of what users seek, but they must not fabricate inventory.

A demand event may result in:

```text
Actor → REQUESTED → MarketConcept
```

and can contribute to market-demand knowledge.

It does not automatically create:

```text
Vendor → IN_STOCK → MarketConcept
```

That requires explicit vendor or fulfillment evidence.

---

# 22. Graph Evolution Operations

The graph supports at least:

### ADD
Create a new validated relationship.

### REINFORCE
Increase/refresh relationship strength based on additional evidence.

### DECAY
Reduce operational relevance according to temporal/contradictory evidence.

### DEACTIVATE
Temporarily stop using a relationship without deleting its history.

### PRUNE
Remove an obsolete/unreliable relationship from active traversal while retaining audit history.

### REJECT
Record that a proposed relationship failed validation or evidence review.

These operations are initiated by approved graph change decisions, not arbitrary graph heuristics.

---

# 23. Idempotency and Concurrency

Graph writes MUST be idempotent.

Use a deterministic key such as:

```text
hash(decisionId + operation + subject + predicate + object)
```

Concurrent commands for the same relationship must be serialized or transactionally merged according to graph-store capabilities.

No stale writer may silently overwrite a newer relationship state.

---

# 24. Versioning

At minimum version:

```text
mkg_component_version
mkg_graph_schema_version
mkg_vocabulary_version
mkg_policy_version
gpc_dataset_version
embedding_model_version (where used)
```

Every graph mutation and meaningful graph-derived response should expose the relevant versions.

A GPC dataset change must not mutate historical mapping provenance.

---

# 25. Persistence and Graph Store

The implementation may use Neo4j or another RDF-compatible graph store provided that the final abstraction satisfies this TDR.

A relational system may remain the transaction/source of truth for application entities while MKG remains the graph source of truth for graph relationships.

The graph store MUST support:

- durable RDF triples/quads or equivalent;
- indexed node identity;
- predicate-aware traversal;
- provenance/state metadata;
- snapshot/version strategy;
- transactional or safely coordinated writes;
- query APIs suitable for matching/context workloads.

The exact infrastructure choice is an implementation decision unless constrained elsewhere by the master blueprint.

---

# 26. Security and Write Trust Boundary

Only trusted application services may invoke MKG write ports.

The following are forbidden:

- browser-direct graph writes;
- raw LLM-to-database writes;
- unvalidated arbitrary predicate creation;
- arbitrary replacement of GPC hierarchy;
- graph mutation without provenance.

Read access can be separately scoped by capability.

---

# 27. Observability

Every request should produce structured telemetry with:

```text
requestId
correlationId
conversationId
turnId
actorId (where applicable)
marketConceptId(s)
gpcCode(s)
relationship predicate(s)
graphSchemaVersion
vocabularyVersion
policyVersion
snapshotId
latency
status
```

For writes, additionally record:

```text
decisionId
evidenceIds
operation
previousState
newState
```

---

# 28. Live Test Mode — Primary Validation

Live Test Mode is the primary validation strategy.

A live run must make it possible to inspect:

1. the input;
2. CSRE-created/resolved MarketConcept identity;
3. GPC mapping;
4. Evidence records and belief updates;
5. GraphChangeDecision;
6. MKG graph read/write result;
7. persisted graph state;
8. snapshot/version metadata;
9. downstream capability/matching behavior;
10. final user response.

## 28.1 Required graph scenarios

### Scenario A — phrase knowledge

```text
User: "I dey find hot flask."
```

Expected direction:

```text
Phrase("hot flask")
  → EXPRESSES
MarketConcept("vacuum flask" or defensible resolved concept)
```

The exact concept remains CSRE's decision; MKG stores the resulting durable relationship only through the approved pathway.

### Scenario B — accessory relationship

A validated observation that drill bits are accessories of a compatible drill should create or reinforce:

```text
Drill Bit → ACCESSORY_OF → Drill
```

not a generic `RELATED_TO` edge.

### Scenario C — substitute relationship

Evidence that two concepts are used as substitutes may produce:

```text
Concept A → SUBSTITUTE_FOR → Concept B
```

with evidence lineage and current belief.

### Scenario D — demand without inventory

A buyer search for `wall socket` must produce demand evidence but must not create `Vendor → IN_STOCK → wall socket` unless an explicit inventory/capability observation supports it.

### Scenario E — GPC sibling trap

A vendor mapped to one GPC class must not automatically receive exact inventory state for every sibling class. Graph priors may support candidate discovery, but direct capability/inventory requires evidence.

### Scenario F — locality

A relationship may be strongly supported in Nigerian market evidence but weak in another geography. The graph must preserve scope rather than collapsing them into one universal fact.

---

# 29. Failure and Recovery

The MKG service must fail safely.

### Read failure

Return an explicit error/partial status. Do not synthesize graph facts.

### Write failure

The approved GraphChangeDecision must remain durably retryable. Never report successful mutation before graph commit is confirmed.

### Duplicate command

Return the existing mutation result or equivalent idempotent acknowledgement.

### Vocabulary mismatch

Reject the mutation and surface a version incompatibility rather than silently coercing the predicate.

### GPC mutation attempt

Reject and emit a security/authority violation event.

---

# 30. Implementation Shape

Use a hexagonal structure:

```text
mkg/
  domain/
    entities/
    value-objects/
    relationship-rules/
    policies/
  application/
    queries/
    commands/
    services/
  ports/
    inbound/
    outbound/
  adapters/
    graph-store/
    rdf/
    skos/
    telemetry/
  api/
  mappers/
```

The domain model should remain independent of the concrete graph database.

---

# 31. Final Authority Matrix

| Concern | Authority |
|---|---|
| User referent | CSRE |
| Intent | IDCE |
| Semantic expansion | Enrichment |
| Sovereign GPC class | GPC Resolver |
| External evidence | WRS |
| Evidence/evidence fusion/belief | Evidence System |
| Durable commercial graph state | **MKG** |
| Vendor capability representation | Capability Projection |
| Vendor ranking/fanout | Matching & Fanout |
| Conversation orchestration | MCOS + LangGraph |
| Business workflow execution | Workflow Engine |

---

# 32. Final Rule

> **The Market Knowledge Graph is the marketplace's proprietary memory of commercial relationships—not a replacement taxonomy, not an evidence store, and not a matching engine.**
>
> **Evidence determines what the marketplace has learned and proposes graph changes; MKG validates and stores the graph; GPC remains sovereign; matching operationalizes the graph without turning priors into inventory truth.**


# 33. NORMATIVE AGENDA COMPLETION — v1.1 LEARNING SAFETY + READ CONTRACT HARDENING

**Effective:** 2026-09-12  
**Status:** Authoritative amendment.

## 33.1 Final MKG identity

```text
component              = MKG
component_version      = 1.1
graph_schema_version   = 1.0
vocabulary version     = explicit and deployable
```

Graph schema version remains independently versioned from the MKG component version.

## 33.2 Read contracts preserve intelligence

MKG read APIs MUST be able to return, where requested:

```text
stored fact / relationship
relationship predicate
subject/object identity
direction
path / traversal summary
belief / prior
supporting evidence IDs
geographic scope
temporal scope
source provenance
snapshot/version
inference status
inference policy version
```

A generic `getRelatedConcepts()` response is insufficient for production intelligence because relationship type, direction, evidence, and scope affect relevance.

## 33.3 Stored fact vs inference

Every read response MUST distinguish:

```text
STORED_FACT
GRAPH_DERIVED_PRIOR
GRAPH_DERIVED_INFERENCE
```

Graph-derived inference MUST NOT be returned in a form that can be mistaken for direct observation.

## 33.4 Market-language knowledge model

MKG SHOULD support durable lexical-commercial relationships such as:

```text
Phrase → EXPRESSES → MarketConcept
Phrase → HAS_ALIAS → MarketConcept
```

with explicit locality, evidence lineage, current belief, and lifecycle state.

These relationships are especially important for oral/local Nigerian market language that may not have strong web representation.

## 33.5 Learning lifecycle

MKG graph state MUST remain compatible with Evidence promotion/demotion decisions. Candidate knowledge is not equivalent to established knowledge.

```text
CANDIDATE → ACTIVE → REINFORCED
             ↓
          WEAKENING
             ↓
          INACTIVE / PRUNED
```

MKG validates the requested transition but does not perform evidence fusion itself.

## 33.6 Relationship-aware query discipline

Traversal APIs MUST support filters or query parameters for:

- predicate/relationship type;
- direction;
- maximum path length;
- minimum belief/prior;
- evidence presence/strength;
- geographic scope;
- temporal scope;
- snapshot/version;
- object/concept type.

Distance alone MUST NOT be exposed as a universal relevance score.

## 33.7 Operational simplicity

The TDR does not require a specific graph database at a specific scale. The chosen store MUST satisfy the RDF/relationship/provenance semantics in this TDR. Operational simplicity may be optimized through deployment topology, but semantic graph capabilities must not be flattened merely to reduce datastore count without workload evidence.
