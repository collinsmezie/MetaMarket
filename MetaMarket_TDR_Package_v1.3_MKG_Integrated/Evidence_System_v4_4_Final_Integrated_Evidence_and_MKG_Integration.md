# Evidence System — Evidence + Market Knowledge Graph Integration v4.4

> This revision hardens the cross-component evidence contracts, relationship-first learning, CSRE semantic-origin observations, GPC mapping facts, and collaborative category-cluster learning.

# Evidence System v4.3 — TDR & Production Prompt Specification
**Version:** 4.4

## 1. Purpose

The Evidence System is the shared evidence and learning infrastructure for the marketplace intelligence stack.

Its responsibilities are to:

1. Capture raw observations from marketplace and supporting systems.
2. Convert observations into structured evidence.
3. Evaluate evidence strength, polarity, provenance, recency, and scope.
4. Produce reusable insights and persistent market knowledge.
5. Fuse evidence over time into belief scores.
6. Determine how evidence should expand, reinforce, decay, or prune GPC graph relationships.
7. Provide evidence, insights, and knowledge to other components such as CSRE, Enrichment, GPC matching, Matching & Fanout, and future services.
8. Support multiple evidence strategies without coupling consumers to a single evidence model.

The Evidence System is **not** the semantic resolver, web retrieval system, enrichment engine, intent resolver, or final matching engine.

---

# 2. Core Architectural Principle

The Evidence System separates four layers:

```text
RAW OBSERVATION
      ↓
EVIDENCE
      ↓
INSIGHT / KNOWLEDGE
      ↓
CURRENT BELIEF
      ↓
GRAPH DECISION
```

These layers must not be collapsed.

### Raw observation

What actually happened or was observed.

Examples:

```text
Vendor said: "Yes, I have hammer drills."

Buyer searched:
"hammer drill"

Vendor replied:
"No, I only sell normal hammers."

WRS found:
"Nigerian retailers commonly use 'iron sponge' for steel wool."
```

### Evidence

A structured interpretation of an observation, with provenance.

Example:

```text
vendor-123
→ hammer drill
→ POSITIVE capability evidence
→ strength: 0.930
```

### Insight / Knowledge

A reusable conclusion derived from one or more evidence records.

Example:

```text
"iron sponge" is a Nigerian commercial expression
commonly referring to steel wool/scouring pad.
```

### Current belief

The Evidence System's current evidence-backed belief regarding a relationship.

Example:

```text
vendor-123
→ hammer drill
→ capability belief = 0.870
```

### Graph decision

A decision about graph state.

Example:

```text
hammer drill
→ retain and reinforce

impact drill sibling
→ maintain as candidate

unrelated node
→ prune
```

---

# 3. Evidence Strategies

The system must support at least two strategies.

## 3.1 Graph-First / GPC-First Strategy

This strategy begins from GPC graph structure.

When a vendor is confidently associated with a GPC class, neighboring classes and closely related families can receive graph-derived priors.

Example:

```text
Confirmed:
Vendor → GPC Class X
                  │
        ┌─────────┼─────────┐
        ↓         ↓         ↓
    Sibling A  Sibling B  Sibling C
       0.500       0.500      0.500
```

The `0.500` values are **priors**, not evidence.

They mean:

> The graph topology makes these capabilities plausible candidates.

They do not mean the vendor is known to carry those products.

Graph-derived priors must never be mistaken for direct vendor evidence.

---

## 3.2 Evidence-First Strategy

This strategy starts from observed evidence from real interactions and supporting knowledge systems.

Sources include:

- buyer searches
- buyer messages
- buyer clarification answers
- buyer confirmations
- vendor onboarding statements
- vendor inventory updates
- vendor messages
- vendor responses
- vendor clarification answers
- vendor confirmations
- vendor rejections
- fulfillment outcomes
- CSRE observations
- WRS evidence
- Enrichment-derived knowledge
- historical marketplace interactions

Evidence can support:

- a concept exists commercially
- a local expression refers to a concept
- a vendor likely has a capability
- a vendor does not have a capability
- two concepts are related
- one concept is a sibling or specialization of another
- a venue is associated with an object
- a commercial interpretation is likely
- a taxonomy relationship should be explored

---

# 4. Evidence Fusion

The two strategies operate together.

```text
Graph structure
     ↓
Graph-derived prior
     │
     ├──────────────┐
     │              │
     ▼              ▼
Historical        New real-world
evidence          observations
     │              │
     └──────┬───────┘
            ↓
       Evidence Fusion
            ↓
     Current Belief Score
            ↓
   Graph Relevance Decision
            ↓
   EXPAND / REINFORCE / DECAY / PRUNE
```

The graph provides hypotheses.

Real-world evidence tests those hypotheses.

---

# 5. Capability Score Model

## 5.1 Score precision

All capability belief and relevance scores use a **three-decimal floating-point scale**:

```text
0.000 → 1.000
```

Three decimal places are preferred because the system needs enough resolution for gradual accumulation, decay, contradiction, and convergence.

Examples:

```text
0.500
0.517
0.642
0.731
0.894
0.997
1.000
```

## 5.2 Meaning

The score represents the system's current **evidence-backed belief**, not merely the latest observation.

```text
0.000
```

No meaningful support.

```text
0.001–0.199
```

Very weak support.

```text
0.200–0.399
```

Weak / exploratory support.

```text
0.400–0.599
```

Plausible / insufficiently established.

```text
0.600–0.799
```

Meaningfully supported.

```text
0.800–0.949
```

Strong capability evidence.

```text
0.950–0.999
```

Near-certain based on accumulated evidence.

```text
1.000
```

Operationally certain / conclusively established by the system's evidence policy.

The system must not casually assign `1.000`.

A single free-text statement should normally not produce `1.000`.

Repeated independent, highly reliable, consistent evidence may converge toward `1.000`.

---

# 6. Priors vs Evidence vs Belief

These must remain distinct.

Example:

```text
Graph prior:
Electrical sockets = 0.500

Observed evidence:
Vendor explicitly confirms selling wall sockets.

Current belief:
Electrical sockets = 0.910
```

The initial `0.500` is a graph prior.

The subsequent evidence is what moves the belief.

A score is not evidence itself.

---

# 7. Recommended Evidence Update Model

The exact mathematical function should remain configurable, but the conceptual model is:

```text
new belief
=
previous belief
+
weighted positive evidence
-
weighted negative evidence
-
time decay
```

The implementation must prevent:

- scores exceeding `1.000`
- scores dropping below `0.000`
- one observation from permanently dominating the state
- repeated copies of the same observation from falsely appearing independent
- graph priors from being treated as direct evidence

All calculations are clamped:

```text
0.000 ≤ score ≤ 1.000
```

---

# 8. Evidence Independence

Repeated observations are not automatically independent.

For example:

```text
Vendor says:
"I have hammer drills."

System receives the same WhatsApp message three times.
```

This is one underlying observation, not three independent pieces of evidence.

The Evidence System must deduplicate or correlate observations.

Independent confirmation can come from:

- separate interactions
- different timestamps
- different workflows
- inventory update plus customer response
- explicit vendor confirmation plus successful fulfillment
- multiple consistent sources

---

# 9. Evidence Polarity

Evidence must support both positive and negative inference.

Supported polarity:

```text
POSITIVE
NEGATIVE
NEUTRAL
CONTRADICTORY
```

Examples:

### Positive

```text
"Yes, I have hammer drills."
```

### Negative

```text
"No, I don't sell hammer drills."
```

### Neutral

```text
"I sell construction tools."
```

This may provide weak contextual support but is not direct confirmation.

### Contradictory

```text
Vendor onboarding:
"I sell hammer drills."

Later:
"I don't stock hammer drills anymore."
```

Both observations remain in history.

Current belief must incorporate recency and source reliability.

---

# 10. Evidence Scope

Evidence must explicitly identify what it applies to.

Possible subjects include:

```text
BUYER_DEMAND
VENDOR_CAPABILITY
COMMERCIAL_CONCEPT
LOCAL_TERM
VENUE
RELATIONSHIP
GPC_NODE
GPC_EDGE
PRODUCT
CATEGORY
SUBCATEGORY
DOMAIN
SERVICE
OTHER
```

Example:

```text
BUYER_DEMAND:
"hammer drill"

does not imply:

VENDOR_CAPABILITY:
"hammer drill"
```

Likewise:

```text
Vendor:
"I sell hammer drills."
```

supports that vendor's capability but does not prove that every vendor in the same graph family sells hammer drills.

---

# 11. Multi-Object Evidence

The Evidence System must support multiple objects in one interaction.

Example:

> "I need a hammer, nails and electrical materials for roofing."

The system must maintain separate evidence targets:

```text
Object 1 → hammer
Object 2 → nails
Object 3 → electrical materials
```

with shared context:

```text
functional_context → roofing
```

If a vendor responds:

> "I have hammer and nails but no electrical materials."

The Evidence System creates:

```text
Vendor → hammer
POSITIVE

Vendor → nails
POSITIVE

Vendor → electrical materials
NEGATIVE
```

The roofing context is attached to the interaction and relevant evidence records but must not be incorrectly treated as another requested product.

---

# 12. Object Relationships

Evidence may also describe relationships.

Example:

```text
hammer
nails
    │
    └── used_for → roofing
```

Another example:

```text
phone
accessories
```

may represent:

```text
phone → category
accessories → category

relationship:
accessories are commonly associated with phones
```

Relationships must have their own evidence records rather than being silently inferred into object identity.

---

# 13. Provenance

Every evidence record must contain provenance sufficient to answer:

- who generated it?
- what was observed?
- when?
- through which channel?
- in which workflow?
- for which buyer/vendor?
- for which object?
- under which context?
- how was it interpreted?
- what does it support?
- what does it contradict?
- what source generated it?

Minimum provenance:

```json
{
  "source_type": "VENDOR_RESPONSE",
  "actor_id": "vendor-123",
  "interaction_id": "interaction-789",
  "channel": "WHATSAPP",
  "workflow": "CUSTOMER_REQUEST_RESPONSE",
  "observed_at": "2026-09-09T10:30:00Z"
}
```

---

# 14. Evidence Strength

Evidence strength should consider:

- source reliability
- directness
- specificity
- clarity
- confirmation status
- independence
- recency
- consistency
- context
- whether the observation was actually acted upon

Examples:

### Very strong

```text
Vendor explicitly confirms:
"Yes, I stock Bosch hammer drills."
```

### Strong

```text
Vendor successfully fulfills a customer request for a hammer drill.
```

### Medium

```text
Vendor says:
"I sell construction tools."
```

### Weak

```text
Vendor is associated with a GPC family containing drills.
```

The last example may be useful as a prior but should not be treated as direct evidence.

---

# 15. Evidence Lifecycle

Evidence is immutable.

The original observation must never be overwritten.

New observations create new evidence records.

Derived current beliefs are recalculated from the evidence history.

```text
Observation A
     ↓
Evidence A

Observation B
     ↓
Evidence B

Observation C
     ↓
Evidence C
     │
     └──────┐
            ▼
      Evidence Fusion
            ↓
      Current Belief
```

This makes the system auditable.

---

# 16. Temporal Decay

Some evidence becomes stale.

Examples:

- vendor inventory
- temporary stock
- temporary service availability
- seasonal products

The system should support evidence decay where appropriate.

Permanent semantic knowledge may have little or no decay.

Vendor inventory evidence may decay more rapidly.

Graph structural relationships may have a different decay policy.

Decay policy must be evidence-type specific.

---

# 17. Knowledge Layer

The Evidence System should maintain a persistent **Market Knowledge Store** in addition to raw evidence.

Knowledge is reusable understanding derived from validated evidence.

Examples:

```text
"okrika"
→ second-hand clothing

"bend down select"
→ second-hand clothing

"iron sponge"
→ steel wool / scouring pad

"hot flask"
→ vacuum flask
```

The purpose is to avoid rediscovering the same market meaning repeatedly.

Knowledge can improve:

- CSRE resolution
- Enrichment
- WRS query generation
- clarification generation
- commercial interpretation
- local terminology understanding
- GPC enrichment
- future evidence interpretation

---

# 18. Knowledge vs Evidence

## Evidence

Answers:

> What happened / what source said this?

Evidence must preserve provenance.

## Knowledge

Answers:

> What durable thing has the system learned from accumulated evidence?

Knowledge must preserve lineage to the evidence that supports it.

Example:

```text
KNOWLEDGE:
"iron sponge" commonly refers to steel wool.

SUPPORTED_BY:
Evidence E123
Evidence E188
Evidence E244
```

Knowledge can later be challenged or revised if strong contradictory evidence appears.

---

# 19. Derived Insight Layer

Derived insights are intermediate conclusions from evidence.

Examples:

```text
Vendor X appears to specialize in electrical installation materials.

"iron sponge" is used locally as a synonym for steel wool.

Demand for a product is increasing in Warri.

Vendor X repeatedly rejects generator repair requests.
```

Insights may be:

```text
TEMPORARY
PERSISTENT
EXPERIMENTAL
CONFIRMED
```

Only validated persistent insights should normally become durable market knowledge.

---

# 20. Evidence Graph Model

The Evidence System should not store only nodes.

Relationships are equally important.

Example:

```text
Vendor
   │
   ├── HAS_CAPABILITY → GPC Node
   ├── LIKELY_HAS → GPC Node
   ├── DOES_NOT_HAVE → GPC Node
   └── SERVES → Venue/Market
```

Semantic relationships:

```text
LocalTerm
   └── REFERS_TO → CommercialConcept

GPC Node A
   └── RELATED_TO → GPC Node B

Product
   └── USED_FOR → Context
```

Every relationship should have evidence and a current belief score where uncertainty exists.

---


### Relationship-first persistence invariant

The primary reusable object in the Market Knowledge Graph is not only the node. It is the
**assertion relationship**:

```text
(subject, predicate, object, context)
```

Each material assertion may carry:

```text
prior
belief_score
relationship_type
graph_distance
evidence_ids
provenance
first_observed_at
last_observed_at
status
```

This is required because commerce is learned primarily through relationships and interactions.

---

# 21. Graph Expansion

The Evidence System is the primary decision maker for graph relevance.

Expansion can occur when evidence indicates that an unrepresented or weakly represented node is relevant.

Sources may include:

- direct vendor capability evidence
- buyer demand
- successful fulfillment
- vendor confirmation
- enrichment insights
- validated local terminology knowledge
- GPC neighborhood relationships
- repeated evidence across vendors

Graph expansion should create or strengthen relationships, not blindly copy neighboring nodes.

---


## 21A. Collaborative Category Cluster Enrichment

Buyer demand can expand marketplace semantic coverage.

Locked rule:

> **A buyer search permanently expands the marketplace's semantic coverage, while relevant vendors inherit candidate discoverability rather than fabricated inventory.**

Example:

```text
Buyer searches "dumbbells"
        ↓
CSRE Phrase → MarketConcept
        ↓
GPC mapping
        ↓
Evidence records demand + semantic relationship
        ↓
MKG cluster expansion/reinforcement
        ↓
Relevant vendor candidate priors
```

No vendor inventory assertion may be created solely from category-cluster inheritance.

Only independent capability evidence may establish:

```text
Vendor → SUPPLIES → Concept
```

---

# 22. Graph Reinforcement

A supported relationship receives additional positive evidence.

Example:

```text
Vendor → Hammer Drill

Current belief:
0.730

New independent positive confirmation:
strong

New belief:
0.842
```

Exact numeric update policy is implementation configurable.

---

# 23. Graph Decay

If evidence becomes stale or is contradicted, the belief can decline.

Example:

```text
Vendor → Hammer Drill

0.842
↓
inventory expires
↓
0.781

repeated negative responses
↓
0.492
```

Decay must be gradual unless there is unusually strong contradictory evidence.

---

# 24. Graph Pruning

Pruning should normally mean:

> remove or deactivate an unsupported hypothesis or relationship.

Do not permanently destroy historical evidence.

Example:

```text
Current graph:
Vendor → Generator Parts = 0.118

Graph decision:
PRUNE_ACTIVE_RELATIONSHIP
```

The historical evidence remains available.

This allows recovery if future evidence becomes positive.

---

# 25. Graph Decision States

The Graph Relevance Engine should return:

```text
EXPAND
REINFORCE
MAINTAIN
DECAY
PRUNE
NO_CHANGE
INVESTIGATE
```

### EXPAND

Create a new relevant relationship or candidate node.

### REINFORCE

Increase belief.

### MAINTAIN

Evidence supports keeping current state.

### DECAY

Reduce confidence because evidence is weakening/stale.

### PRUNE

Deactivate an unsupported relationship.

### NO_CHANGE

Evidence does not materially affect graph state.

### INVESTIGATE

Evidence is insufficient or contradictory and more evidence should be collected.

---

# 26. Evidence-First vs Graph-First Fusion

The graph-first strategy can initialize:

```text
Sibling A = 0.500
Sibling B = 0.500
Sibling C = 0.500
```

Evidence-first observations then modify those beliefs.

Example:

```text
Vendor confirmed:
Electrical switches

Graph priors:

Electrical sockets = 0.500
Plugs = 0.500
Electrical fittings = 0.500
```

Later:

```text
Vendor:
"Yes, I sell wall sockets."
```

Result:

```text
Electrical sockets = 0.910
```

Later:

```text
Vendor:
"No, I don't stock plugs."
```

Result:

```text
Plugs = 0.310
```

Later:

```text
Multiple customer interactions
Vendor repeatedly supplies plugs.
```

Result:

```text
Plugs = 0.904
```

The graph can recover from negative evidence when later positive evidence arrives.

---


## 26A. Locked Prior Computation

### Distance + relationship type determine the prior

> **Distance + relationship type determine the prior.**

The prior for a relationship MUST be a function of both graph distance and relationship type:

```text
prior_strength =
  f(
    graph_distance,
    relationship_type,
    relationship_direction,
    source_belief,
    context_compatibility,
    temporal_validity
  )
```

Minimum invariant:

> **Distance controls attenuation; relationship type controls semantic transfer strength.**

Therefore these are not equivalent:

```text
A → ACCESSORY_OF → B
A → SUBSTITUTE_FOR → C
A → COMMONLY_SOLD_WITH → D
A → USED_FOR → E
```

even when all are one graph hop away.

Prior propagation MUST:

- use the originating relationship's current state;
- reduce strength as distance increases unless policy explicitly overrides it;
- apply relationship-type weights;
- preserve directionality for directional predicates;
- prevent cyclic amplification;
- remain separate from direct evidence;
- be recalculable when graph structure or policy changes.

A prior is a hypothesis, never direct proof.

---

# 27. Vendor Capability Belief

A vendor capability relationship should conceptually be represented as:

```text
Vendor
  ↓
Target concept / GPC node
  ↓
Belief score
```

Example:

```json
{
  "vendor_id": "vendor-123",
  "target": {
    "type": "GPC_NODE",
    "id": "..."
  },
  "belief_score": 0.873,
  "evidence_summary": {
    "positive": 7,
    "negative": 1,
    "neutral": 2
  }
}
```

The score is dynamic and evidence-backed.

---

# 28. Product-Level and Category-Level Capability

The Evidence System should not assume every capability exists only at the GPC class level.

Evidence may support:

```text
Product
Subcategory
Category
Family
Segment
Service
Material
Capability
```

For example:

```text
Vendor carries:
Bosch GWS 750

Evidence can directly support:
Angle Grinder

and indirectly inform:
Power Tools
```

Indirect propagation must be graph-policy driven and must not be treated as direct confirmation.

---

# 29. External Component Interfaces

## CSRE → Evidence System

CSRE may request:

- known local meanings
- historical interpretation evidence
- known aliases
- prior interpretations
- contradictory evidence
- evidence for ambiguous expressions

Evidence System returns evidence and knowledge.

CSRE remains the final semantic resolver.

---

## WRS → Evidence System

WRS submits externally sourced evidence.

Evidence System:

- stores it
- evaluates provenance
- deduplicates
- links it to subjects
- derives reusable knowledge where appropriate

WRS remains responsible for external retrieval.

---

## Enrichment → Evidence System

Enrichment may:

- request relevant evidence
- submit derived insights
- attach evidence lineage

Enrichment remains responsible for GPC-oriented semantic enrichment.

---

## Intent Resolver

The Evidence System may provide historical evidence about usage patterns, but the Intent Resolver remains responsible for transaction intent.

---

## Market Knowledge Graph (MKG) ← Evidence System

Evidence emits validated `GraphChangeDecision` records to MKG. Evidence MUST NOT write graph storage directly. MKG validates graph topology, vocabulary, identity, idempotency, and authorization before applying the approved decision.

Example handoff:

```text
Evidence
  → GraphChangeDecision
  → MKG write port
  → graph validation
  → durable graph mutation
```

## Matching & Fanout

Matching & Fanout may request:

- vendor capability beliefs
- supporting evidence
- evidence freshness
- confidence
- graph relationships

Matching & Fanout remains responsible for matching, ranking, and fanout routing.

---

# 30. Evidence Request Contract

Any component requesting evidence should submit:

```json
{
  "request_id": "REQ-123",

  "consumer": {
    "component": "CSRE | ENRICHMENT | GPC_RESOLVER | MATCHING_FANOUT | OTHER",
    "version": "component-version"
  },

  "task": {
    "type": "SEMANTIC_RESOLUTION | GPC_MAPPING | ENRICHMENT | MARKET_RELATIONSHIP_VALIDATION | OTHER",
    "question": "string"
  },

  "objects": [
    {
      "id": "obj-1",
      "surface_form": "iron sponge",
      "market_concept_id": null
    }
  ],

  "semantic_target": {
    "phrase": "iron sponge",
    "concept": "steel wool / scouring pad",
    "relationship": "EXPRESSES",
    "origin": "CSRE"
  },

  "relationship_target": {
    "subject_id": "phrase-123",
    "predicate": "mkg:EXPRESSES",
    "object_id": "mc-123"
  },

  "context": {
    "country": "Nigeria"
  },

  "candidate_interpretations": [
    "steel wool",
    "direct reduced iron"
  ],

  "required_evidence": [
    "local_commercial_usage",
    "definition",
    "candidate_support",
    "candidate_contradiction",
    "relationship_support"
  ]
}
```

The important contract rule is:

> **Evidence requests may target a relationship, not only a node.**

This is required for learning market semantics such as:

```text
Phrase → EXPRESSES → MarketConcept
Concept → USED_FOR → Activity
Concept → SUBSTITUTE_FOR → Concept
Concept → ACCESSORY_OF → Concept
Concept → COMMONLY_SOLD_WITH → Concept
Vendor → SUPPLIES → Concept
Buyer → REQUESTED → Concept
Vendor → SERVES → Venue
```

The Evidence System should preserve the target relationship as an addressable assertion.

---

# 31. Evidence Response Contract

Stable envelope:

```json
{
  "request_id": "REQ-123",
  "status": "SUCCESS",
  "evidence": [],
  "knowledge": [],
  "insights": [],
  "contradictions": [],
  "provenance": [],
  "relationship_targets": [],
  "quality": {}
}
```

Each evidence record SHOULD make its assertion target explicit:

```json
{
  "evidence_id": "e-123",
  "observation_id": "obs-123",

  "assertion": {
    "subject": "phrase-123",
    "predicate": "mkg:EXPRESSES",
    "object": "market-concept-123"
  },

  "polarity": "POSITIVE",
  "strength": 0.910,
  "provenance": {},
  "independence_key": "string"
}
```

The Evidence System owns belief formation and graph relevance. WRS supplies external evidence;
CSRE supplies semantic-origin observations; GPC Resolver supplies mapping facts.

---


# 32A. Semantic-Origin Observation Contract

CSRE-originated Phrase → Concept output is an observable market-semantic event.

Example:

```json
{
  "observation_id": "obs-001",
  "observation_type": "CSRE_SEMANTIC_RESOLUTION",

  "subject": {
    "type": "PHRASE",
    "id": "phrase-001",
    "text": "iron sponge"
  },

  "predicate": "mkg:EXPRESSES",

  "object": {
    "type": "MARKET_CONCEPT",
    "id": "mc-001",
    "label": "steel wool / scouring pad",
    "status": "PROPOSED"
  },

  "source": {
    "component": "CSRE",
    "request_id": "REQ-001",
    "resolver_version": "4.0"
  },

  "context": {
    "country": "Nigeria"
  }
}
```

This observation is **not automatically durable truth**.

It enters the evidence pipeline:

```text
CSRE observation
      ↓
evidence evaluation
      ↓
belief / confidence
      ↓
graph decision
      ↓
Market Knowledge Graph
```

A newly proposed concept can therefore enter the learning loop without CSRE becoming the permanent knowledge store.

---

# 32. Evidence Producer Prompt

## SYSTEM PROMPT

```text
You are the Evidence Interpretation Agent.

Your responsibility is to transform an observed source or event into
structured, provenance-preserving evidence.

You do NOT resolve the user's final meaning.
You do NOT classify the user into GPC.
You do NOT make vendor matching decisions.

Determine only what the observation supports, contradicts, or leaves unknown.

Always preserve:
- source
- actor
- timestamp
- interaction
- raw observation
- object linkage
- polarity
- evidence strength
- provenance
- uncertainty

Never upgrade an observation beyond what it actually establishes.

Distinguish:
- direct evidence
- inferred evidence
- contextual evidence
- graph-derived prior

Graph priors are not direct evidence.

If the observation contains multiple objects, create separate evidence
relationships for each independently resolvable object.

Preserve shared relationships and shared context without merging objects.

Return valid JSON only.
```

---

# 33. Evidence Fusion Prompt

## SYSTEM PROMPT

```text
You are the Evidence Fusion Agent.

Your responsibility is to evaluate accumulated evidence and calculate the
current belief regarding a target relationship.

You must consider:
- positive evidence
- negative evidence
- contradictions
- source reliability
- evidence independence
- recency
- directness
- specificity
- historical consistency
- graph-derived priors

Do not treat a graph prior as direct evidence.

Do not count duplicate observations as independent evidence.

Scores must remain between 0.000 and 1.000.

1.000 means operational certainty under the system's evidence policy and
must be reserved for exceptionally strong, consistent, sufficiently
independent evidence.

Do not fabricate confidence.

Return:
- current score
- score direction
- evidence summary
- strongest supporting evidence
- strongest contradictory evidence
- whether further evidence is needed
```

---

# 34. Graph Relevance Prompt

## SYSTEM PROMPT

```text
You are the Graph Relevance Decision Agent.

Your responsibility is to determine how accumulated evidence should affect
relationships in the GPC capability graph.

Possible decisions:
EXPAND
REINFORCE
MAINTAIN
DECAY
PRUNE
NO_CHANGE
INVESTIGATE

Evaluate:
- current belief score
- graph prior
- direct evidence
- indirect evidence
- negative evidence
- contradiction
- recency
- graph relationship type
- evidence independence

Never treat a graph neighbor's existence as proof of capability.

A graph-derived prior is a hypothesis.

A direct vendor confirmation is evidence.

A negative vendor response is evidence against a capability.

Historical evidence must remain preserved even when a relationship is
pruned.

Do not delete evidence.

Return only the recommended graph decision and its justification.
```

---

# 35. Knowledge Extraction Prompt

## SYSTEM PROMPT

```text
You are the Market Knowledge Extraction Agent.

Your responsibility is to identify durable, reusable knowledge from
validated evidence and derived insights.

You may extract:
- local terminology mappings
- aliases
- product naming patterns
- commercial meanings
- recurring functional descriptions
- stable venue terminology
- recurring market relationships
- common buyer/vendor vocabulary

Do not turn one weak observation into permanent knowledge.

Knowledge must retain:
- the claim
- confidence
- supporting evidence IDs
- conflicting evidence IDs
- scope
- language/region
- created_at
- last_validated_at

Knowledge must be revisable.

Do not invent knowledge.
Do not silently replace historical knowledge.
```

---

# 36. Persistent Knowledge Example

```json
{
  "knowledge_id": "K-123",
  "type": "LOCAL_TERM_MAPPING",
  "claim": {
    "surface_term": "iron sponge",
    "canonical_concept": "steel wool"
  },
  "region": {
    "country": "Nigeria"
  },
  "confidence": 0.972,
  "supported_by": [
    "E-100",
    "E-141",
    "E-219"
  ],
  "contradicted_by": [],
  "last_validated_at": "2026-09-09T10:00:00Z"
}
```

---

# 37. Evidence and Knowledge Feedback Loop

The system must support continuous learning:

```text
New interaction
      ↓
Raw observation
      ↓
Evidence
      ↓
Evidence fusion
      ↓
Insight
      ↓
Validated knowledge
      ↓
Future CSRE / Enrichment / WRS requests
      ↓
Better interpretation
      ↓
Better evidence
```

This makes the marketplace increasingly knowledgeable about its own vocabulary and commercial behavior.

---

# 38. Knowledge Must Not Become Self-Proving

A critical rule:

> Knowledge derived from previous evidence must not automatically count as fresh independent evidence.

Example:

```text
Knowledge:
"hot flask" = vacuum flask
```

cannot be used as five independent observations simply because five components consumed it.

Knowledge can accelerate interpretation but should not artificially inflate capability belief.

Fresh evidence must originate from a new observation or independently sourced evidence.

---

# 39. Evidence Deduplication

The system must detect:

- duplicate events
- repeated delivery of the same message
- mirrored events
- same source copied across multiple systems
- repeated WRS retrieval of the same source
- repeated Enrichment consumption of the same evidence

A duplicate must not receive independent evidentiary weight.

---

# 40. Contradiction Management

Contradictory evidence must remain visible.

Example:

```text
E1:
Vendor has generator parts.

E2:
Vendor does not currently stock generator parts.
```

The system should not delete E1.

Instead:

```text
historical positive evidence
+
recent negative evidence
↓
current belief
```

This supports temporal interpretation.

---

# 41. Confidence Is Not Certainty in Every Context

The score is an operational belief score.

`1.000` is reserved for cases where the Evidence System's policy considers the capability effectively established.

This does not mean metaphysical or universal truth.

Example:

```text
Vendor explicitly confirms capability
+
multiple successful fulfillments
+
recent inventory confirmation
+
no meaningful contradictory evidence
```

may converge toward:

```text
0.998
```

and eventually:

```text
1.000
```

according to configured policy.

---

# 42. Recommended Event Types

The Evidence System should accept events including:

```text
buyer.search.created
buyer.message.received
buyer.clarification.answered
buyer.confirmation.received

vendor.onboarding.statement
vendor.inventory.updated
vendor.message.received
vendor.clarification.answered
vendor.request.responded
vendor.confirmation.received
vendor.rejection.received
vendor.fulfillment.completed

csre.resolution.created
enrichment.insight.created
wrs.evidence.retrieved
```

Events should be idempotent.

---

# 43. Reference Scoring Update Example

A vendor begins with a graph-derived prior:

```text
Hammer Drill = 0.500
```

Evidence stream:

```text
E1: Vendor explicitly says "I sell hammer drills."
E2: Vendor confirms during clarification.
E3: Vendor successfully fulfills a hammer-drill request.
E4: Recent inventory update lists hammer drills.
E5: Vendor later says hammer drills are out of stock.
```

The system must retain all five records.

Current belief may evolve approximately:

```text
0.500
↓
0.690
↓
0.810
↓
0.917
↓
0.956
↓
0.902
```

The exact update numbers are configurable. The important property is that the score reflects the accumulated evidence journey.

---

# 44. Score History

Every belief relationship should maintain a score history.

Example:

```json
{
  "target": "vendor-123 → hammer-drill",
  "current_score": 0.902,
  "history": [
    {
      "score": 0.500,
      "reason": "graph_prior"
    },
    {
      "score": 0.690,
      "reason": "vendor_confirmation"
    },
    {
      "score": 0.810,
      "reason": "clarification_confirmation"
    },
    {
      "score": 0.917,
      "reason": "successful_fulfillment"
    },
    {
      "score": 0.956,
      "reason": "recent_inventory_confirmation"
    },
    {
      "score": 0.902,
      "reason": "negative_recent_inventory_observation"
    }
  ]
}
```

This creates the desired **aggregated journey toward 1.000** instead of an opaque score.

---

# 45. Final System Boundaries

## Evidence System owns

- observations
- evidence
- provenance
- evidence fusion
- insights
- persistent market knowledge
- belief scores
- graph relevance
- graph expansion/reinforcement/decay/pruning decisions

## CSRE owns

- expression segmentation
- object extraction
- semantic resolution
- referent identification
- canonicalization
- commercial interpretation

## WRS owns

- external retrieval
- source discovery
- source extraction
- source quality assessment
- external evidence packaging

## Enrichment owns

- GPC-oriented semantic expansion
- embedding/search representations
- taxonomy-oriented terminology
- functional and contextual enrichment

## Intent Resolver owns

- BUY
- SELL
- FIND_VENDOR
- PRICE_INQUIRY
- AVAILABILITY
- DISCOVER
- other transaction intent

## GPC / Matching systems own

- taxonomy classification
- vector matching
- capability matching
- vendor ranking
- routing

---

# 46. Final Principle

The Evidence System should make the marketplace progressively smarter through real-world interaction.

The intended lifecycle is:

```text
Graph structure gives us a prior.
        ↓
Real-world interaction produces evidence.
        ↓
Evidence changes belief.
        ↓
Belief changes graph relevance.
        ↓
Repeated evidence produces durable knowledge.
        ↓
Knowledge improves future resolution and enrichment.
        ↓
Better resolution and enrichment produce better evidence.
        ↓
The graph continuously converges toward demonstrated reality.
```

The Evidence System therefore becomes the **learning and belief layer of the marketplace**, while keeping semantic resolution, enrichment, retrieval, intent, taxonomy mapping, and matching as separate responsibilities.


# 47. Locked Market Knowledge Graph Architecture

This section locks the Evidence System as the mechanism that validates and evolves the platform's proprietary understanding of commercial relationships. All existing evidence, scoring, graph-decision, vendor-belief, lifecycle, and prompt requirements remain in force.

## 47.1 Core Architectural Decision

The marketplace MUST maintain a continuously evolving **Market Knowledge Graph (MKG)** built from real user and market interactions.

The governing principle is:

> **A market/commercial relationship is not merely configured; it is built, validated, reinforced, weakened, and sometimes pruned as users interact with the system.**

The system therefore learns relationships such as:

```text
Phrase → Concept
Concept → Concept
Concept → Activity
Concept → Venue
Vendor → Concept
Buyer → Concept
Concept → Substitute
Concept → Accessory
Concept → CommonlySoldWith
```

The graph is not a static catalog of assumptions. It is a persistent model of how commerce actually works, with evidence and belief state attached to uncertain relationships.

## 47.2 Sovereign GPC Boundary

**GPC is the sovereign classification backbone.**

The Evidence System MUST NOT modify, redefine, fork, or fabricate GPC structure.

GPC supplies authoritative classification structure for downstream mapping. The platform's market knowledge sits alongside it:

```text
GPC
= sovereign classification backbone

Market Concept Scheme
= evolving semantic concept vocabulary

Market Knowledge Graph
= proprietary understanding of observed commercial relationships

Evidence
= mechanism that validates and evolves those relationships
```

A relationship may be associated with a GPC node while retaining its separate market-semantic meaning and evidence history.

## 47.3 RDF as the Foundational Graph Representation

The Evidence System MUST design graph persistence around **RDF as the foundational graph representation**.

Use:

```text
RDF
  → foundational graph model

SKOS
  → candidate representation of the evolving Market Concept Scheme

Custom RDF vocabulary
  → commercial relationships
  → evidence
  → capability beliefs
  → demand
  → venues
  → inventory
  → market behavior
```

The system MUST NOT force every commercial relationship into SKOS predicates merely because both concepts are represented as `skos:Concept`.

SKOS is appropriate for concept-scheme semantics such as:

```text
Concept → broader / narrower / related
Concept → preferred / alternate labels
Concept → mappings between concept schemes where justified
```

Custom predicates are required for directional or operational market semantics such as:

```text
Vendor → SUPPLIES → Concept
Vendor → HAS_BELIEF → Concept
Buyer → REQUESTED → Concept
Concept → USED_FOR → Activity
Concept → SUBSTITUTE_FOR → Concept
Concept → ACCESSORY_OF → Concept
Concept → COMMONLY_SOLD_WITH → Concept
Vendor → SERVES → Venue
Evidence → SUPPORTS → Assertion
Evidence → CONTRADICTS → Assertion
```

## 47.4 CSRE-Originated Phrase + Concept

CSRE is the source of the platform's semantic Phrase → Concept observation.

The Evidence System MUST be able to persist and learn from this handoff without re-resolving the language itself.

```text
CSRE
"iron sponge"
     ↓
Phrase → Concept("steel wool / scouring pad")
     ↓
Evidence System
     ↓
validate / reinforce / weaken / investigate
     ↓
Market Knowledge Graph
```

For each such relationship, the Evidence System should preserve:

- `phrase`;
- `concept_id` or concept identity;
- CSRE request/version;
- original object ID;
- context;
- evidence references;
- belief score;
- relationship status;
- temporal state;
- contradiction state;
- provenance.

CSRE-originated semantic resolution is an observation/input to the learning system, not automatically permanent market truth.

## 47.5 Collaborative Category Cluster Enrichment

The Evidence System is responsible for learning from **collaborative category cluster enrichment**.

Locked rule:

> **A buyer search permanently expands the marketplace's semantic coverage, while relevant vendors inherit candidate discoverability rather than fabricated inventory.**

Example:

```text
Buyer searches "dumbbells"
        ↓
CSRE creates/identifies Phrase → Concept("dumbbells")
        ↓
GPC Resolver maps the concept to GPC
        ↓
Evidence records buyer demand + semantic relationship
        ↓
MKG expands/strengthens the relevant concept cluster
        ↓
Relevant vendors receive candidate discoverability priors
        ↓
No inventory assertion is created
```

A later vendor confirmation or successful fulfillment can upgrade the vendor's belief for that concept.

This distinction is mandatory:

```text
semantic discoverability
        ≠
confirmed inventory
```

## 47.6 Distance + Relationship Type Determine the Prior

Graph distance alone MUST NOT determine a prior.

The prior for an unobserved or weakly observed relationship is a function of at least:

```text
prior_strength
= f(
    graph_distance,
    relationship_type,
    relationship_direction,
    evidence_quality_of_parent_relation,
    context_compatibility,
    temporal_validity
)
```

The locked rule is:

> **Distance and relationship type jointly determine the prior.**

### Distance effect

A shorter graph path generally creates a stronger candidate prior than a longer path, all else equal.

### Relationship-type effect

Different relationships imply different kinds of commercial plausibility.

For example:

```text
ACCESSORY_OF
SUBSTITUTE_FOR
COMMONLY_SOLD_WITH
USED_FOR
SIBLING_OF
BROADER_THAN
NARROWER_THAN
```

must not receive the same prior solely because they are one edge away.

Example conceptual model:

```text
Vendor → confirmed → Power Drill

Power Drill → ACCESSORY_OF → Drill Bit
Power Drill → SUBSTITUTE_FOR → Hammer Drill
Power Drill → USED_FOR → Masonry
Power Drill → RELATED_TO → Safety Equipment
```

These edges imply different prior strengths for a vendor's possible association with each target.

### Prior is not evidence

The resulting prior remains a hypothesis:

```text
Graph structure + relationship semantics
                ↓
        candidate prior
                ↓
    real-world observations
                ↓
        current belief
```

A graph-derived prior MUST NOT be persisted as direct vendor evidence.

## 47.7 Prior Propagation Requirements

Prior propagation MUST:

1. start from an evidence-backed or otherwise policy-approved source relationship;
2. account for graph distance;
3. account for relationship type;
4. account for directionality where the predicate is directional;
5. account for context compatibility;
6. prevent cycles from recursively amplifying a score without independent evidence;
7. decay as distance increases unless the relationship type explicitly warrants stronger transfer;
8. remain distinct from direct observations;
9. be recalculable if graph relationships change;
10. never be treated as confirmation of inventory.

## 47.8 Market Knowledge Graph Relationship States

Every material relationship should have an explicit state such as:

```text
PROPOSED
SUPPORTED
STRONG
WEAKENED
CONTRADICTED
STALE
PRUNED
```

The relationship state is derived from evidence and current belief; historical evidence remains immutable.

## 47.9 Evidence as the Evolution Mechanism

The Evidence System is the mechanism through which the MKG evolves.

```text
User interaction
      ↓
Raw observation
      ↓
Evidence
      ↓
Belief update
      ↓
Relationship decision
      ↓
MKG mutation/state change
      ↓
Future retrieval/resolution/matching context
      ↓
New observations
```

This learning loop applies to buyer demand, vendor capabilities, terminology, concept relationships, venues, services, substitutes, accessories, and market behavior.

## 47.10 Relationship Evidence Must Be First-Class

Evidence must attach to **relationships**, not only nodes.

For example:

```text
"iron sponge" → REFERS_TO → steel wool
```

requires evidence about the relationship itself.

Likewise:

```text
Vendor A → SUPPLIES → Wall Socket
```

requires capability evidence about that vendor-to-concept relationship.

The Evidence System should therefore treat an assertion as a first-class addressable target:

```text
Assertion
  subject
  predicate
  object
  context
  provenance
  evidence
  belief
  temporal_state
```

## 47.11 Distance-Aware Relationship Prior Example

Suppose:

```text
Vendor A → confirmed → Electrical Sockets

Electrical Sockets → ACCESSORY_OF → Electrical Faceplate
Electrical Sockets → COMMONLY_SOLD_WITH → Switches
Electrical Sockets → RELATED_TO → Cable
```

The system may assign distinct candidate priors:

```text
Electrical Faceplate   → stronger prior
Switches               → medium prior
Cable                  → weaker prior
```

The exact numeric values remain implementation-configurable, but the ordering must be derived from the relationship semantics and graph distance, not arbitrary equal initialization.

## 47.12 Vendor Prior and Capability Belief

The existing vendor capability model remains valid and is extended with relationship-aware priors.

Conceptually:

```text
candidate_prior
      ↓
new observations
      ↓
current capability belief
```

For a vendor, the system should distinguish:

```text
DIRECT_EVIDENCE
GRAPH_DERIVED_PRIOR
CURRENT_BELIEF
CONFIRMED_INVENTORY
```

These are never interchangeable.

---

# 48. Locked Prompt Additions for Evidence Fusion and Graph Relevance

All Evidence Fusion, Graph Relevance, Knowledge Extraction, and scoring prompts MUST follow these rules:

```text
MARKET KNOWLEDGE GRAPH RULES

1. The platform maintains a proprietary Market Knowledge Graph representing observed commercial reality.
2. Evidence is the mechanism that validates, reinforces, weakens, or prunes graph relationships.
3. GPC is the sovereign classification backbone and must not be modified by this system.
4. CSRE-originated Phrase → Concept relationships are semantic observations that may be validated and learned.
5. The Market Concept Scheme is separate from GPC and may be represented using SKOS.
6. RDF is the foundational graph representation.
7. Use custom RDF predicates for commercial relationships, evidence, capability beliefs, demand, venues, inventory, and market behavior.
8. Candidate priors are determined by BOTH graph distance and relationship type, plus relevant context and source strength.
9. A graph-derived prior is not direct evidence.
10. Buyer demand expands semantic coverage but does not prove vendor inventory.
11. Relevant vendors may receive candidate discoverability priors from validated concept relationships, without fabricating stock.
12. Evidence attached to a relationship must remain auditable and historically immutable.
13. Repeated evidence is not automatically independent; preserve observation identity and correlation.
14. Contradictory evidence weakens or changes current belief but does not erase history.
15. The graph should converge toward demonstrated market behavior over time.
```

---

# 49. Final Locked Architecture

```text
                    ┌─────────────────────┐
                    │        CSRE         │
                    │ Phrase → Concept    │
                    └──────────┬──────────┘
                               │
                               ▼
                 ┌───────────────────────────┐
                 │     Market Concept Layer  │
                 │ SKOS candidate scheme     │
                 └────────────┬──────────────┘
                              │
                              ▼
                 ┌───────────────────────────┐
                 │        GPC Resolver       │
                 │  GPC sovereign backbone   │
                 └────────────┬──────────────┘
                              │
                              ▼
                 ┌───────────────────────────┐
                 │    Market Knowledge Graph │
                 │ Proprietary market model  │
                 └────────────┬──────────────┘
                              ▲
                              │
                       validates/evolves
                              │
                 ┌────────────┴──────────────┐
                 │       Evidence System     │
                 │ observations, evidence,   │
                 │ beliefs, graph decisions  │
                 └────────────┬──────────────┘
                              ▲
                              │
                    users / vendors / WRS /
                    fulfillment / interactions
```

The architecture therefore treats the marketplace's semantic intelligence as a continuously learned system rather than a one-time taxonomy configuration.


## Integrated Architecture Lock

The five-document stack uses these authoritative boundaries:

```text
CSRE
  Phrase → EXPRESSES → MarketConcept
        ↓
Enrichment
        ↓
GPC Resolver
  MarketConcept → MAPPED_TO_GPC → Sovereign GPC
        ↓
Evidence / Market Knowledge Graph
  validates and evolves commercial relationships
```

```text
RDF = foundational graph representation
SKOS = semantic concept-scheme representation
Custom RDF vocabulary = commercial/evidence/behavior semantics
GPC = sovereign classification backbone
MKG = proprietary understanding of observed commerce
Evidence = mechanism that validates and evolves that understanding
```

No component may silently take ownership of another component's authoritative responsibility.

---

# 50. IMPLEMENTATION INTEGRATION CONTRACT — v4

This section is authoritative for Evidence System interoperability and supplements the full
evidence, belief, graph, decay, and learning requirements above.

## 50.1 Canonical evidence request schema

Evidence System requests use the following versioned envelope:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/evidence-request-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "request_id",
    "consumer",
    "task",
    "objects",
    "context",
    "candidate_interpretations",
    "required_evidence"
  ],
  "properties": {
    "schema_version": { "const": "4.0" },
    "request_id": { "type": "string" },
    "consumer": {
      "type": "object",
      "additionalProperties": false,
      "required": ["component", "version"],
      "properties": {
        "component": {
          "enum": ["CSRE", "ENRICHMENT", "WRS", "GPC_RESOLVER", "MATCHING_FANOUT", "OTHER"]
        },
        "version": { "type": "string" }
      }
    },
    "task": {
      "type": "object",
      "additionalProperties": false,
      "required": ["type", "question"],
      "properties": {
        "type": { "type": "string" },
        "question": { "type": "string" }
      }
    },
    "objects": { "type": "array" },
    "context": { "type": "object" },
    "candidate_interpretations": { "type": "array" },
    "required_evidence": { "type": "array" }
  }
}
```

## 50.2 Canonical evidence response schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/evidence-response-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "request_id",
    "status",
    "evidence",
    "knowledge",
    "insights",
    "contradictions",
    "provenance",
    "relationship_targets",
    "quality"
  ],
  "properties": {
    "schema_version": { "const": "4.0" },
    "request_id": { "type": "string" },
    "status": { "enum": ["SUCCESS", "PARTIAL", "NO_RELIABLE_EVIDENCE", "ERROR"] },
    "evidence": { "type": "array", "items": { "$ref": "#/$defs/evidence" } },
    "knowledge": { "type": "array" },
    "insights": { "type": "array" },
    "contradictions": { "type": "array" },
    "provenance": { "type": "array" },
    "relationship_targets": { "type": "array" },
    "quality": { "type": "object" }
  },
  "$defs": {
    "evidence": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "evidence_id",
        "claim",
        "supports",
        "contradicts",
        "relationship_target",
        "provenance",
        "confidence"
      ],
      "properties": {
        "evidence_id": { "type": "string", "minLength": 1 },
        "claim": { "type": "string", "minLength": 1 },
        "supports": { "type": "array", "items": { "type": "string" } },
        "contradicts": { "type": "array", "items": { "type": "string" } },
        "relationship_target": { "type": ["object", "null"] },
        "provenance": { "type": "object" },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    }
  }
}
```

## 50.3 Evidence normalization rule

WRS responses, CSRE observations, Enrichment-derived assertions, GPC mappings,
vendor interactions, buyer requests, and fulfillment outcomes are different source types
but MUST normalize into the same immutable evidence model.

```text
observation_id
evidence_id
assertion
polarity
strength
provenance
independence_key
observed_at
valid_from
valid_until
```

## 50.4 CSRE semantic-origin ingestion

A CSRE v5 object produces an observation:

```json
{
  "observation_id": "obs-001",
  "observation_type": "CSRE_SEMANTIC_RESOLUTION",
  "request_id": "REQ-001",
  "turn_id": "turn-001",
  "object_id": "object-001",
  "assertion": {
    "subject": "phrase-001",
    "predicate": "mkg:EXPRESSES",
    "object": "mc-001"
  },
  "semantic_origin": {
    "phrase": "iron sponge",
    "concept": "steel wool / scouring pad",
    "market_concept_id": "mc-001",
    "concept_status": "PROPOSED",
    "relationship": "EXPRESSES",
    "origin": "CSRE",
    "semantic_confidence": 0.93
  },
  "source": {
    "component": "CSRE",
    "version": "5.0"
  }
}
```

This is an observation, not durable truth.

## 50.5 GPC Resolver mapping ingestion

The GPC Resolver emits a mapping fact, not a belief:

```text
MarketConcept
      ↓
GPC mapping fact
      ↓
Evidence System
      ↓
belief / graph relevance decision
```

The resolver MUST NOT directly create vendor capability belief.

## 50.6 WRS ingestion

WRS evidence MUST retain:

```text
wrs.request_id
wrs.evidence_id
source_id
source_url where available
claim
supports
contradicts
relationship_target
geographic relevance
temporal relevance
source quality
confidence
```

## 50.7 Knowledge lifecycle

Knowledge derived from evidence MUST retain evidence lineage and MUST never become self-proving.

```text
new observation
      ↓
new evidence
      ↓
fusion
      ↓
knowledge / belief
```

Previously stored knowledge may guide retrieval or candidate generation, but cannot count as
a new independent observation.

## 50.8 Prompt/output binding

All evidence interpretation, fusion, graph relevance, and knowledge extraction prompts MUST use
formal output schemas. Natural-language instructions such as "return current score" or
"return only the recommended graph decision" are not sufficient as machine contracts.

Each structured prompt is bound to a versioned schema:

```text
evidence interpretation schema
evidence fusion schema
graph relevance decision schema
knowledge extraction schema
```

The implementation MUST validate before persistence.

## 50.9 Graph mutation boundary

No LLM response may directly mutate RDF/MKG persistence.

```text
LLM result
   ↓ schema validation
   ↓ policy validation
   ↓ Evidence System decision
   ↓ authorized Graph Writer
```

---

# 51. STRUCTURED PROMPT OUTPUT CONTRACTS

All four Evidence System structured agents MUST use explicit schemas.

## 51.1 Evidence interpretation schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/evidence-interpretation-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "evidence"],
  "properties": {
    "schema_version": {"const": "4.0"},
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "evidence_id",
          "observation_id",
          "assertion",
          "polarity",
          "strength",
          "provenance",
          "independence_key"
        ],
        "properties": {
          "evidence_id": {"type": "string"},
          "observation_id": {"type": "string"},
          "assertion": {
            "type": "object",
            "additionalProperties": false,
            "required": ["subject", "predicate", "object"],
            "properties": {
              "subject": {"type": "string"},
              "predicate": {"type": "string"},
              "object": {"type": "string"}
            }
          },
          "polarity": {"enum": ["POSITIVE", "NEGATIVE", "NEUTRAL", "CONTRADICTORY"]},
          "strength": {"type": "number", "minimum": 0, "maximum": 1},
          "provenance": {"type": "object"},
          "independence_key": {"type": "string"}
        }
      }
    }
  }
}
```

## 51.2 Evidence fusion schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/evidence-fusion-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "relationship_id",
    "current_score",
    "direction",
    "evidence_summary",
    "supporting_evidence_ids",
    "contradictory_evidence_ids",
    "requires_more_evidence"
  ],
  "properties": {
    "schema_version": {"const": "4.0"},
    "relationship_id": {"type": "string"},
    "current_score": {"type": "number", "minimum": 0, "maximum": 1},
    "direction": {"enum": ["INCREASING", "DECREASING", "STABLE", "UNCERTAIN"]},
    "evidence_summary": {"type": "string"},
    "supporting_evidence_ids": {"type": "array", "items": {"type": "string"}},
    "contradictory_evidence_ids": {"type": "array", "items": {"type": "string"}},
    "requires_more_evidence": {"type": "boolean"}
  }
}
```

## 51.3 Graph relevance schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/graph-relevance-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "relationship_id",
    "decision",
    "belief_score",
    "justification",
    "evidence_ids"
  ],
  "properties": {
    "schema_version": {"const": "4.0"},
    "relationship_id": {"type": "string"},
    "decision": {
      "enum": ["EXPAND", "REINFORCE", "MAINTAIN", "DECAY", "PRUNE", "NO_CHANGE", "INVESTIGATE"]
    },
    "belief_score": {"type": "number", "minimum": 0, "maximum": 1},
    "justification": {"type": "string"},
    "evidence_ids": {"type": "array", "items": {"type": "string"}}
  }
}
```

## 51.4 Knowledge extraction schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/knowledge-extraction-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "knowledge_candidates"],
  "properties": {
    "schema_version": {"const": "4.0"},
    "knowledge_candidates": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "knowledge_id",
          "type",
          "claim",
          "scope",
          "confidence",
          "supported_by",
          "contradicted_by"
        ],
        "properties": {
          "knowledge_id": {"type": "string"},
          "type": {"type": "string"},
          "claim": {"type": "object"},
          "scope": {"type": "object"},
          "confidence": {"type": "number", "minimum": 0, "maximum": 1},
          "supported_by": {"type": "array", "items": {"type": "string"}},
          "contradicted_by": {"type": "array", "items": {"type": "string"}}
        }
      }
    }
  }
}
```

All structured outputs MUST be schema-validated before any belief or knowledge mutation.

---

## Cross-Stack Version Matrix

```text
CSRE v5.2 (wire v5.0)
  → semantic-origin observations
Enrichment v4.2 (wire v4.0)
  → derived semantic assertions + evidence lineage
WRS v4.2 (wire v4.0)
  → externally sourced evidence
GPC Resolver v4.2 (wire v4.0)
  → GPC mapping facts
IDCE v1.4
  → intent context/evidence when explicitly submitted
MCOS/LangGraph v4.2
  → turn/workflow interaction provenance
```

Evidence System v4.2 is the persistence/fusion authority. None of the upstream components may
convert its own model output directly into durable graph truth.


---

# 52. FINAL IMPLEMENTATION INTEGRATION CONTRACT — v4.2

This section is authoritative for ingestion and provenance across CSRE, Enrichment, WRS, GPC Resolver,
IDCE, Matching & Fanout, and MCOS/LangGraph. Existing evidence-learning rules remain unchanged.

## 52.1 CSRE semantic-origin exact preservation

The Evidence System MUST preserve the complete CSRE semantic-origin record without dropping or
renaming fields:

```json
{
  "phrase": "string",
  "concept": "string",
  "market_concept_id": "string|null",
  "concept_status": "KNOWN|PROPOSED",
  "relationship": "EXPRESSES",
  "origin": "CSRE",
  "request_id": "string",
  "semantic_confidence": 0.0
}
```

In particular, `semantic_origin.request_id` is distinct from the Evidence System
`observation_id` and MUST be retained.

## 52.2 Canonical normalized evidence record

All persisted evidence MUST normalize into:

```typescript
export interface NormalizedEvidenceRecord {
  observationId: string;
  evidenceId: string;
  assertion: {
    subject: string;
    predicate: string;
    object: string;
  };
  polarity: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'UNKNOWN';
  strength: number;
  provenance: {
    sourceType: string;
    sourceId: string | null;
    sourceUrl: string | null;
    component: string;
    componentVersion: string;
    requestId: string | null;
    turnId: string | null;
  };
  independenceKey: string;
  observedAt: string;
  validFrom: string | null;
  validUntil: string | null;
}
```

The normalized model is the persistence boundary; upstream model payloads remain attributable.

## 52.3 WRS ingestion

A WRS response is an external-evidence observation. The Evidence System MUST persist the WRS
`request_id` and every `evidence_id`, plus source/provenance metadata, and MUST assign its own
`observation_id`.

WRS evidence MUST NOT be rephrased into an apparently direct fact without retaining its source claim.

## 52.4 GPC mapping ingestion

A GPC mapping is a semantic/taxonomy relationship observation:

```text
MarketConcept
   → MAPPED_TO_GPC
   → GPC node
```

It may support taxonomy knowledge and graph relevance decisions. It MUST NOT directly create:

```text
Vendor → SUPPLIES → MarketConcept
```

unless separate vendor-specific evidence exists.

The mapping observation MUST retain:

```text
gpc_resolver_request_id
gpc_resolver_version
gpc_dataset_version
market_concept_id
gpc_code
mapping_state
mapping_confidence
evidence_ids
```

## 52.5 IDCE and intent evidence

IDCE output may be ingested as interaction provenance or intent evidence only when a downstream
policy explicitly requests it. Intent classification MUST NOT be rewritten into semantic-object
truth.

At minimum retain:

```text
request_id
turn_id
intent_id
intent_type
intent_confidence
source_spans
context_snapshot_id
```

## 52.6 MCOS/LangGraph provenance

For evidence originating from an orchestrated turn, retain:

```text
conversation_id
turn_id
run_id
action_id
workflow_id
```

These fields provide operational lineage but do not change evidence polarity or truth.

## 52.7 Machine-enforced evidence item schema

Add the following `$defs.evidenceRecord` to the canonical v4 evidence response/request validation
layer where persisted evidence items are validated:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "evidence_id",
    "claim",
    "supports",
    "contradicts",
    "relationship_target",
    "provenance",
    "confidence"
  ],
  "properties": {
    "evidence_id": { "type": "string", "minLength": 1 },
    "claim": { "type": "string", "minLength": 1 },
    "supports": { "type": "array", "items": { "type": "string" } },
    "contradicts": { "type": "array", "items": { "type": "string" } },
    "relationship_target": { "type": ["object", "null"] },
    "provenance": { "type": "object" },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
  }
}
```

The schema supplements, rather than replaces, the more detailed evidence model defined earlier.

## 52.8 No self-proving loop

A knowledge record produced by the Evidence System MUST NOT be treated as independent direct evidence
of the same claim without a separate observation/provenance source.

This preserves the existing rule that graph knowledge may create priors, but observations test priors.

---

# 53. NORMATIVE AGENDA COMPLETION — v4.3

**Effective:** 2026-09-10  
**Status:** Authoritative amendment. This section overrides earlier wording wherever this TDR implies that Evidence itself is the authoritative graph store or that Evidence may directly mutate MKG persistence.

## 53.1 Standalone MKG boundary

The **Market Knowledge Graph (MKG)** is now a standalone platform subsystem with its own TDR and service boundary.

Evidence owns the learning pipeline:

```text
raw observation → evidence → insight/knowledge → current belief → graph change decision
```

MKG owns the graph state:

```text
approved graph change decision → validation → graph mutation → queryable graph state
```

Evidence MUST NOT directly become the graph database/source of truth.

## 53.2 Graph change decision contract

Evidence produces a versioned `GraphChangeDecision` such as:

```json
{
  "decision_id": "string",
  "operation": "ADD|REINFORCE|DECAY|DEACTIVATE|PRUNE|REJECT",
  "subject_id": "string",
  "predicate": "string",
  "object_id": "string",
  "belief_score": 0.000,
  "reason_codes": ["string"],
  "evidence_ids": ["string"],
  "policy_version": "string",
  "created_at": "ISO-8601"
}
```

MKG validates topology, predicate semantics, identity, and write authorization before mutation.

## 53.3 Relationship semantics

Distance alone is never sufficient to establish commercial relevance. Belief/prior computation must account for:

1. relationship type;
2. graph distance/traversal path;
3. direction/inverse semantics;
4. evidence strength and independence;
5. geography and temporal scope;
6. policy/version.

Graph-derived priors remain hypotheses and never become direct vendor inventory evidence.

## 53.4 Vendor capability invariant

`buyer demand ≠ vendor capability ≠ inventory confirmation` remains non-negotiable. Evidence may update capability beliefs, but Matching & Fanout remains responsible for operational matching and fanout.



# 54. NORMATIVE AGENDA COMPLETION — v4.4 LEARNING SAFETY + MARKET-LANGUAGE GROUNDING

**Effective:** 2026-09-12  
**Status:** Authoritative amendment.

## 54.1 Evidence independence is first-class

Evidence MUST represent source independence separately from raw observation count.

At minimum, the evidence model/policy MUST be able to distinguish:

```text
observation_count
independent_source_count
independence_key
source_type
speaker/actor cohort where appropriate
geographic scope
temporal scope
contradiction count
confirmation count
```

Repeated statements from the same actor/session MUST NOT be treated as independent corroboration.

## 54.2 Claim-sensitive promotion policy

Evidence MUST support progressive knowledge states. A novel relationship or phrase grounding SHOULD move through a policy-controlled lifecycle such as:

```text
CANDIDATE
  ↓ corroborated
SUPPORTED
  ↓ stronger independent evidence / confirmation
ESTABLISHED
  ↓ contradiction / decay
WEAKENING / INACTIVE
```

The exact thresholds are policy-controlled and claim-sensitive.

Merchant confirmation is a high-value signal for vendor capability and market-language grounding, but manual confirmation MUST NOT be mandatory for every claim.

## 54.3 No correlated self-proof

The rule remains absolute:

> A knowledge record cannot serve as independent direct evidence for the same claim.

Likewise, a downstream graph-derived prior MUST NOT be re-ingested as fresh evidence merely because the same prior helped a later model produce a consistent result.

## 54.4 Market-language evidence

The following are first-class observation sources for local commercial language:

- vendor onboarding statements;
- vendor voice transcripts;
- buyer search phrases;
- buyer clarification answers;
- vendor clarification answers;
- vendor confirmations/rejections;
- repeated regional usage;
- fulfillment outcomes;
- high-quality external evidence where available.

A language observation may support a claim such as:

```text
Phrase("local market expression")
    → EXPRESSES
    → MarketConcept("canonical commercial referent")
```

Evidence MUST preserve locality and provenance rather than converting a Nigerian-market expression into a universal global fact.

## 54.5 Graph priors remain hypotheses

Graph-derived relationships may improve candidate generation, enrichment, or matching, but they MUST remain distinguishable from direct observations.

`buyer demand ≠ vendor capability ≠ inventory confirmation` remains non-negotiable.

## 54.6 Evidence write path remains asynchronous where safe

Evidence ingestion and graph-change propagation SHOULD use transactional outbox/event mechanisms when evidence originates from a business transaction. User-facing workflows MUST NOT require cross-store distributed transactions merely to record learning.
