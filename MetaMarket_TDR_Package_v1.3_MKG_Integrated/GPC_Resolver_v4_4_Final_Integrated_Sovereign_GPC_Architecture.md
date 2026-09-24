# GPC Resolver — Integrated Taxonomy Mapping Architecture v4.4

> This revision hardens the CSRE → Enrichment → GPC Resolver → Evidence System interoperability contract, makes the CSRE-originated MarketConcept an explicit GPC input/output identity, and preserves GPC as the sovereign classification backbone.

# GPC Resolver v4.3 — Sovereign GPC Classification
## Production Technical Design Requirements, Responsibility Contract, Data Model, Workflows, and Production Prompts

**Status:** Production-ready architecture  
**Version:** 4.4
**Primary market:** Nigerian informal + formal commerce  
**Decision rule:** **Only the strongest defensible decision wins. Do not return a list of equal alternatives when evidence supports a clear winner. Preserve alternatives only as diagnostic evidence when ambiguity remains.**

> **MKG ownership rule:** The Market Knowledge Graph is a standalone subsystem. This TDR preserves prior integrated graph material for traceability, but the standalone MKG TDR is authoritative for graph state, commercial relationship semantics, and traversal.

---

# 1. Executive Decision

The marketplace semantic stack is divided into five authoritative responsibilities:

```text
CSRE
  ↓
"What is the user referring to?"
  ↓
Semantic resolution

ENRICHMENT
  ↓
"What reliable semantic context makes this easier to classify/search?"
  ↓
GPC-oriented enrichment

GPC RESOLVER
  ↓
"Where does this already-resolved concept belong in sovereign GPC?"
  ↓
Taxonomy mapping

EVIDENCE SYSTEM
  ↓
"What has the marketplace learned, how strong is it, and how should graph relationships change?"
  ↓
Belief + learning + graph relevance

Matching & Fanout
  ↓
"Which vendors should be surfaced for this demand?"
  ↓
Capability matching / ranking
```

WRS is a shared evidence-acquisition capability used by the components above when external evidence is materially useful.

The central architectural rule is:

> **Never use GPC similarity, graph proximity, vendor capability, or commercial usefulness as a substitute for resolving what the concept actually is.**

The sovereign taxonomy remains immutable. The marketplace's learned vocabulary, relationships, observations, and behavioral intelligence live outside the sovereign taxonomy.

---

# 2. Source Requirements Preserved

This TDR preserves the important requirements from the four foundation specifications:

| Source | Preserved responsibility |
|---|---|
| CSRE | Cognitive Multi-Entity Extraction, contextual resolution, canonical referents, brands/models, local language, commercial interpretation, ambiguity, one clarification question, non-commercial handling |
| Enrichment | object-level enrichment, functional/use-case semantics, terminology, taxonomy-oriented vocabulary, confusable concepts, hierarchy hints, multiple embedding representations, evidence-aware enrichment |
| WRS | adaptive retrieval, consumer-aware requests, provenance, source quality, contradiction handling, local/current evidence, evidence vs inference separation |
| Evidence System | raw observation → evidence → insight/knowledge → current belief → graph decision, priors vs evidence, scoring, polarity, decay, deduplication, graph expansion/reinforcement/pruning, persistent knowledge |
| GPC Overhaul / graph rules | sovereign GPC hierarchy, PGVector retrieval, graph anchoring, phrase/concept auditability, organic concept clusters, vendor capability edges, demand-driven cluster growth |

No downstream component may silently absorb another component's authoritative responsibility.

---

# 3. Problem Being Solved

Informal-market language is not a stable catalog language.

Users may provide:

- standard product names
- informal names
- slang
- Nigerian Pidgin
- phonetic spellings
- misspellings
- brand names
- branded product names
- model numbers
- trade names
- descriptions
- functional descriptions
- use-case descriptions
- product categories
- subcategories
- domains
- services
- materials
- professions/capabilities
- titles and named entities
- venues
- incomplete expressions
- composite/multi-object expressions
- mixtures of all the above

The platform must therefore translate arbitrary language into a stable real-world representation before taxonomy classification.

---

# 4. Immutable Responsibility Boundaries

## 4.1 CSRE owns

- expression segmentation
- Cognitive Multi-Entity Extraction (CMEE)
- object/referent extraction
- semantic candidate generation
- contextual interpretation
- local/regional language interpretation
- commercial interpretation
- canonical representation
- ambiguity detection
- one high-information clarification question
- preservation of surface form, aliases, brand, model, attributes, relationships

CSRE does not own GPC IDs, intent, enrichment, vendor matching, ranking, conversation orchestration, or evidence persistence.

## 4.2 Enrichment owns

- semantic expansion of already-resolved objects
- functional characterization
- use-case expansion
- distinguishing attributes
- commercial terminology
- local terminology where supported
- taxonomy-oriented vocabulary
- confusable concepts
- hierarchy hints
- GPC-oriented embedding/search representations
- object-level and relationship-aware enrichment
- conditional use of WRS

Enrichment does not classify GPC.

## 4.3 WRS owns

- external information retrieval
- query formulation/expansion
- source discovery
- source quality evaluation
- evidence extraction/normalization
- contradiction reporting
- geographic and temporal relevance
- provenance
- evidence confidence/contribution
- consumer-specific evidence packaging
- evidence deduplication
- evidence vs inference separation

WRS does not make final semantic, taxonomy, intent, enrichment, or matching decisions.

## 4.4 Evidence System owns

- raw observations
- structured evidence
- provenance
- evidence strength
- evidence polarity
- evidence independence/deduplication
- derived insights
- persistent market knowledge
- evidence fusion
- current belief scores
- decay
- contradiction management
- graph relevance decisions
- graph expansion/reinforcement/decay/pruning

## 4.5 GPC Resolver owns

- retrieval of GPC candidates from the existing sovereign taxonomy
- taxonomy-aware candidate comparison
- hierarchy-aware reasoning
- semantic/definition/function/attribute/entity-type/specificity compatibility checks
- final GPC mapping
- mapping confidence
- mapping state
- preservation of alternatives as diagnostics
- object-by-object GPC mapping for multi-object inputs

## 4.6 Matching & Fanout owns

- vendor capability matching
- vendor ranking
- recipient selection
- capability scoring for operational matching
- fanned-out demand distribution

The GPC Resolver must never choose vendors.

---

# 5. Sovereign GPC Rule

GS1 GPC is the immutable classification authority.

Canonical GPC levels:

```text
Segment
  ↓
Family
  ↓
Class
  ↓
Brick / attributes where applicable
```

The GPC Resolver:

- may consume the installed GPC dataset
- may index the taxonomy
- may retrieve candidates
- may compare candidates
- may map a concept to an existing GPC node

It must never:

- create arbitrary GPC classes
- mutate official GPC hierarchy
- invent GPC identifiers
- create generic catch-all taxonomy nodes
- change canonical meaning to fit a taxonomy node
- treat the same Segment/Family as proof of commercial equivalence

> **Hierarchy is a classification constraint, not the marketplace's commercial relationship graph.**

Two classes in the same family may still represent materially different products.

---

# 6. Market Semantic Layer

The marketplace needs an evolving semantic layer around the sovereign GPC.

Use:

```text
Phrase
   ↓
MarketConcept
   ↓
MAPPED_TO
   ↓
GPC Class
```

The Market Concept layer stores learned commercial language and normalized concepts without modifying GPC.

Examples:

```text
"iron sponge"
    → MarketConcept: steel wool / scouring pad

"hot flask"
    → MarketConcept: vacuum flask

"bend down select"
    → MarketConcept: second-hand clothing
```

The semantic layer can grow from real buyer/vendor interactions while GPC remains authoritative and immutable.

---

# 7. RDF + SKOS Decision

Use:

> **RDF as the graph representation, SKOS for the market concept scheme, and custom RDF predicates for commercial/evidence relationships.**

## 7.1 SKOS responsibilities

Use SKOS for semantic concept structure:

- `skos:Concept`
- `skos:ConceptScheme`
- `skos:prefLabel`
- `skos:altLabel`
- `skos:broader`
- `skos:narrower`
- `skos:related`
- justified mapping relations between concept schemes

## 7.2 Custom predicates

Do not flatten commercial meaning into generic `skos:related`.

Examples:

```text
Vendor → SUPPLIES → MarketConcept
Buyer → REQUESTED → MarketConcept
MarketConcept → USED_FOR → Activity
MarketConcept → COMMONLY_SOLD_WITH → MarketConcept
MarketConcept → SUBSTITUTE_FOR → MarketConcept
MarketConcept → ACCESSORY_OF → MarketConcept
Vendor → SERVES → Location
Vendor → HAS_BELIEF → MarketConcept/GPC
Evidence → SUPPORTS → Assertion
Evidence → CONTRADICTS → Assertion
Phrase → EXPRESSES → MarketConcept
MarketConcept → MAPPED_TO_GPC → GpcClass
```

Direction and relationship semantics must be preserved.

---

# 8. Canonical Graph Architecture

The production graph contains four conceptual layers.

```text
                 ┌──────────────────────────────┐
                 │      SOVEREIGN TAXONOMY      │
                 │ Segment → Family → Class     │
                 └──────────────┬───────────────┘
                                │
                         MAPPED_TO_GPC
                                │
                 ┌──────────────▼───────────────┐
                 │     MARKET CONCEPT LAYER     │
                 │ concepts + labels + meaning  │
                 └──────────────┬───────────────┘
                                │
                     commercial relationships
                                │
       ┌────────────────────────┼────────────────────────┐
       │                        │                        │
     Phrase                   Actor                   Context
       │                        │                        │
   EXPRESSes                 SUPPLIES                USED_FOR
       │                        │                        │
       └────────────── Market Knowledge / Evidence ──────┘
```

Evidence attaches to assertions and observations, not just to nodes.

---

# 9. Core Graph Node Types

## 9.1 `GpcSegment`

Represents an official GPC Segment.

Properties:

```text
code
title
```

## 9.2 `GpcFamily`

Properties:

```text
code
title
segmentCode
```

## 9.3 `GpcClass`

Properties:

```text
code
title
definition
familyCode
segmentCode
```

## 9.4 `GpcBrick` (optional but recommended)

Use when the installed GPC dataset exposes brick-level semantics that materially improve precision.

Properties:

```text
code
title
definition
classCode
attributes
```

The Resolver may classify at the deepest defensible level supported by the available GPC contract.

## 9.5 `MarketConcept`

Properties:

```text
id
preferredLabel
entityType
definition
specificityLevel
createdAt
updatedAt
```

## 9.6 `Phrase`

Properties:

```text
id
text
rawInput
sessionId
objectId
createdAt
language
region
```

## 9.7 `Actor`

Use one actor identity for market participants regardless of buyer/vendor role.

Properties:

```text
id
uniqueBusinessName
location
```

An actor can be:

```text
Buyer
Vendor
Both
```

## 9.8 `Context`

Examples:

```text
roofing
construction
repair
fashion
restaurant
hardware store
```

## 9.9 `Evidence`

Evidence is immutable and provenance-bearing.

---

# 10. Core Relationships

## 10.1 Sovereign hierarchy

```text
(:GpcClass)-[:BELONGS_TO]->(:GpcFamily)
(:GpcFamily)-[:BELONGS_TO]->(:GpcSegment)
```

## 10.2 Phrase to concept

```text
(:Phrase)-[:EXPRESSES]->(:MarketConcept)
```

The relation may retain the exact extracted `object_id`.

## 10.3 Concept to GPC

```text
(:MarketConcept)-[:MAPPED_TO_GPC {
  mappingConfidence,
  mappingState,
  gpcCode,
  mappedAt,
  resolverVersion
}]->(:GpcClass)
```

## 10.4 Buyer demand

```text
(:Actor)-[:REQUESTED]->(:MarketConcept)
```

or a request/event entity may be used when interaction-level provenance is required.

## 10.5 Vendor capability

```text
(:Actor)-[:SUPPLIES_GPC_CLASS {
  status,
  beliefScore,
  source
}]->(:GpcClass)
```

Possible statuses:

```text
CONFIRMED
BELIEVED
CLUSTER_INHERITED
NEGATED
INACTIVE
```

## 10.6 Commercial relationships

```text
(:MarketConcept)-[:USED_FOR]->(:Context)
(:MarketConcept)-[:ACCESSORY_OF]->(:MarketConcept)
(:MarketConcept)-[:SUBSTITUTE_FOR]->(:MarketConcept)
(:MarketConcept)-[:COMMONLY_SOLD_WITH]->(:MarketConcept)
(:MarketConcept)-[:RELATED_TO]->(:MarketConcept)
(:Actor)-[:SERVES]->(:Location)
```

Every uncertain relationship should carry or link to evidence and a current belief.

---

# 11. PostgreSQL / PGVector Taxonomy Index

The sovereign taxonomy must be searchable independently from the graph.

Reference schema:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE gpc_classes (
    code VARCHAR(20) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    definition TEXT,
    segment_code VARCHAR(20),
    segment_title VARCHAR(255),
    family_code VARCHAR(20),
    family_title VARCHAR(255),
    brick_code VARCHAR(20),
    brick_title VARCHAR(255),
    text_to_embed TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS gpc_classes_embedding_idx
ON gpc_classes
USING hnsw (embedding vector_cosine_ops);
```

Embedding generation should include:

```text
title
definition
hierarchical lineage
relevant attributes
```

The exact embedding dimension is implementation/configuration dependent; the above is the retained baseline from the original GPC design.

---

# 12. GPC Candidate Retrieval

Vector similarity is a **candidate generator**, not the final decision.

Candidate generation should combine:

1. vector similarity
2. lexical similarity
3. aliases/synonyms
4. Enrichment terminology
5. definitions
6. function
7. attributes
8. entity type
9. hierarchy
10. previously validated MarketConcept → GPC mappings
11. evidence-backed market knowledge
12. exact known code/title signals where applicable

Candidate generation should retain enough candidates to avoid premature false precision.

---

# 13. GPC Candidate Evaluation

Each candidate receives an internal evaluation profile.

Recommended signals:

```text
semanticFit
definitionFit
functionalFit
attributeFit
entityTypeFit
hierarchyFit
specificityFit
marketKnowledgeSupport
evidenceSupport
contradictionPenalty
```

Conceptually:

```text
candidateScore =
  weighted positive compatibility
  -
  contradiction / mismatch penalties
```

Weights are configuration, not hard-coded doctrine.

The final winner must be the strongest defensible candidate, not merely the candidate with the highest raw vector similarity.

---

# 14. Semantic Compatibility Rules

## 14.1 Entity type compatibility

Do not map:

```text
person
organization
venue
service
material
capability
```

to a product GPC class merely because their words are similar.

## 14.2 Functional compatibility

A product must plausibly perform the relevant function of the candidate class.

## 14.3 Attribute compatibility

Explicit attributes from CSRE/Enrichment are positive or negative evidence.

Examples:

```text
capacity
material
mechanism
form
intended physical function
```

But attributes must be treated as object-owned facts.

## 14.4 Specificity compatibility

Prefer the deepest defensible match.

```text
correct broad class
    >
false precise child
```

If the input is genuinely broad, do not force product-level precision.

## 14.5 Definition compatibility

A candidate's official definition must be compatible with the resolved referent.

## 14.6 Hierarchy compatibility

Hierarchy can eliminate incompatible candidates.

It cannot by itself prove equivalence.

---

# 15. Deepest Defensible Mapping

The Resolver must follow:

> **Map as specifically as the evidence supports, but never more specifically.**

Examples:

```text
"power tools"
→ broad product/category mapping

"angle grinder"
→ more specific mapping

"Bosch GWS 750"
→ angle grinder concept with brand/model preserved;
  do not confuse the model with the taxonomy identity
```

False precision is worse than a defensible broader mapping.

---

# 16. Brand / Model Rule

CSRE preserves:

```text
canonical_form
brand
model
variant
attributes
```

The GPC Resolver evaluates the product concept represented by the object.

Example:

```text
surface: "Bosch GWS 750"

canonical_form: angle grinder
brand: Bosch
model: GWS 750
```

The mapping target is selected for `angle grinder`, while brand/model remain metadata.

Do not map the brand itself to an arbitrary product class unless the resolved object is actually the brand entity and the downstream contract explicitly calls for entity classification.

---

# 17. Category / Domain / Service Rule

Do not force every object into a product GPC class.

Possible input specificity:

```text
DOMAIN
CATEGORY
SUBCATEGORY
PRODUCT
SERVICE
MATERIAL
CAPABILITY
OTHER COMMERCIAL CONCEPT
NON_COMMERCIAL
```

The GPC Resolver should:

- map only when a valid GPC representation exists for the resolved meaning and contract
- otherwise return `NOT_APPLICABLE`
- preserve the resolved meaning
- never distort the concept merely to produce a GPC code

---

# 18. Multi-Object GPC Resolution

Every independently resolvable CSRE object remains independent.

Input:

```text
"I need a hammer, nails and electrical materials for roofing."
```

CSRE:

```text
object_1 → hammer
object_2 → nails
object_3 → electrical materials
functional_context → roofing
```

Enrichment creates one profile per object.

GPC Resolver produces:

```text
object_1 → best GPC mapping
object_2 → best GPC mapping
object_3 → best GPC mapping
```

The shared roofing context can influence functional compatibility but must never become a fourth product.

Each object can have its own:

```text
mappingState
mappingConfidence
candidate set
diagnostics
```

One ambiguous object must not block the successful mappings of the others.

---

# 19. Multi-Object Relationships

Relationships are preserved separately.

Example:

```text
phones
repair
```

with:

```text
repair --APPLIES_TO--> phones
```

Example:

```text
hammer
nails
roofing
```

with:

```text
hammer --USED_FOR--> roofing
nails --USED_FOR--> roofing
```

The GPC Resolver maps object identities, not contextual relationships, unless a separate downstream taxonomy contract explicitly requires relationship classification.

---

# 20. Mapping States

Every object must end in exactly one primary mapping state:

```text
MAPPED
AMBIGUOUS
INSUFFICIENT
CONFLICTING
NOT_APPLICABLE
```

## MAPPED

One candidate is clearly superior.

## AMBIGUOUS

Two or more materially different GPC targets remain defensible and available evidence cannot resolve the difference.

## INSUFFICIENT

The concept appears classifiable, but required information is missing.

## CONFLICTING

Evidence or trusted inputs materially disagree.

## NOT_APPLICABLE

The object is not appropriately representable by the available GPC classification contract.

---

# 21. "Only the Best Decision Wins"

The Resolver must rank candidates internally.

The external response should contain:

```text
primaryMapping
```

and diagnostic alternatives only when useful.

Do not produce:

```text
Candidate A 0.81
Candidate B 0.80
Candidate C 0.79
```

as though all are equally valid.

Instead:

```text
winner → Candidate A
state → MAPPED
confidence → 0.91
```

If the difference is not decisive because the evidence is materially ambiguous:

```text
state → AMBIGUOUS
primary candidate → A
competing candidate → B
reason → distinguishing evidence unavailable
```

Alternatives exist to explain uncertainty, not to avoid making decisions.

---

# 22. GPC Confidence

GPC confidence is a distinct dimension from:

```text
CSRE semantic confidence
CSRE commercial relevance confidence
vendor capability belief
```

Do not lower semantic confidence because the GPC taxonomy is difficult.

Do not treat a high CSRE confidence as proof of a high GPC confidence.

The confidence question is:

> How strongly does the available evidence support this exact GPC mapping?

---

# 23. Evidence Interaction

The GPC Resolver can consume:

- evidence records
- persistent market knowledge
- validated local terminology mappings
- current source findings
- Enrichment-derived facts with lineage
- previous validated concept-to-GPC mappings

The Evidence System remains the authority for accumulated belief and graph-state decisions.

The GPC Resolver does not rewrite evidence.

---

# 24. When GPC Resolver Uses WRS

WRS is conditional.

Do not invoke WRS merely because the concept is uncommon.

Use WRS when external evidence may materially improve:

- obscure concept identification
- local commercial usage
- definition discrimination
- product/function distinction
- material/mechanism distinction
- candidate disambiguation
- hierarchy-sensitive mapping
- current technical meaning

The request to WRS must state the exact evidence gap.

---

# 25. Knowledge and Evidence Safety

Never allow market knowledge to become self-proving.

Bad:

```text
MarketConcept → GPC
known mapping → new evidence
new evidence → confirms same mapping
mapping → stronger
```

A learned mapping may guide candidate retrieval, but it must not count as independent direct evidence of itself.

Knowledge must preserve lineage.

Evidence must preserve provenance.

Historical observations remain immutable.

---

# 26. Evidence Fusion for Graph State

The Evidence System retains the architecture:

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

The graph therefore separates:

- what happened
- what was inferred
- how confident the system currently is
- what graph relationship should be active

---

# 27. Priors vs Evidence

Graph-derived priors are hypotheses.

Example:

```text
Known vendor capability:
electrical switches

Sibling candidates:
wall sockets = 0.500
plugs = 0.500
electrical fittings = 0.500
```

These are not direct vendor evidence.

Later:

```text
Vendor:
"Yes, I sell wall sockets."
```

can raise:

```text
wall sockets = 0.910
```

A later negative response can reduce a belief.

A later positive fulfillment can restore it.

---

# 28. Evidence Score Model

Capability/relevance beliefs use:

```text
0.000 → 1.000
```

Interpretation:

```text
0.000       no meaningful support
0.001–0.199 very weak
0.200–0.399 weak/exploratory
0.400–0.599 plausible
0.600–0.799 meaningfully supported
0.800–0.949 strong
0.950–0.999 near-certain
1.000       operationally certain
```

`1.000` must be rare and policy-controlled.

A single free-text claim normally must not create `1.000`.

All scores are clamped:

```text
0.000 ≤ score ≤ 1.000
```

---

# 29. Evidence Update Model

Keep the mathematical implementation configurable.

Conceptually:

```text
newBelief
=
previousBelief
+
weightedPositiveEvidence
-
weightedNegativeEvidence
-
timeDecay
```

Prevent:

- scores above 1.000
- scores below 0.000
- one observation permanently dominating
- duplicate observations being counted as independent
- graph priors becoming direct evidence

---

# 30. Evidence Polarity

Supported:

```text
POSITIVE
NEGATIVE
NEUTRAL
CONTRADICTORY
```

Example:

```text
"Yes, I stock hammer drills." → POSITIVE

"No, I don't stock hammer drills." → NEGATIVE

"I sell construction tools." → NEUTRAL / weak contextual support

Earlier: "I sell hammer drills."
Later: "I don't stock them anymore."
→ CONTRADICTORY HISTORY
```

Both observations remain in the evidence history.

Current belief incorporates reliability and recency.

---

# 31. Evidence Independence

Three copies of the same WhatsApp message do not count as three independent observations.

Independence may arise from:

- separate interactions
- different timestamps
- different workflows
- inventory + customer response
- vendor confirmation + successful fulfillment
- independent sources

---

# 32. Evidence Scope

Evidence must explicitly state its subject.

Examples:

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

Buyer demand:

```text
"hammer drill"
```

does not prove:

```text
VendorCapability("hammer drill")
```

Vendor confirmation proves that vendor's capability only.

---

# 33. Multi-Object Evidence

For:

```text
"I need a hammer, nails and electrical materials for roofing."
```

maintain separate evidence targets:

```text
object_1 → hammer
object_2 → nails
object_3 → electrical materials
```

Shared context:

```text
roofing
```

If a vendor says:

```text
"I have hammer and nails but no electrical materials."
```

store:

```text
vendor → hammer → POSITIVE
vendor → nails → POSITIVE
vendor → electrical materials → NEGATIVE
```

---

# 34. Immutable Evidence Lifecycle

Evidence records are append-only.

```text
Observation A → Evidence A
Observation B → Evidence B
Observation C → Evidence C

Evidence A+B+C
        ↓
   Evidence Fusion
        ↓
  Current Belief
```

Never overwrite the original observation to "update" truth.

---

# 35. Temporal Decay

Evidence may decay by evidence type.

Fast decay:

- current inventory
- temporary availability
- temporary services

Slower decay:

- vendor category capability
- long-term commercial specialization

Low/no decay:

- durable semantic knowledge
- stable definitions
- validated local terminology, subject to contradiction

Graph structural relationships use their own policy.

---

# 36. Graph Relevance Decisions

The Evidence System may return:

```text
EXPAND
REINFORCE
MAINTAIN
DECAY
PRUNE
NO_CHANGE
INVESTIGATE
```

Meaning:

- `EXPAND`: create relevant graph relationship
- `REINFORCE`: increase belief in existing relationship
- `MAINTAIN`: keep current graph state
- `DECAY`: reduce belief due to stale/weakening evidence
- `PRUNE`: deactivate unsupported active relationship
- `NO_CHANGE`: evidence is not materially relevant
- `INVESTIGATE`: more evidence is needed

Historical evidence is never deleted as a consequence of pruning.

---

# 37. Buyer Demand Creates Market Coverage

A buyer search can expand semantic coverage.

Example:

```text
buyer searches "dumbbells"
      ↓
CSRE resolves MarketConcept
      ↓
GPC Resolver maps concept
      ↓
MarketConcept is attached to GPC cluster
      ↓
market vocabulary expands
```

This means:

> **A buyer search permanently expands the marketplace's semantic coverage.**

However:

> **Relevant vendors inherit candidate discoverability, not fabricated inventory.**

A new vendor connected to a category cluster is not automatically proven to stock every historical concept in that cluster.

---

# 38. Cluster Inheritance Rule

A vendor with confirmed capability in one GPC class may receive graph-derived candidate relationships to closely related classes.

These inherited edges must remain distinguishable from direct evidence.

Example:

```text
Vendor
  → GPC Class X
      status = CONFIRMED

Sibling A
  status = CLUSTER_INHERITED
  prior = 0.500

Sibling B
  status = CLUSTER_INHERITED
  prior = 0.500
```

The inheritance is a hypothesis.

Direct vendor evidence must be able to reinforce or contradict it.

---

# 39. 3-Tier Discovery Compatibility

The graph may support:

```text
Tier 1:
Direct confirmed capability in target GPC class

Tier 2:
Closely related/family candidate capability, clearly marked as inherited/belief

Tier 3:
Broader industry fallback only when direct/family supply is absent
```

The fallback must never be represented as an exact match.

Operational vendor ranking remains the Matching & Fanout module's responsibility.

---

# 40. Phrase/Concept Auditability

Every buyer request should be traceable:

```text
raw phrase
   ↓
MarketConcept
   ↓
GPC mapping
   ↓
market demand / vendor discovery
```

Example:

```text
(:Phrase {text: "iron sponge"})
  -[:EXPRESSES]->
(:MarketConcept {preferredLabel: "steel wool"})
  -[:MAPPED_TO_GPC]->
(:GpcClass)
```

This is required for:

- debugging
- learning
- explainability
- graph visualization
- analytics
- future model improvement

---

# 41. Organic Concept Cluster Growth

When multiple real-world phrases resolve to the same concept or GPC class:

```text
"rice"
"long grain"
"foreign rice"
"Ofada rice"
"parboiled rice"
```

the cluster accumulates market vocabulary around the sovereign anchor.

Do not create a competing taxonomy merely because the market uses more expressive vocabulary.

The evolving layer is a semantic/commercial knowledge layer, not a replacement for GPC.

---

# 42. Market Knowledge Store

Persistent knowledge examples:

```text
"okrika" → second-hand clothing
"bend down select" → second-hand clothing
"iron sponge" → steel wool/scouring pad
"hot flask" → vacuum flask
```

Knowledge must retain:

```text
knowledgeId
assertion
scope
supportedByEvidenceIds
createdAt
updatedAt
status
confidence
```

Knowledge may improve:

- CSRE
- Enrichment
- WRS query generation
- clarification generation
- commercial interpretation
- GPC enrichment
- evidence interpretation

---

# 43. Knowledge States

Derived insight may be:

```text
TEMPORARY
PERSISTENT
EXPERIMENTAL
CONFIRMED
```

Only validated persistent insight should normally become durable market knowledge.

Knowledge can later be challenged and revised.

---

# 44. Contradiction Management

When credible evidence conflicts:

1. preserve both observations
2. identify source/reliability
3. check geography
4. check time
5. check product variant
6. check entity identity
7. determine whether the conflict is genuine
8. reduce or partition belief where necessary
9. do not erase inconvenient evidence

The system should prefer the strongest supported interpretation when the evidence clearly favors one.

---

# 45. GPC Resolver Input Contract

```json
{
  "request_id": "string",
  "resolver_version": "string",

  "objects": [
    {
      "object_id": "object_1",

      "semantic_origin": {
        "phrase": "original CSRE phrase",
        "concept": "CSRE-resolved Market Concept",
        "market_concept_id": "mc_123|null",
        "concept_status": "KNOWN|PROPOSED",
        "relationship": "EXPRESSES",
        "origin": "CSRE",
        "request_id": "string",
        "semantic_confidence": 0.0
      },

      "surface_form": "string",
      "canonical_form": "string",
      "entity_type": "PRODUCT",
      "definition": "string",
      "brand": "string|null",
      "model": "string|null",
      "variant": "string|null",
      "attributes": {},
      "aliases": [],
      "commercial_interpretation": {},
      "semantic_confidence": 0.0,
      "commercial_confidence": 0.0,
      "relationships": []
    }
  ],

  "message_context": {},
  "enrichment": {},
  "market_knowledge": [],
  "evidence": [],
  "gpc_candidates": [],
  "resolution_policy": {}
}
```

### Input identity invariant

The GPC Resolver MUST treat:

```text
semantic_origin.concept
```

and:

```text
semantic_origin.market_concept_id
```

as the established semantic identity coming from CSRE.

It may validate the taxonomy compatibility of that identity.

It must not create or replace the underlying concept.

---

# 46. GPC Candidate Contract

```json
{
  "gpc_code": "string",
  "level": "SEGMENT|FAMILY|CLASS|BRICK",
  "title": "string",
  "definition": "string|null",
  "segment": {},
  "family": {},
  "class": {},
  "brick": {},
  "retrieval_sources": [
    "VECTOR",
    "LEXICAL",
    "ALIAS",
    "KNOWLEDGE",
    "EXACT"
  ],
  "retrieval_score": 0.0
}
```

`retrieval_score` is not the final mapping confidence.

---

# 47. GPC Resolver Output Contract

```json
{
  "request_id": "string",
  "resolver_version": "string",
  "status": "SUCCESS|PARTIAL|ERROR",

  "objects": [
    {
      "object_id": "object_1",

      "semantic_origin": {
        "phrase": "string",
        "concept": "string",
        "market_concept_id": "string|null",
        "relationship": "EXPRESSES",
        "origin": "CSRE"
      },

      "mapping": {
        "state": "MAPPED",
        "gpc_code": "string",
        "gpc_level": "CLASS",
        "gpc_title": "string",
        "mapping_confidence": 0.000,
        "reason_codes": [],
        "evidence_ids": [],
        "gpc_version": "string",
        "resolver_version": "string"
      },

      "alternatives": [],
      "diagnostics": {}
    }
  ],

  "message_level": {
    "relationships": [],
    "shared_context": []
  }
}
```

The Resolver's primary output is therefore:

```text
CSRE MarketConcept
        ↓
best existing GPC representation
```

It does not mutate the Phrase → Concept semantic relationship.

---

# 48. Reason Codes

Recommended diagnostic reason codes:

```text
STRONG_DEFINITION_MATCH
STRONG_FUNCTION_MATCH
ATTRIBUTE_MATCH
ENTITY_TYPE_MATCH
HIERARCHY_MATCH
SPECIFICITY_MATCH
MARKET_KNOWLEDGE_SUPPORT
EVIDENCE_SUPPORT
VECTOR_SUPPORT
LEXICAL_SUPPORT

DEFINITION_MISMATCH
FUNCTION_MISMATCH
ATTRIBUTE_CONFLICT
ENTITY_TYPE_MISMATCH
SPECIFICITY_CONFLICT
CONTRADICTORY_EVIDENCE
INSUFFICIENT_EVIDENCE
MULTIPLE_GPC_CANDIDATES
NOT_GPC_APPLICABLE
```

---

# 49. Master GPC Resolver Prompt

```text
SYSTEM ROLE: SOVEREIGN GPC SEMANTIC RESOLUTION ENGINE

You are the GPC Resolver.

Your input is a set of already-resolved commercial objects produced by CSRE
and enriched for downstream taxonomy retrieval.

Each object may include an explicit CSRE semantic-origin record:

Phrase
  → EXPRESSES
  → MarketConcept

This MarketConcept is the semantic identity you must classify against GPC.
Never reinterpret the phrase by starting from a GPC candidate.

Your responsibility is to map each object to the best existing representation
in the sovereign GS1 GPC taxonomy.

You are NOT:

- the semantic resolver
- the multi-entity extractor
- the intent resolver
- the enrichment engine
- the web retrieval system
- the evidence persistence system
- the vendor matcher
- the vendor ranker
- the taxonomy editor

==================================================
PRIMARY OBJECTIVE
==================================================

For every independently resolved object:

1. Preserve its established identity.
2. Retrieve and evaluate candidate GPC representations.
3. Compare candidates using semantic and taxonomy evidence.
4. Select the single strongest defensible GPC mapping.
5. Map at the deepest defensible level.
6. Preserve real ambiguity when the evidence cannot distinguish candidates.
7. Never fabricate GPC IDs or hierarchy.
8. Never alter the resolved meaning just to improve taxonomy similarity.

==================================================
SOVEREIGN TAXONOMY
==================================================

GS1 GPC is authoritative and immutable.

Use only existing taxonomy nodes supplied by the GPC data source.

Never create:

- invented categories
- generic holding buckets
- arbitrary macro-families
- fake class codes
- unsupported hierarchy relationships


==================================================
CSRE SEMANTIC ORIGIN
==================================================

For each object, preserve and use:

semantic_origin.phrase
semantic_origin.concept
semantic_origin.market_concept_id
semantic_origin.concept_status
semantic_origin.relationship = EXPRESSES
semantic_origin.origin = CSRE

The GPC Resolver maps the established MarketConcept to an existing GPC representation.

It does NOT create the MarketConcept.
It does NOT resolve the Phrase.
It does NOT replace the MarketConcept with a taxonomy label merely because that label is similar.

==================================================
OBJECT INDEPENDENCE
==================================================

Each object_id is an independent mapping target.

Never merge:

"hammer, nails and electrical materials"

into one taxonomy object.

Map each object separately.

Shared message context may inform mapping but is not automatically a GPC
object.

==================================================
CANDIDATE GENERATION
==================================================

Candidates may be supplied by:

- vector retrieval
- lexical retrieval
- aliases
- Enrichment terminology
- definitions
- functions
- attributes
- market knowledge
- explicit MarketConcept identity
- previously validated MarketConcept → GPC mappings
- GPC hierarchy constraints
- exact code/title matching

Vector similarity is candidate generation only.

Do not select the highest vector score without compatibility evaluation.

==================================================
CANDIDATE EVALUATION
==================================================

Evaluate:

- semantic fit
- definition fit
- functional fit
- attribute fit
- entity-type fit
- hierarchy fit
- specificity fit
- market knowledge support
- evidence support
- contradiction penalty

A taxonomy candidate is valid only when it is compatible with the actual
resolved referent.

==================================================
HIERARCHY RULE
==================================================

Hierarchy is a constraint, not proof of commercial equivalence.

Do not assume:

same Segment = same commercial product

same Family = same commercial product

same family = automatically interchangeable

==================================================
SPECIFICITY RULE
==================================================

Choose the deepest defensible existing GPC representation.

Correct broader classification is preferable to false precision.

Do not infer missing:

- brand
- model
- material
- size
- capacity
- power
- mechanism
- variant
- intended application

unless those facts are supported by the input or evidence.

==================================================
BRAND / MODEL
==================================================

Brand and model remain metadata on the resolved object.

Map the underlying product concept.

==================================================
NON-PRODUCT OBJECTS
==================================================

Do not force:

- services
- people
- organizations
- venues
- capabilities
- materials
- non-commercial concepts

into product GPC classes unless the actual object is properly represented by
the available taxonomy contract.

Return NOT_APPLICABLE when appropriate.

==================================================
EVIDENCE
==================================================

Evidence may support a mapping, weaken it, or contradict it.

Distinguish:

- direct evidence
- cross-source findings
- model-derived interpretation
- unresolved uncertainty

Do not allow Market Knowledge to become self-proving independent evidence.

==================================================
ONLY THE BEST DECISION
==================================================

If one candidate is clearly superior:

return it as the winner.

Do not expose a flat list of equal alternatives.

If no winner is defensible because materially different candidates remain
plausible:

return AMBIGUOUS and preserve the competing candidates diagnostically.

==================================================
FAILURE
==================================================

If evidence is insufficient:

return INSUFFICIENT.

If credible evidence directly conflicts:

return CONFLICTING.

If the object is outside the GPC contract:

return NOT_APPLICABLE.

Never fabricate certainty.

==================================================
FINAL RULE
==================================================

Do not answer:

"Which GPC node has the closest words?"

Answer:

"Which existing GPC representation most faithfully classifies the exact
real-world concept already established by CSRE, using Enrichment, Evidence,
and taxonomy structure without introducing unsupported meaning?"
```

---

# 50. Runtime GPC Resolution Prompt

```text
TASK: RESOLVE GPC MAPPING

CSRE OBJECTS:
{{csre_objects}}

ENRICHMENT:
{{enrichment}}

MARKET KNOWLEDGE:
{{market_knowledge}}

AVAILABLE EVIDENCE:
{{evidence}}

GPC CANDIDATES:
{{gpc_candidates}}

GPC HIERARCHY:
{{gpc_hierarchy}}

MESSAGE CONTEXT:
{{message_context}}

For each object_id:

1. inspect the established referent
2. inspect specificity and entity type
3. compare available candidates
4. evaluate definition/function/attribute compatibility
5. apply hierarchy constraints
6. penalize contradictions
7. choose one winner when the evidence clearly supports one
8. otherwise return the correct non-MAPPED state
9. preserve candidate diagnostics without presenting them as equal winners

Return JSON only.
```

---

# 51. Candidate Ranking Prompt

```text
TASK: RANK GPC CANDIDATES

RESOLVED OBJECT:
{{object}}

CANDIDATES:
{{candidates}}

EVIDENCE:
{{evidence}}

ENRICHMENT:
{{enrichment}}

For each candidate assess:

semantic_fit
definition_fit
functional_fit
attribute_fit
entity_type_fit
hierarchy_fit
specificity_fit
market_knowledge_support
evidence_support
contradiction_penalty

Then select the strongest defensible candidate.

Do not use vector similarity as the final decision.

Do not reward specificity that is unsupported.

Return:

winner
winner_state
winner_confidence
reason_codes
rejected_or_weakened_candidates
unresolved_conflicts
```

---

# 52. Ambiguity Review Prompt

```text
TASK: REVIEW GPC AMBIGUITY

OBJECT:
{{object}}

TOP_CANDIDATES:
{{candidates}}

EVIDENCE:
{{evidence}}

Determine whether one candidate is materially better.

If one clearly wins:
return MAPPED with one primary winner.

If the evidence does not distinguish materially different targets:
return AMBIGUOUS.

Do not manufacture a tie.
Do not manufacture certainty.
```

---

# 53. Graph Learning Interface

The GPC Resolver emits mapping facts.

The Evidence System decides whether these mappings should create or update
long-term graph beliefs.

Example:

```text
CSRE:
"wall socket"
      ↓
MarketConcept:
wall socket
      ↓
GPC Resolver:
GPC Class X
      ↓
Evidence:
mapping event + provenance
      ↓
Evidence Fusion:
belief / relevance
      ↓
Graph Decision:
REINFORCE
```

---


### Mapping priors are not vendor capability truth

A GPC mapping can provide a taxonomy anchor and can participate in downstream prior propagation,
but the Resolver MUST NOT directly convert a GPC mapping into confirmed vendor capability.

Vendor priors remain functions of:

```text
relationship_type
graph_distance
source_belief
context
evidence
```

and are owned by the Evidence/Graph learning layer.

---

# 54. Graph Mutation Boundary

The system must separate:

```text
Decision
```

from:

```text
Mutation
```

Preferred flow:

```text
Evidence
  ↓
Evidence Fusion
  ↓
Graph Relevance Decision
  ↓
Graph Writer
```

The Graph Writer applies only authorized state changes.

This prevents prompt/model output from directly mutating the authoritative graph.

---

# 55. Graph Decision Examples

## 55.1 EXPAND

A buyer introduces:

```text
"hot flask"
```

CSRE resolves:

```text
vacuum flask
```

GPC Resolver maps it to GPC X.

Evidence System sees a previously unrepresented valid commercial concept.

Decision:

```text
EXPAND
```

## 55.2 REINFORCE

Many independent buyers use:

```text
"hot flask"
```

with consistent resolution to the same concept.

Decision:

```text
REINFORCE MarketConcept → GPC mapping
```

## 55.3 DECAY

Vendor stock evidence becomes stale.

Decision:

```text
DECAY Vendor → GPC belief
```

## 55.4 PRUNE

Repeated reliable negative evidence reduces a weak relationship.

Decision:

```text
PRUNE_ACTIVE_RELATIONSHIP
```

Historical evidence remains.

## 55.5 INVESTIGATE

Two credible local meanings remain.

Decision:

```text
INVESTIGATE
```

Trigger targeted evidence retrieval or a clarification workflow.

---

# 56. Vendor Capability Belief

Operational capability is modeled as:

```text
Actor
  ↓
Target MarketConcept / GPC
  ↓
beliefScore
  ↓
supporting evidence
```

The belief score reflects accumulated evidence, not one statement.

Examples:

```text
Vendor says "I sell hammers"
→ direct positive evidence

Buyer successfully buys hammer from vendor
→ independent positive evidence

Vendor repeatedly rejects hammer requests
→ negative evidence

Inventory expires
→ decay
```

---

# 57. Buyer Demand Is Not Vendor Capability

Strict invariant:

```text
Buyer requested X
≠
Vendor has X
```

Likewise:

```text
Vendor has X
≠
all vendors in same graph family have X
```

The graph may propagate candidate priors, but direct capability must retain its own evidence.

---

# 58. Vendor Inheritance Safety

A vendor newly confirmed in a category may inherit discoverability toward related market concepts.

This is:

```text
candidate discoverability
```

not:

```text
confirmed inventory
```

Before operational vendor ranking, Matching & Fanout must account for:

- direct confirmation
- evidence-backed belief
- inherited status
- location
- recency
- availability
- any commercial constraints

---

# 59. End-to-End Buyer Flow

```text
BUYER MESSAGE
      ↓
CSRE / CMEE
      ↓
objects + contexts + relationships
      ↓
Enrichment
      ↓
semantic/taxonomy retrieval representations
      ↓
GPC Resolver
      ↓
best GPC mapping per object
      ↓
Evidence System
      ↓
market learning / graph relevance
      ↓
Matching & Fanout
      ↓
vendor matching + ranking
      ↓
Conversation OS
      ↓
buyer response
```

WRS may be invoked by CSRE, Enrichment, GPC Resolver, or Evidence workflows
only when the specific evidence gap warrants it.

---

# 60. End-to-End Vendor Onboarding Flow

```text
VENDOR MESSAGE
      ↓
CSRE / CMEE
      ↓
objects/capabilities/services
      ↓
Enrichment
      ↓
GPC Resolver
      ↓
candidate GPC classes
      ↓
Vendor confirmation / additional evidence when required
      ↓
Evidence System
      ↓
belief + graph decision
      ↓
Graph Writer
      ↓
vendor capability graph
      ↓
Matching & Fanout becomes able to match future demand
```

A vendor confirmation workflow should never be skipped merely because vector
similarity is high when the distinction materially matters.

---

# 61. Adaptive Invocation Policy

## Fast path

Use when:

- CSRE confidence is high
- Enrichment is straightforward
- GPC candidate dominance is strong
- no material contradiction exists

Typical result:

```text
CSRE → Enrichment → GPC Resolver
```

## Evidence path

Invoke WRS when:

- local terminology matters
- product distinctions are obscure
- candidate separation materially depends on external facts
- evidence quality can change the winner

## Clarification path

Use Conversation OS when the semantic referent itself remains materially ambiguous.

The resolver may request one high-information clarification.

## Composite path

Process each object independently while preserving shared context and
relationships.

---

# 62. Observability Requirements

Every resolution event should be traceable through:

```text
request_id
interaction_id
object_id
csre_version
enrichment_version
gpc_resolver_version
gpc_dataset_version
candidate_source
mapping_state
mapping_confidence
reason_codes
evidence_ids
market_knowledge_ids
created_at
```

This makes model decisions auditable and reproducible against a specific GPC version.

---

# 63. Versioning

Version independently:

```text
CSRE prompt/version
Enrichment prompt/version
WRS contract/version
Evidence schema/version
Market Concept Scheme version
GPC dataset version
GPC Resolver version
Graph schema version
Embedding model/version
```

A mapping should record the GPC dataset version used.

---

# 64. Testing Requirements

## Test 1 — Specific product

Input:

```text
"wall socket"
```

Expected:

```text
one object
strong product concept
best defensible GPC mapping
```

## Test 2 — Local informal term

Input:

```text
"iron sponge"
```

Expected:

```text
CSRE resolves local meaning
Enrichment improves terminology
GPC Resolver maps resolved concept
```

## Test 3 — Multiple objects

Input:

```text
"hammer, nails and electrical materials"
```

Expected:

```text
three object mappings
independent confidence/state
```

## Test 4 — Product + category

Input:

```text
"building materials, wall sockets and conduit pipes"
```

Expected:

```text
category object + product objects
```

Do not flatten to one level.

## Test 5 — Shared context

Input:

```text
"hammer and nails for roofing"
```

Expected:

```text
hammer
nails
roofing = context
```

## Test 6 — Venue

Input:

```text
"from a hardware store"
```

Expected:

```text
venue/context
not a product
```

## Test 7 — Service relationship

Input:

```text
"I sell phones and repair them."
```

Expected:

```text
phones = product/category
repair = service/capability
repair applies_to phones
```

## Test 8 — Brand/model

Input:

```text
"Bosch GWS 750"
```

Expected:

```text
canonical product = angle grinder
brand = Bosch
model = GWS 750
```

## Test 9 — False precision

Input:

```text
"grinder"
```

Expected:

```text
do not invent electric/angle/size/power unless supported
```

## Test 10 — Same-family trap

Candidate A and B are siblings in one GPC family.

Expected:

```text
do not select A merely because the user mapped to the same family
```

## Test 11 — Vector trap

Candidate A has slightly higher vector similarity but poorer definition/function
fit.

Expected:

```text
choose the semantically correct candidate
```

## Test 12 — Non-commercial referent

Input:

```text
"Where Is God When It Hurts?"
```

When used as a book title, the referent can be commercially relevant.

When used as a philosophical question, do not invent a commercial product.

## Test 13 — Ambiguous local term

Input:

```text
unfamiliar local expression
```

Expected:

```text
use context/knowledge/WRS when useful
otherwise preserve ambiguity or insufficiency
```

## Test 14 — Knowledge feedback trap

A MarketConcept → GPC mapping is stored.

Expected:

```text
the stored mapping can aid candidate generation
but cannot count as independent proof of itself
```

## Test 15 — Negative capability

Vendor says:

```text
"I don't stock plugs."
```

Expected:

```text
negative evidence for that vendor/capability
```

## Test 16 — Recovery

Later independent fulfillment shows the vendor supplies plugs.

Expected:

```text
belief can recover upward
```

## Test 17 — Stale inventory

Expected:

```text
belief decays according to evidence-type policy
```

## Test 18 — Buyer-demand expansion

Search for a previously unseen valid concept.

Expected:

```text
market semantic coverage expands
vendor inventory is not fabricated
```

---

# 65. Operational Invariants

1. **CSRE decides meaning.**
2. **CMEE preserves object independence.**
3. **Enrichment adds semantic context without changing identity.**
4. **WRS supplies evidence, not hidden decisions.**
5. **GPC Resolver maps already-resolved meaning to existing sovereign GPC.**
6. **Evidence System owns accumulated belief and graph relevance.**
7. **Matching & Fanout owns vendor matching and ranking.**
8. **Buyer demand never becomes vendor capability by itself.**
9. **Graph-derived priors never masquerade as direct evidence.**
10. **Historical evidence is immutable.**
11. **Knowledge retains evidence lineage.**
12. **Contradictions remain visible.**
13. **Scores remain clamped to 0.000–1.000.**
14. **False precision is rejected.**
15. **Multi-object messages remain multi-object.**
16. **Shared context never becomes an unintended object.**
17. **Brand/model/attributes remain attached to their owner object.**
18. **Vector similarity never becomes the final semantic/taxonomic decision.**
19. **GPC hierarchy constrains taxonomy mapping but does not define commercial relationships.**
20. **The sovereign taxonomy is never silently modified by marketplace learning.**
21. **Only the strongest defensible mapping wins when evidence is decisive.**
22. **Ambiguity is preserved only when it is real and decision-relevant.**

---

# 66. Final Architecture

```text
                         ┌───────────────────┐
                         │   USER / VENDOR   │
                         └─────────┬─────────┘
                                   ↓
                         ┌───────────────────┐
                         │       CSRE        │
                         │ CMEE + Resolution │
                         └─────────┬─────────┘
                                   ↓
                         ┌───────────────────┐
                         │    ENRICHMENT     │
                         └─────────┬─────────┘
                                   ↓
                 ┌─────────────────┴─────────────────┐
                 ↓                                   ↓
        ┌─────────────────┐                 ┌─────────────────┐
        │   GPC RESOLVER  │                 │       WRS       │
        │ sovereign map   │←──── evidence ──│ external facts  │
        └────────┬────────┘                 └────────┬────────┘
                 ↓                                   ↓
          ┌───────────────────────────────────────────────┐
          │                 EVIDENCE SYSTEM               │
          │ observation → evidence → knowledge → belief  │
          │                  → graph decision            │
          └─────────────────────┬─────────────────────────┘
                                ↓
                      ┌─────────────────────┐
                      │ MARKET SEMANTIC     │
                      │ KNOWLEDGE GRAPH     │
                      └─────────┬───────────┘
                                ↓
                         ┌───────────────┐
                         │ Matching & Fanout │
                         │ match/rank    │
                         └───────┬───────┘
                                 ↓
                         ┌───────────────┐
                         │ ConversationOS │
                         └───────────────┘
```

---

# 67. Final Design Principle

The platform is not building another opaque taxonomy.

It is building:

> **a sovereign taxonomy-backed Market Commercial Semantic Graph that learns real-world language and commercial relationships from evidence without corrupting the sovereign classification authority.**

The winning architecture is therefore:

```text
REAL-WORLD LANGUAGE
      ↓
SEMANTIC REFERENT
      ↓
RICH SEMANTIC REPRESENTATION
      ↓
SOVEREIGN GPC MAPPING
      ↓
EVIDENCE-BACKED MARKET KNOWLEDGE
      ↓
BELIEF + GRAPH RELEVANCE
      ↓
CAPABILITY MATCHING
```

And the governing rule is:

> **Resolve reality first. Classify second. Learn from evidence third. Match vendors last.**


---

# 68. NORMATIVE ARCHITECTURE LOCK — MARKET KNOWLEDGE GRAPH MODEL

**Status:** Normative amendment to this TDR  
**Effective:** 2026-09-09  
**Rule:** The following decisions are authoritative wherever an earlier section of this document uses
different terminology or implies a different ownership boundary. Earlier requirements remain preserved
unless they directly conflict with these locked decisions.

## 68.1 The Core Separation

The marketplace is composed of distinct semantic and learning layers:

```text
RAW HUMAN EXPRESSION
        │
        ▼
      CSRE
        │
        │  creates / resolves
        ▼
  MARKET CONCEPT
        │
        │  candidate semantic representation
        ▼
 MARKET CONCEPT SCHEME
   (SKOS candidate model)
        │
        │  mapped by this Resolver
        ▼
    SOVEREIGN GPC
        │
        │  anchors taxonomy-aware discovery
        ▼
 MARKET KNOWLEDGE GRAPH
        ▲
        │
   Evidence validates
   and evolves relationships
        │
        ▼
REAL MARKET INTERACTIONS
```

The most important distinction is:

> **GPC is the classification backbone. It is not the marketplace's learned commercial ontology.**

The marketplace must continuously build and maintain a separate proprietary understanding of how commerce
actually behaves.

That proprietary understanding is the **Market Knowledge Graph (MKG)**.

---

# 69. GPC = SOVEREIGN CLASSIFICATION BACKBONE

GS1 GPC remains the authoritative external classification system.

The GPC Resolver may:

- ingest the official GPC dataset;
- index GPC Segment, Family, Class, Brick, and applicable attributes;
- retrieve taxonomy candidates;
- compare candidates;
- map a Market Concept to an existing GPC representation;
- retain the GPC dataset/version used for each mapping.

The GPC Resolver MUST NOT:

- create a proprietary replacement for GPC;
- mutate official GPC structure;
- invent GPC identifiers;
- create artificial GPC siblings because the marketplace needs them;
- reinterpret a concept solely to fit a GPC candidate;
- use marketplace relationships as permission to alter GPC;
- treat GPC hierarchy distance as proof of commercial equivalence.

The sovereign GPC topology is:

```text
Segment
   ↓
Family
   ↓
Class
   ↓
Brick
   ↓
Brick Attributes / Values
```

Where the installed GPC release exposes these levels.

GPC is therefore the **stable classification backbone** against which marketplace concepts can be aligned.

---

# 70. CSRE-ORIGINATED PHRASE + CONCEPT

The GPC Resolver does not originate semantic meaning.

That responsibility belongs to CSRE.

The authoritative semantic chain is:

```text
Phrase
   ↓
CSRE
   ↓
MarketConcept
   ↓
GPC Resolver
   ↓
GPC Mapping
```

The canonical relationship is:

```text
(:Phrase)-[:EXPRESSES]->(:MarketConcept)
```

or an equivalent custom RDF predicate in the RDF representation.

The important invariant is:

> **The Phrase → Concept relationship is originated by CSRE from the actual user expression and resolved referent.**

The GPC Resolver may consume that relationship and validate that the established Market Concept can be mapped to GPC, but it MUST NOT:

- invent the Phrase → Concept relationship;
- silently replace the CSRE concept;
- use the GPC candidate to reinterpret the user's phrase;
- create a concept merely because a GPC node looks similar.

### 70.1 Why this matters

This preserves the distinction between:

```text
"I sell iron sponge"
```

and:

```text
CSRE:
"iron sponge"
→ MarketConcept: steel wool / scouring pad
```

The GPC Resolver then operates on:

```text
MarketConcept: steel wool / scouring pad
```

not directly on the raw phrase.

This makes the system auditable:

```text
raw phrase
    ↓
CSRE semantic resolution
    ↓
MarketConcept
    ↓
GPC mapping
```

---

# 71. MARKET CONCEPT SCHEME

The evolving Market Concept layer is the platform's semantic vocabulary around the sovereign GPC.

The preferred representation is:

> **SKOS as the candidate representation for the evolving Market Concept Scheme.**

SKOS SHOULD be used for:

- concept identity;
- preferred labels;
- alternate labels;
- broader/narrower semantic organization where genuinely hierarchical;
- related conceptual associations;
- justified mappings between concept schemes.

Recommended conceptual representation:

```text
MarketConcept
   rdf:type skos:Concept
   skos:prefLabel
   skos:altLabel
   skos:definition
   skos:inScheme MarketConceptScheme
```

The Market Concept Scheme is not itself the GPC taxonomy.

It represents the marketplace's learned vocabulary and normalized commercial concepts.

Examples:

```text
"iron sponge"
"steel wool"
"wire sponge"
        │
        ▼
MarketConcept: Steel Wool / Scouring Pad
```

```text
"hot flask"
"thermal flask"
        │
        ▼
MarketConcept: Vacuum Flask
```

The Market Concept Scheme may evolve as the marketplace learns new language.

GPC remains unchanged by that learning.

---

# 72. RDF IS THE FOUNDATIONAL GRAPH REPRESENTATION

The production semantic graph should use:

> **RDF as the foundational graph representation.**

RDF provides the generic subject-predicate-object graph model.

SKOS is used as the semantic concept/taxonomy vocabulary on top of RDF.

Custom RDF vocabularies MUST be used for commercial relationships that are more expressive than generic semantic relations.

Use custom predicates for:

```text
commercial relationships
evidence
capability beliefs
demand
venues
inventory
market behavior
```

Example vocabulary families:

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

mkg:SERVES
mkg:LOCATED_IN

mkg:HAS_BELIEF
mkg:HAS_PRIOR

mkg:SUPPORTED_BY
mkg:CONTRADICTED_BY
mkg:OBSERVED_IN
```

Do NOT collapse commercially distinct relationships into:

```text
skos:related
```

merely for graph convenience.

For example:

```text
MarketConcept A
   mkg:SUBSTITUTE_FOR
MarketConcept B
```

is semantically different from:

```text
MarketConcept A
   skos:related
MarketConcept B
```

Direction, relationship type, provenance, temporal validity, and evidence must remain available.

---

# 73. MARKET KNOWLEDGE GRAPH

The platform's proprietary understanding of commerce is the:

> **Market Knowledge Graph (MKG).**

The MKG is not a replacement taxonomy.

It is the evidence-backed graph of:

```text
concepts
phrases
actors
venues
demand
inventory
capabilities
commercial relationships
market behavior
taxonomy mappings
observations
beliefs
```

A useful conceptual split is:

```text
SOVEREIGN TAXONOMY
    = What the official classification system says

MARKET CONCEPT SCHEME
    = What concepts and language the platform has learned

MARKET KNOWLEDGE GRAPH
    = How those concepts actually relate in observed commerce
```

The MKG therefore answers questions such as:

```text
What do buyers call this?

What does this phrase usually refer to?

Which concepts are commonly requested together?

Which concepts substitute for one another?

Which concepts are accessories/components of others?

Which vendors have evidence-backed capability relationships?

Which venues are associated with this market?

Which relationships are merely plausible priors?

Which relationships have been demonstrated repeatedly?
```

---

# 74. EVIDENCE IS WHAT EVOLVES THE MARKET GRAPH

The central market-learning principle is:

> **A market/commercial relationship driven by evidence has to be built and maintained as users interact with the system.**

The graph is therefore not a static manually authored ontology.

The continuous loop is:

```text
USER / VENDOR INTERACTION
        ↓
RAW OBSERVATION
        ↓
EVIDENCE
        ↓
EVIDENCE FUSION
        ↓
BELIEF
        ↓
GRAPH RELEVANCE DECISION
        ↓
EXPAND / REINFORCE / MAINTAIN / DECAY / PRUNE
        ↓
UPDATED MARKET KNOWLEDGE GRAPH
```

This applies to relationships such as:

```text
Phrase → Concept
Concept → UsedFor
Concept → SubstituteFor
Concept → AccessoryOf
Concept → CommonlySoldWith
Vendor → Supplies
Vendor → Serves
Buyer → Requested
Concept → MappedToGPC
```

The Evidence System remains authoritative for:

- observation storage;
- provenance;
- evidence strength;
- evidence independence;
- evidence fusion;
- current belief;
- graph relevance decisions;
- expansion;
- reinforcement;
- decay;
- pruning.

The GPC Resolver supplies high-quality taxonomy mapping facts but does not own long-term graph belief.

---

# 75. DISTANCE + RELATIONSHIP TYPE DETERMINE THE PRIOR

Graph-derived priors MUST NOT be uniform.

A prior is a hypothesis about relevance or capability plausibility before direct evidence is available.

The prior is determined by:

```text
prior
=
f(
    graph_distance,
    relationship_type,
    relationship_direction,
    specificity,
    structural_validity,
    contextual_compatibility
)
```

The two primary signals are:

> **distance + relationship type**

and neither may be ignored.

### 75.1 Distance

Examples:

```text
distance 0
→ exact same target / direct concept

distance 1
→ direct graph neighbor

distance 2
→ second-degree related node

distance 3+
→ progressively weaker hypothesis
```

The exact numeric decay function is configurable.

### 75.2 Relationship type

Different relationships imply different strengths.

Example conceptual ordering:

```text
EXACT_MATCH / DIRECT_MAPPING
        >
CLOSE_SPECIALIZATION
        >
ACCESSORY_OF
        >
COMPONENT_OF
        >
SUBSTITUTE_FOR
        >
COMMONLY_SOLD_WITH
        >
BROADER_CONTEXTUAL_RELATION
```

This is illustrative of the required principle, not a universal hard-coded numeric table.

The production implementation MUST have a versioned configuration defining prior strengths for each relationship type.

### 75.3 Distance and relationship interact

A relationship one hop away is not automatically stronger than a different relationship type.

For example:

```text
A --COMMONLY_SOLD_WITH--> B
```

may carry a weaker prior than:

```text
A --SUBSTITUTE_FOR--> C
```

even when the graph distance is the same.

Likewise:

```text
A --RELATED_TO--> B
```

at distance 2 must be weaker than a direct, evidence-backed relationship.

Therefore:

> **Graph distance determines decay; relationship type determines semantic strength. Both contribute to the prior.**

---

# 76. GPC RESOLVER ROLE IN PRIOR GENERATION

The GPC Resolver may provide taxonomy-structural signals such as:

```text
same Brick
same Class
same Family
same Segment
sibling Class
parent/child relation
cross-branch distance
```

But it MUST NOT convert those structural relationships directly into vendor capability truth.

For example:

```text
Vendor → confirmed → GPC Class A
```

does not mean:

```text
Vendor → confirmed → every sibling Class
```

Instead:

```text
Vendor → confirmed → Class A
Vendor → prior → Class B
Vendor → prior → Class C
```

where the priors depend on:

```text
GPC graph distance
relationship type
commercial relevance
historical evidence
context
```

The Evidence System then decides whether these hypotheses should be:

```text
REINFORCED
MAINTAINED
DECAYED
PRUNED
```

---

# 77. COLLABORATIVE CATEGORY CLUSTER ENRICHMENT — LOCKED MODEL

A buyer search may create new semantic market coverage.

The correct rule is:

> **A buyer search permanently expands the marketplace's semantic coverage, while relevant vendors inherit candidate discoverability rather than fabricated inventory.**

Example:

```text
Buyer searches:
"dumbbells"
        ↓
CSRE:
MarketConcept = dumbbells
        ↓
GPC Resolver:
best existing GPC mapping
        ↓
Market Knowledge Graph:
new/strengthened demand + concept relationship
        ↓
Evidence System:
records observed demand and graph relevance
        ↓
market cluster becomes richer
```

A vendor relevant to the resulting concept cluster may receive a candidate relationship:

```text
Vendor
   ↓
LIKELY_RELEVANT_TO / CANDIDATE_CAPABILITY
   ↓
MarketConcept / GPC target
```

but NOT:

```text
Vendor
   ↓
CONFIRMED_INVENTORY
   ↓
dumbbells
```

unless independent evidence establishes that inventory/capability.

This distinction is mandatory.

---

# 78. CATEGORY CLUSTERS ARE COLLABORATIVE, NOT STATIC

A category cluster should be allowed to grow from multiple evidence streams:

```text
buyer searches
buyer clarifications
vendor onboarding
vendor inventory
vendor responses
successful fulfillment
local terminology
WRS evidence
validated semantic relationships
historical interactions
```

The cluster is therefore a continuously evolving commercial representation.

However:

```text
cluster membership
≠
commercial equivalence
```

and:

```text
cluster relevance
≠
vendor confirmed stock
```

The cluster exists to improve discovery and knowledge, not to fabricate supply.

---

# 79. GPC MAPPING AS A GRAPH ANCHOR

The GPC Resolver's mapping result acts as a stable taxonomy anchor:

```text
MarketConcept
      │
      └──── mkg:MAPPED_TO_GPC ────> GPC
```

That anchor allows the platform to connect:

```text
local phrases
commercial concepts
buyer demand
vendor capabilities
category clusters
taxonomy structure
```

without modifying GPC.

The mapping relationship should carry at minimum:

```text
mappingState
mappingConfidence
gpcVersion
resolverVersion
mappedAt
```

and should be linked to the evidence/knowledge lineage supporting it where applicable.

---

# 80. MAPPING CONFIDENCE IS NOT MARKET BELIEF

Keep these dimensions independent:

```text
CSRE semanticConfidence
CSRE commercialConfidence
GPC mappingConfidence
vendor capability belief
relationship belief
demand strength
```

Example:

```text
CSRE semanticConfidence       = 0.990
GPC mappingConfidence         = 0.930
Vendor capability belief      = 0.412
Demand strength               = 0.817
```

A highly certain semantic interpretation does not imply:

```text
high vendor capability
```

and a strong vendor capability belief does not prove:

```text
the semantic interpretation itself
```

---

# 81. MULTI-OBJECT GRAPH LEARNING

For:

```text
"I need a hammer, nails and electrical materials for roofing."
```

CSRE produces:

```text
object_1 → hammer
object_2 → nails
object_3 → electrical materials

shared context:
roofing
```

GPC Resolver maps each independently.

The MKG may then learn:

```text
hammer → USED_FOR → roofing
nails → USED_FOR → roofing
electrical materials → USED_FOR → roofing
```

Only when supported by evidence.

It may also learn:

```text
hammer → COMMONLY_SOLD_WITH → nails
```

if repeated commercial evidence supports that relationship.

It must NOT infer:

```text
hammer → IS_A → nails
```

merely because they co-occurred.

Co-occurrence and semantic identity are distinct relationship types.

---

# 82. OBSERVATION → KNOWLEDGE → RELATIONSHIP

A production relationship should be traceable through:

```text
Observation
    ↓
Evidence
    ↓
Assertion
    ↓
Relationship
    ↓
Current Belief
```

Example:

```text
Observed:
"I usually sell sockets with plugs."

        ↓

Evidence:
vendor statement

        ↓

Assertion:
plugs commonly sold with sockets

        ↓

MKG:
plug mkg:COMMONLY_SOLD_WITH socket

        ↓

Belief:
0.782
```

A later contradictory observation should not delete history.

Instead:

```text
same relationship
↓
new evidence
↓
belief recalculation
```

---

# 83. GRAPH RELATIONSHIP RECORD CONTRACT

Every learned commercial relationship SHOULD retain:

```json
{
  "relationship_id": "rel-123",
  "subject_id": "concept-1",
  "predicate": "mkg:COMMONLY_SOLD_WITH",
  "object_id": "concept-2",
  "relationship_type": "COMMONLY_SOLD_WITH",
  "graph_distance": 1,
  "prior": 0.420,
  "belief_score": 0.782,
  "status": "ACTIVE",
  "evidence_ids": ["e-1", "e-7", "e-9"],
  "source_count": 3,
  "independent_observation_count": 2,
  "first_observed_at": "2026-09-01T10:00:00Z",
  "last_observed_at": "2026-09-09T10:30:00Z",
  "valid_from": "2026-09-01T10:00:00Z",
  "valid_until": null,
  "schema_version": "1.0"
}
```

The exact storage technology is implementation dependent.

The semantics are not.

---

# 84. EVIDENCE IS NOT REPLACED BY THE GRAPH

The graph is a current model.

The evidence history is the historical record.

Therefore:

```text
GRAPH
= current operational interpretation

EVIDENCE
= why the graph currently looks that way
```

Pruning a relationship means:

```text
deactivate the current relationship
```

not:

```text
erase the historical observations
```

This remains mandatory.

---

# 85. MARKET KNOWLEDGE MUST NOT BECOME SELF-PROVING

This invariant is especially important for taxonomy mappings and vendor relationships.

Invalid loop:

```text
stored mapping
   ↓
candidate generation
   ↓
same stored mapping
   ↓
"new evidence"
   ↓
higher confidence
```

Correct:

```text
stored knowledge
   ↓
candidate retrieval / hypothesis
   ↓
independent new observation
   ↓
evidence
   ↓
belief update
```

Historical knowledge can guide where the system looks.

It cannot manufacture independent proof.

---

# 86. TAXONOMY DISTANCE IS NOT COMMERCIAL DISTANCE

The graph may expose:

```text
same Segment
same Family
same Class
sibling Class
parent/child
```

but those are taxonomy relationships.

Commercial relationships must be separately represented:

```text
SUBSTITUTE_FOR
ACCESSORY_OF
COMPONENT_OF
COMMONLY_SOLD_WITH
USED_FOR
RELATED_TO
```

Never assume:

```text
same Segment → commercially related
same Family → commercially interchangeable
same Class → operationally identical
```

GPC hierarchy is a classification constraint.

The Market Knowledge Graph is the commercial relationship model.

---

# 87. GPC RESOLVER INPUT / OUTPUT CONTRACT — LOCKED

## Input

The Resolver receives:

```text
CSRE objects
Enrichment outputs
GPC candidate set
GPC hierarchy
GPC definitions/attributes
Market Concept identity
Market Knowledge context
Evidence references
GPC dataset version
optional WRS findings
```

## Output

For each `object_id`:

```json
{
  "object_id": "obj-1",
  "market_concept_id": "mc-123",
  "mapping_state": "MAPPED",
  "primary_mapping": {
    "level": "BRICK",
    "gpc_code": "string",
    "title": "string"
  },
  "mapping_confidence": 0.931,
  "reason_codes": [
    "STRONG_DEFINITION_MATCH",
    "FUNCTION_MATCH",
    "ATTRIBUTE_MATCH",
    "HIERARCHY_COMPATIBILITY",
    "SPECIFICITY_MATCH"
  ],
  "diagnostic_candidates": [],
  "evidence_ids": [],
  "gpc_version": "2026-05",
  "resolver_version": "4.1"
}
```

The response must make one primary decision when one is defensible.

---

# 88. ONLY THE BEST GPC DECISION WINS

The final taxonomy decision rule remains:

> **Only the strongest defensible decision wins.**

Do not return a flat ranked list as the primary answer.

Use:

```text
winner
state
confidence
reason
```

Alternatives are retained only diagnostically when they explain:

```text
ambiguity
insufficient evidence
conflict
near-neighbor rejection
```

The objective is not to avoid making a decision.

The objective is to make the **best defensible decision**.

---

# 89. PRODUCTION GRAPH WRITE BOUNDARY

The GPC Resolver should be treated as a **mapping fact producer**.

It may emit:

```text
MarketConcept → MAPPED_TO_GPC → GPC
```

The Graph/Evidence subsystem owns:

```text
relationship persistence
belief evolution
evidence linkage
cluster expansion
relationship reinforcement
relationship decay
relationship pruning
```

This keeps the Resolver deterministic and taxonomy-focused while allowing the marketplace graph to evolve from evidence.

---

# 90. FINAL LOCKED RESPONSIBILITY MAP

```text
CSRE
  ├─ CMEE
  ├─ Phrase extraction
  ├─ Phrase → MarketConcept
  ├─ semantic resolution
  ├─ commercial interpretation
  └─ canonical representation

ENRICHMENT
  ├─ semantic enrichment
  ├─ GPC-oriented vocabulary
  ├─ functional/use-case representation
  └─ candidate retrieval signals

WRS
  ├─ external retrieval
  ├─ source evaluation
  └─ evidence packaging

GPC RESOLVER
  ├─ sovereign GPC candidate retrieval
  ├─ taxonomy-aware comparison
  ├─ hierarchy/definition/function/attribute checks
  ├─ deepest defensible GPC mapping
  └─ mapping confidence/state

EVIDENCE SYSTEM
  ├─ observations
  ├─ evidence
  ├─ provenance
  ├─ knowledge
  ├─ belief scores
  ├─ distance + relationship-type priors
  ├─ graph expansion
  ├─ reinforcement
  ├─ decay
  └─ pruning

MARKET KNOWLEDGE GRAPH
  ├─ evolving concepts
  ├─ semantic relationships
  ├─ actor relationships
  ├─ demand
  ├─ inventory
  ├─ venues
  ├─ market behavior
  └─ evidence-backed commercial structure

Matching & Fanout
  ├─ capability matching
  ├─ vendor ranking
  ├─ fanning out
  └─ routing
```

---

# 91. FINAL ARCHITECTURAL PRINCIPLE

The marketplace should continuously learn from actual behavior:

```text
USER LANGUAGE
      ↓
CSRE
      ↓
MARKET CONCEPT
      ↓
GPC RESOLVER
      ↓
SOVEREIGN TAXONOMY ANCHOR
      ↓
EVIDENCE FROM REAL INTERACTIONS
      ↓
BELIEFS + RELATIONSHIPS
      ↓
MARKET KNOWLEDGE GRAPH
      ↓
BETTER FUTURE RESOLUTION / DISCOVERY / MATCHING
```

The final invariant is:

> **GPC tells the platform how products are classified.  
> CSRE tells the platform what people mean.  
> Evidence tells the platform what is actually happening.  
> The Market Knowledge Graph stores what the platform has learned about commerce.  
> The GPC Resolver connects those learned concepts to the sovereign classification backbone.**

This is the production architecture to implement.


---

# 92. Standards Reference

This TDR is aligned to the current GS1 GPC publication available at the time of this revision.
The GS1 repository currently identifies **GPC version 2026-05** as the current standard (last modified
26 May 2026). The GS1 model defines Segment, Family, Class, Brick, and Brick Attributes/Values, and
states that GPC hierarchy should be logical/coherent and describe what products are rather than sales
channels or intended-use context.

The graph representation decision is aligned with RDF as the foundational graph model and SKOS as the
candidate semantic concept-scheme vocabulary.

Official references:

- GS1 Standards Repository — GPC: https://ref.gs1.org/standards/gpc/
- GS1 GPC Schema Principles: https://support.gs1.org/support/solutions/articles/43000734220-what-are-the-gpc-schema-principles-
- GS1 GPC Hierarchy Principles: https://support.gs1.org/support/solutions/articles/43000733391-what-are-the-gpc-hierarchy-principles-
- W3C RDF Concepts: https://www.w3.org/TR/rdf-concepts/
- W3C SKOS Reference: https://www.w3.org/TR/skos-reference/


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

# 93. IMPLEMENTATION INTEGRATION CONTRACT — v4

This section is authoritative for GPC Resolver interoperability and supplements the existing
taxonomy, graph, evidence, cluster, and prompt requirements.

## 93.1 Canonical input contract

GPC Resolver v4 consumes the CSRE v5 object contract and Enrichment v4 output.

```json
{
  "schema_version": "4.0",
  "request_id": "string",
  "resolver_version": "4.1",
  "objects": [
    {
      "object_id": "object_1",
      "semantic_origin": {
        "phrase": "original CSRE phrase",
        "concept": "CSRE-resolved Market Concept",
        "market_concept_id": "mc_123|null",
        "concept_status": "KNOWN|PROPOSED",
        "relationship": "EXPRESSES",
        "origin": "CSRE",
        "request_id": "string",
        "semantic_confidence": 0.0
      },
      "surface_form": "string",
      "canonical_form": "string",
      "entity_type": "PRODUCT",
      "definition": "string",
      "brand": null,
      "model": null,
      "variant": null,
      "attributes": {},
      "aliases": [],
      "commercial_interpretation": {},
      "semantic_confidence": 0.0,
      "commercial_confidence": 0.0,
      "relationships": [],
      "enrichment": {}
    }
  ],
  "message_context": {},
  "market_knowledge": [],
  "evidence": [],
  "gpc_candidates": [],
  "resolution_policy": {}
}
```

## 93.2 Canonical output contract

The nested `mapping.state` contract is canonical. Earlier `mapping_state` examples are
treated as legacy notation and MUST NOT produce a second conflicting state in new implementations.

```json
{
  "schema_version": "4.0",
  "request_id": "string",
  "resolver_version": "4.1",
  "status": "SUCCESS|PARTIAL|ERROR",
  "objects": [
    {
      "object_id": "object_1",
      "semantic_origin": {
        "phrase": "string",
        "concept": "string",
        "market_concept_id": "string|null",
        "concept_status": "KNOWN|PROPOSED",
        "relationship": "EXPRESSES",
        "origin": "CSRE",
        "request_id": "string",
        "semantic_confidence": 0.0
      },
      "source_trace": {
        "csre_request_id": "string",
        "enrichment_request_id": "string|null",
        "wrs_evidence_ids": [],
        "evidence_system_ids": []
      },
      "mapping": {
        "state": "MAPPED|AMBIGUOUS|INSUFFICIENT|CONFLICTING|NOT_APPLICABLE",
        "gpc_code": "string|null",
        "gpc_level": "SEGMENT|FAMILY|CLASS|BRICK|null",
        "gpc_title": "string|null",
        "mapping_confidence": 0.000,
        "reason_codes": [],
        "evidence_ids": [],
        "gpc_version": "string",
        "resolver_version": "4.1"
      },
      "diagnostic_candidates": [],
      "diagnostics": {}
    }
  ],
  "message_level": {
    "relationships": [],
    "shared_context": []
  }
}
```

For `MAPPED`, `gpc_code`, `gpc_level`, and `gpc_title` are required.
For all non-MAPPED states they MUST be `null`.

## 93.3 JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/gpc-resolver-response-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "request_id",
    "resolver_version",
    "status",
    "objects",
    "message_level"
  ],
  "properties": {
    "schema_version": { "const": "4.0" },
    "request_id": { "type": "string" },
    "resolver_version": { "const": "4.1" },
    "status": { "enum": ["SUCCESS", "PARTIAL", "ERROR"] },
    "objects": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["object_id", "semantic_origin", "source_trace", "mapping", "diagnostic_candidates", "diagnostics"],
        "properties": {
          "object_id": { "type": "string" },
          "semantic_origin": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "phrase",
              "concept",
              "market_concept_id",
              "concept_status",
              "relationship",
              "origin",
              "request_id",
              "semantic_confidence"
            ],
            "properties": {
              "phrase": { "type": "string" },
              "concept": { "type": "string" },
              "market_concept_id": { "type": ["string", "null"] },
              "concept_status": { "enum": ["KNOWN", "PROPOSED"] },
              "relationship": { "const": "EXPRESSES" },
              "origin": { "const": "CSRE" },
              "request_id": { "type": "string" },
              "semantic_confidence": { "type": "number", "minimum": 0, "maximum": 1 }
            }
          },
          "source_trace": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "csre_request_id",
              "enrichment_request_id",
              "wrs_evidence_ids",
              "evidence_system_ids"
            ],
            "properties": {
              "csre_request_id": { "type": "string", "minLength": 1 },
              "enrichment_request_id": { "type": ["string", "null"] },
              "wrs_evidence_ids": { "type": "array", "items": { "type": "string" } },
              "evidence_system_ids": { "type": "array", "items": { "type": "string" } }
            }
          },
          "mapping": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "state",
              "gpc_code",
              "gpc_level",
              "gpc_title",
              "mapping_confidence",
              "reason_codes",
              "evidence_ids",
              "gpc_version",
              "resolver_version"
            ],
            "properties": {
              "state": {
                "enum": ["MAPPED", "AMBIGUOUS", "INSUFFICIENT", "CONFLICTING", "NOT_APPLICABLE"]
              },
              "gpc_code": { "type": ["string", "null"] },
              "gpc_level": {
                "enum": ["SEGMENT", "FAMILY", "CLASS", "BRICK", null]
              },
              "gpc_title": { "type": ["string", "null"] },
              "mapping_confidence": { "type": "number", "minimum": 0, "maximum": 1 },
              "reason_codes": { "type": "array", "items": { "type": "string" } },
              "evidence_ids": { "type": "array", "items": { "type": "string" } },
              "gpc_version": { "type": "string" },
              "resolver_version": { "const": "4.1" }
            },
            "allOf": [
              {
                "if": {
                  "properties": { "state": { "const": "MAPPED" } },
                  "required": ["state"]
                },
                "then": {
                  "properties": {
                    "gpc_code": { "type": "string", "minLength": 1 },
                    "gpc_level": { "enum": ["SEGMENT", "FAMILY", "CLASS", "BRICK"] },
                    "gpc_title": { "type": "string", "minLength": 1 }
                  }
                }
              },
              {
                "if": {
                  "properties": {
                    "state": {
                      "enum": ["AMBIGUOUS", "INSUFFICIENT", "CONFLICTING", "NOT_APPLICABLE"]
                    }
                  },
                  "required": ["state"]
                },
                "then": {
                  "properties": {
                    "gpc_code": { "type": "null" },
                    "gpc_level": { "type": "null" },
                    "gpc_title": { "type": "null" }
                  }
                }
              }
            ]
          },
          "diagnostic_candidates": { "type": "array" },
          "diagnostics": { "type": "object" }
        }
      }
    },
    "message_level": {
      "type": "object",
      "additionalProperties": false,
      "required": ["relationships", "shared_context"],
      "properties": {
        "relationships": { "type": "array" },
        "shared_context": { "type": "array" }
      }
    }
  }
}
```

## 93.4 Prompt/output binding

The Master GPC Resolver Prompt, Runtime GPC Resolution Prompt, Candidate Ranking Prompt,
and Ambiguity Review Prompt MUST use schemas rather than relying on:

```text
Return JSON only.
```

The runtime MUST validate each structured response against the schema and reject unsupported
GPC states, fabricated codes, and fields outside the contract.

## 93.5 GPC dataset version

`gpc_version` MUST identify the actual installed sovereign GPC dataset used for candidate retrieval.

A resolver result is not portable across GPC dataset versions without re-evaluation.

## 93.6 Cross-component traceability

For every mapped object the resolver MUST preserve:

```text
CSRE request_id
object_id
semantic_origin
Enrichment request/result correlation
WRS evidence IDs where used
Evidence System evidence IDs where supplied
GPC dataset version
resolver_version
```

This allows an auditable chain:

```text
user phrase
  ↓
CSRE object
  ↓
Enrichment
  ↓
WRS evidence (optional)
  ↓
GPC candidates
  ↓
GPC decision
  ↓
Evidence System mapping fact
  ↓
MKG belief/relationship
```

## 93.7 GPC Resolver clarification boundary

GPC Resolver may return `AMBIGUOUS` or `INSUFFICIENT`, but it MUST NOT directly ask the user a question.
LangGraph owns clarification orchestration.

If GPC ambiguity materially blocks the requested action, the resolver returns a machine-readable
diagnostic explaining what distinction is required. LangGraph decides whether and how to ask.

## 93.8 Evidence System boundary

A GPC mapping is evidence that a MarketConcept maps to a sovereign taxonomy node.
It is not direct evidence that any vendor supplies that concept.

Vendor capability belief remains an Evidence System / capability-projection concern and is governed by relationship type,
graph distance, source belief, context, and direct evidence.

---


# 93A. MACHINE-ENFORCEABLE INPUT SCHEMAS

## 93A.1 GPC Resolver request schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/gpc-resolver-request-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "request_id",
    "resolver_version",
    "objects",
    "message_context",
    "enrichment",
    "market_knowledge",
    "evidence",
    "gpc_candidates",
    "resolution_policy"
  ],
  "properties": {
    "schema_version": {"const": "4.0"},
    "request_id": {"type": "string"},
    "resolver_version": {"const": "4.1"},
    "objects": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true,
        "required": ["object_id", "semantic_origin", "source_trace"],
        "properties": {
          "object_id": { "type": "string", "minLength": 1 },
          "semantic_origin": { "type": "object" },
          "source_trace": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "csre_request_id",
              "enrichment_request_id",
              "wrs_evidence_ids",
              "evidence_system_ids"
            ],
            "properties": {
              "csre_request_id": { "type": "string", "minLength": 1 },
              "enrichment_request_id": { "type": ["string", "null"] },
              "wrs_evidence_ids": { "type": "array", "items": { "type": "string" } },
              "evidence_system_ids": { "type": "array", "items": { "type": "string" } }
            }
          }
        }
      }
    },
    "message_context": {"type": "object"},
    "enrichment": {"type": "object"},
    "market_knowledge": {"type": "array"},
    "evidence": {"type": "array"},
    "gpc_candidates": {"type": "array"},
    "resolution_policy": {"type": "object"}
  }
}
```

## 93A.2 GPC candidate schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/gpc-candidate-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "gpc_code",
    "level",
    "title",
    "definition",
    "segment",
    "family",
    "class",
    "brick",
    "retrieval_sources",
    "retrieval_score"
  ],
  "properties": {
    "gpc_code": {"type": "string"},
    "level": {"enum": ["SEGMENT", "FAMILY", "CLASS", "BRICK"]},
    "title": {"type": "string"},
    "definition": {"type": ["string", "null"]},
    "segment": {"type": "object"},
    "family": {"type": "object"},
    "class": {"type": "object"},
    "brick": {"type": "object"},
    "retrieval_sources": {"type": "array", "items": {"type": "string"}},
    "retrieval_score": {"type": "number", "minimum": 0, "maximum": 1}
  }
}
```

# 94. STRUCTURED PROMPT OUTPUT CONTRACTS

All GPC Resolver prompts that produce structured output MUST use versioned schemas.

## 94.1 Full resolution

Master GPC Resolver Prompt and Runtime GPC Resolution Prompt MUST return:

```text
gpc-resolver-response-v4.json
```

## 94.2 Candidate ranking schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/gpc-candidate-ranking-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "winner",
    "winner_state",
    "winner_confidence",
    "reason_codes",
    "rejected_or_weakened_candidates",
    "unresolved_conflicts"
  ],
  "properties": {
    "schema_version": {"const": "4.0"},
    "winner": {
      "type": ["object", "null"],
      "properties": {
        "gpc_code": {"type": "string"},
        "level": {"enum": ["SEGMENT", "FAMILY", "CLASS", "BRICK"]},
        "title": {"type": "string"}
      },
      "required": ["gpc_code", "level", "title"],
      "additionalProperties": false
    },
    "winner_state": {
      "enum": ["MAPPED", "AMBIGUOUS", "INSUFFICIENT", "CONFLICTING", "NOT_APPLICABLE"]
    },
    "winner_confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "reason_codes": {"type": "array", "items": {"type": "string"}},
    "rejected_or_weakened_candidates": {"type": "array"},
    "unresolved_conflicts": {"type": "array"}
  }
}
```

## 94.3 Ambiguity review schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/gpc-ambiguity-review-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "state",
    "primary_candidate",
    "confidence",
    "diagnostics"
  ],
  "properties": {
    "schema_version": {"const": "4.0"},
    "state": {
      "enum": ["MAPPED", "AMBIGUOUS", "INSUFFICIENT", "CONFLICTING", "NOT_APPLICABLE"]
    },
    "primary_candidate": {"type": ["object", "null"]},
    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "diagnostics": {"type": "object"}
  }
}
```

## 94.4 Prompt invariants

Every GPC prompt MUST:

```text
1. classify only against supplied existing GPC nodes;
2. preserve CSRE semantic_origin;
3. never invent a GPC identifier;
4. never convert taxonomy similarity into vendor capability evidence;
5. choose one primary mapping when defensible;
6. preserve competing candidates only diagnostically;
7. return schema-valid JSON.
```

---

## Cross-Stack Version Matrix

```text
CSRE v5.2
  ↓ semantic identity
Enrichment v4.2
  ↓ taxonomy-oriented semantic enrichment
WRS v4.2 (wire v4.0, optional evidence)
  ↓
GPC Resolver v4.2 (wire v4.0)
  ↓ mapping fact
Evidence System v4.2 (wire v4.0)
  ↓ graph belief / relevance
Matching & Fanout / matching
```

IDCE v1.4 does not participate in the semantic-to-GPC identity chain except through contextual
signals supplied by the orchestrator when relevant. It does not determine GPC mapping.


---

# 95. FINAL IMPLEMENTATION INTEGRATION CONTRACT — v4.2

This section is authoritative for the GPC Resolver v4.2 service boundary. The wire schema remains
`gpc-resolver-request-v4.json` / `gpc-resolver-response-v4.json` with `schema_version = 4.0`;
component/document version is 4.2.

## 95.1 Input provenance contract

Every GPC Resolver request MUST carry enough source information to reproduce the mapping:

```text
request_id
resolver_version = 4.1
CSRE request_id
CSRE object_id
semantic_origin
Enrichment request_id
Enrichment component version
WRS evidence IDs where used
Evidence System IDs where supplied
gpc_version
```

The canonical request object SHOULD carry:

```json
"source_trace": {
  "csre_request_id": "csre-001",
  "enrichment_request_id": "enrich-001",
  "wrs_evidence_ids": [],
  "evidence_system_ids": []
}
```

## 95.2 Explicit CSRE → GPC field mapping

The GPC Resolver MUST use:

```text
CSRE object.object_id                  → GPC object.object_id
CSRE object.semantic_origin            → GPC object.semantic_origin
CSRE object.surface_form               → GPC object.surface_form
CSRE object.canonical_form             → GPC object.canonical_form
CSRE object.entity_type                → GPC object.entity_type
CSRE object.brand/model/attributes     → corresponding GPC evidence
CSRE object.commercial_interpretation  → GPC commercial compatibility evidence

CSRE confidence.semantic_resolution    → GPC semantic_confidence
CSRE confidence.commercial_relevance  → GPC commercial_confidence
```

When Enrichment is present, its object with the same `object_id` augments—not replaces—the CSRE object.

## 95.3 Explicit Enrichment → GPC field mapping

For each `object_id`, GPC Resolver consumes:

```text
canonical_form
definition
functional_profile
use_cases
attributes
commercial_terminology
taxonomy_semantics
distinguishing_features
confusable_concepts
embedding_representations
evidence
```

No enrichment field may silently overwrite the CSRE-originated concept.

## 95.4 Source trace is machine-enforced

For every returned object, `source_trace.csre_request_id` MUST equal
`object.semantic_origin.request_id`.

`source_trace.enrichment_request_id` MUST equal the Enrichment request that supplied the object,
or null when no Enrichment call occurred.

WRS and Evidence System IDs are copied, not regenerated.

## 95.5 Result validity

For `mapping.state = MAPPED`:

```text
gpc_code != null
gpc_level != null
gpc_title != null
gpc_version != null
mapping_confidence in [0,1]
```

For all other states:

```text
gpc_code = null
gpc_level = null
gpc_title = null
```

The resolver MUST never manufacture a GPC code merely to avoid a non-MAPPED state.

## 95.6 Clarification remains external

The resolver returns machine-readable diagnostics. LangGraph/MCOS decides whether the ambiguity
is worth a user clarification and owns the actual question/delivery.

---

# 75. NORMATIVE AGENDA COMPLETION — v4.3

**Effective:** 2026-09-10  
**Status:** Authoritative amendment. The earlier Market Semantic Graph sections are preserved for historical design traceability, but the standalone **Market Knowledge Graph (MKG) TDR** is now the authoritative owner of graph representation, commercial relationship semantics, graph traversal, and graph state. This GPC TDR no longer owns those responsibilities.

## 75.1 Final GPC Resolver responsibility

The GPC Resolver answers exactly:

> **Where does this already-resolved MarketConcept belong in the sovereign GS1 GPC classification?**

It owns:
- sovereign GPC dataset access/versioning;
- candidate retrieval;
- taxonomy-aware comparison;
- hierarchy-aware reasoning;
- final GPC mapping;
- mapping confidence/state;
- object-by-object mapping for multi-object requests;
- diagnostic alternatives when ambiguity remains.

It does NOT own:
- commercial relationship truth;
- MKG persistence;
- vendor capability belief;
- graph evolution;
- evidence storage;
- vendor matching/ranking/fanout.

## 75.2 MKG handoff

After GPC mapping, the Resolver emits a mapping fact that can be consumed by Evidence and/or queried by MKG. The Resolver must never directly invent a commercial relationship merely because two concepts are nearby in GPC.

```text
CSRE MarketConcept
   ↓
Enrichment
   ↓
GPC Resolver
   ↓
GPC Mapping Fact
   ↓
Evidence
   ↓
GraphChangeDecision
   ↓
MKG
```

## 75.3 Sovereign taxonomy invariant

GPC remains immutable and externally governed. MKG may link to GPC nodes, but must never rewrite or replace the sovereign GPC hierarchy.

## 75.4 Legacy section interpretation

Earlier sections in this document that describe `GPC Resolver & Market Semantic Graph` must be interpreted as the **historical integrated design**. Where they conflict with Section 75, Section 75 and the standalone MKG TDR win.



# 76. NORMATIVE AGENDA COMPLETION — v4.4 FINAL CLASSIFICATION CONTRACT

**Effective:** 2026-09-12  
**Status:** Authoritative amendment.

## 76.1 Final component identity

```text
component               = GPC_RESOLVER
component_version       = 4.4
request schema_version  = 4.0
response schema_version = 4.0
```

Legacy examples containing `resolver_version = 4.1`/`4.2` are historical and are superseded by this final contract where they conflict.

## 76.2 Candidate retrieval ownership

The GPC Resolver owns candidate retrieval. Upstream components provide semantic retrieval material; they do not own the GPC candidate search service.

The final runtime boundary is:

```text
MarketConcept + Enrichment
        ↓
GpcCandidateRetrievalPort
        ├─ exact / lexical retrieval
        ├─ alias retrieval
        ├─ vector retrieval
        ├─ hierarchy-aware retrieval
        ├─ prior validated mappings
        └─ optional approved graph context
        ↓
GPC candidate set
        ↓
GPC taxonomy reasoning
        ↓
final mapping
```

`gpc_candidates` in the request is therefore OPTIONAL and is treated as an externally supplied candidate override/hint when present. The normal production path performs candidate retrieval inside the GPC Resolver.

## 76.3 Candidate provenance

Every candidate MUST preserve its retrieval source(s), installed GPC dataset version, retrieval score, and the request correlation that produced it.

Vector similarity is candidate generation only. It is never sufficient for final taxonomy truth.

## 76.4 GPC is not a commercial discovery gate

A valid CSRE `MarketConcept` MUST remain usable for semantic retrieval and Matching & Fanout even when GPC mapping is `AMBIGUOUS`, `INSUFFICIENT`, or unavailable, unless the active workflow explicitly requires GPC classification.

GPC classification can therefore be:

```text
synchronous when required
asynchronous when useful but non-blocking
```

## 76.5 MarketConcept preservation

The GPC Resolver MUST never replace a CSRE MarketConcept with a GPC node. `MAPPED_TO_GPC` is a classification relationship, not semantic identity.

## 76.6 Read-side knowledge context

The GPC Resolver MAY consume read-only MKG context such as prior validated MarketConcept→GPC mappings, approved terminology, locality, or relationship context, but it MUST NOT mutate MKG directly.

All commercial graph evolution remains Evidence → GraphChangeDecision → MKG.
