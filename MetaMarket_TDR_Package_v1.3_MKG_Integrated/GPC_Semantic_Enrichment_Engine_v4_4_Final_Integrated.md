# GPC-Oriented Semantic Enrichment Engine — Integrated Market Concept Architecture v4.4

> This revision hardens the CSRE → Enrichment → GPC Resolver/WRS interoperability contract, including exact semantic-origin preservation and formal wire schemas.

# GPC-Oriented Semantic Enrichment Engine v4.3
## Technical Design Requirements, Responsibility Contract, and Production Prompts

## 1. Purpose

The GPC-Oriented Semantic Enrichment Engine consumes the already-resolved output of the Canonical/Commercial Semantic Resolution Engine (CSRE) and produces a richer, structured semantic representation specifically optimized for downstream taxonomy retrieval and vector matching.

Its core responsibility is:

> **Take a reliable resolved real-world concept and enrich it with additional, evidence-aware semantic context that makes the concept easier to distinguish from nearby concepts and easier to match against GPC domain/category/subcategory/product representations.**

The enrichment engine does **not** decide what the original user expression means. That is CSRE's responsibility.

It does **not** perform transaction intent resolution.

It does **not** own final GPC classification.

It does **not** rank vendors or perform capability matching.

---

## 2. Why Enrichment Exists

CSRE should answer:

> What real-world thing is this user referring to?

Its output may be semantically correct but too compact for high-quality taxonomy retrieval.

For example:

```text
resolved concept:
hammer
```

is correct, but a richer semantic representation can capture:

- hand tool;
- striking tool;
- used to drive nails;
- handheld;
- striking head;
- handle;
- carpentry/construction/repair uses;
- common commercial variants;
- neighbouring/confusable concepts.

These additional signals help downstream vector retrieval find the correct GPC representation without forcing CSRE to know GPC codes.

---

## 3. Architectural Boundary

### Enrichment owns

- semantic expansion of resolved concepts;
- functional characterization;
- use-case expansion;
- relevant attribute extraction/normalization;
- commercial terminology expansion;
- synonym/alias expansion;
- taxonomy-oriented semantic vocabulary;
- distinguishing characteristics;
- confusable/near-neighbour concepts;
- hierarchical semantic clues;
- GPC-oriented embedding text;
- search terms/phrases for downstream retrieval;
- object-level enrichment for every resolved object;
- relationship-aware enrichment for multi-object inputs;
- optional use of WRS evidence when the resolver output is insufficient for high-quality enrichment;
- evidence lineage for externally supported derived facts.

### Enrichment does not own

- interpreting the user's original expression;
- correcting CSRE's referent without a new resolution task;
- transaction intent;
- final GPC code selection;
- final taxonomy classification;
- vendor capability matching;
- vendor ranking;
- commercial interaction evidence;
- authoritative external evidence storage.

---

# 4. Multiple Objects Are First-Class

Enrichment MUST support the complete CSRE output when the input contains multiple objects.

Never merge independent objects into one semantic profile merely because they occurred in the same message.

Example:

> "I need a hammer, nails and electrical materials."

CSRE may produce three objects.

Enrichment must produce three corresponding enrichment profiles:

```json
{
  "objects": [
    { "object_id": "1", "canonical_form": "hammer" },
    { "object_id": "2", "canonical_form": "nails" },
    { "object_id": "3", "canonical_form": "electrical materials" }
  ]
}
```

Each object receives independent enrichment.

---

## 5. Multi-Object Relationships

Enrichment must preserve relationships identified by CSRE.

Example:

> "I need a hammer and nails for roofing."

Possible structure:

```text
hammer ← requested_object
nails ← requested_object
roofing ← functional/use_context
```

Enrichment may use the roofing context to improve semantic representation of hammer and nails, but must not turn roofing into a requested product unless CSRE identified it as such.

Example:

> "I sell phones and I repair them."

Possible object relationships:

```text
phones ← product/category
repair ← service/capability
repair --applies_to--> phones
```

Enrichment should preserve this relationship for downstream matching and retrieval.

---

# 6. Enrichment Output Layers

Every object should receive the following logical layers where applicable.

### 6.1 Identity

- canonical form;
- entity type;
- brand;
- model;
- variant;
- preserved attributes from CSRE.

### 6.2 Definition

A concise, technically and commercially useful definition.

### 6.3 Functional Profile

- primary function;
- secondary functions;
- what the object does;
- functional mechanism where useful.

### 6.4 Use Cases

- common uses;
- commercial use cases;
- relevant environments;
- user/job context.

### 6.5 Semantic Attributes

Only attributes that materially help distinguish the concept.

### 6.6 Commercial Terminology

- common names;
- synonyms;
- aliases;
- informal terminology;
- regional terminology;
- industry terminology.

### 6.7 Taxonomy-Oriented Vocabulary

Terms that help connect the concept with the language likely to appear in taxonomy definitions, product descriptions, category descriptions, and classification data.

### 6.8 Distinguishing Features

The properties that separate the object from nearby concepts.

### 6.9 Confusable Concepts

Closely related concepts that could attract vector retrieval but should be distinguished.

### 6.10 Hierarchy Hints

Semantic clues suggesting:

```text
DOMAIN
  → CATEGORY
    → SUBCATEGORY
      → PRODUCT/CONCEPT
```

These are hints, not final GPC assignments.

---

# 7. GPC Boundary

Enrichment is **GPC-oriented but not GPC-classifying**.

It SHOULD produce information that improves the probability of a correct GPC match.

It MUST NOT invent or assert GPC codes merely because the concept resembles a taxonomy node.

The downstream GPC Resolver is responsible for:

- candidate retrieval;
- candidate comparison;
- GPC code selection;
- final confidence in the GPC assignment.

This preserves the separation:

```text
CSRE → What is it?
ENRICHMENT → What semantic context helps classify/search it?
GPC RESOLVER → Where does it belong?
```

---

# 8. Should Enrichment Use Evidence?

Evidence use is conditional.

The enrichment engine should first determine whether CSRE output plus trusted model knowledge is sufficient.

### Do not invoke WRS when

- the concept is common and unambiguous;
- the required characteristics are well known;
- no taxonomy-sensitive distinction is missing;
- the enrichment model can produce a stable, non-speculative profile.

### Invoke WRS when

- the concept is obscure;
- local terminology is important and not sufficiently grounded;
- CSRE confidence is low or moderate;
- important distinguishing characteristics are uncertain;
- neighbouring concepts are difficult to separate;
- product/function/material distinctions materially affect GPC retrieval;
- terminology required for taxonomy matching cannot be reliably generated from known information;
- conflicting information must be resolved;
- evidence would materially improve retrieval quality.

Therefore:

> **WRS is an optional evidence dependency of Enrichment, not a mandatory enrichment step.**

---

# 9. Evidence Producer Boundary

Enrichment is **not an authoritative evidence producer**.

When WRS provides external evidence:

```text
WRS evidence
    ↓
Enrichment-derived semantic assertion
```

Enrichment may transform evidence into useful semantic features, but must preserve evidence lineage.

Example:

```json
{
  "derived_fact": "uses heat to seal plastic film",
  "derived_from_evidence": ["evidence-123", "evidence-456"]
}
```

The source of truth for the external evidence remains WRS/evidence storage.

Enrichment may produce derived semantic knowledge, not fabricated source claims.

---

# 10. No Taxonomy Contamination

A central invariant:

> **Do not add unsupported specificity merely because it would improve similarity to a GPC concept.**

Example:

CSRE:

```text
canonical_form = grinder
```

Enrichment must not invent:

```text
electric angle grinder
125mm
750W
Bosch
```

unless those facts are present in CSRE input or supported by evidence.

Taxonomy optimization must improve semantic precision, not create fictional product attributes.

---

# 11. Embedding Representations

Enrichment should produce multiple representations instead of one giant paragraph.

Recommended outputs:

```text
canonical_embedding_text
functional_embedding_text
taxonomy_embedding_text
search_terms
semantic_keywords
negative/confusable_terms
```

A downstream system can then select or combine representations appropriate to:

- product matching;
- subcategory matching;
- category matching;
- domain matching;
- GPC candidate retrieval.

---

# 12. Object-Level and Message-Level Context

Enrichment operates at two levels.

### Object level

What semantic information describes this particular object?

### Message level

What relationships or contextual constraints affect interpretation/enrichment of the object set?

Message-level context must never overwrite independently resolved object identities without sufficient evidence.

---

# 13. Production Master System Prompt

```text
SYSTEM ROLE: GPC-ORIENTED SEMANTIC ENRICHMENT ENGINE

You are the GPC-Oriented Semantic Enrichment Engine.

Your input is a resolved semantic representation produced by the Canonical/Commercial Semantic Resolution Engine (CSRE).

Your job is NOT to determine what the user originally meant.
CSRE has already performed semantic resolution.

Your responsibility is to enrich the resolved representation with additional semantic context that improves downstream search, vector retrieval, taxonomy candidate generation, and GPC matching.

==================================================
PRIMARY OBJECTIVE
==================================================

Given one or more already-resolved objects:

1. Preserve their established identity.
2. Expand useful semantic information.
3. Improve functional and commercial characterization.
4. Improve terminology coverage.
5. Improve distinction from nearby concepts.
6. Produce GPC-oriented semantic representations.
7. Use external evidence only when it materially improves enrichment.
8. Preserve provenance for externally supported derived facts.

==================================================
DO NOT RE-RESOLVE
==================================================

Treat the CSRE canonical form as the current semantic identity.

Do not casually replace it with a different concept.

If the CSRE output appears materially inconsistent with available evidence, record a resolution concern rather than silently rewriting the concept.

If a new semantic interpretation is required, flag it for CSRE re-resolution.

==================================================
MULTI-OBJECT INPUT
==================================================

The input may contain one or many objects.

Every independently resolved object MUST receive its own enrichment profile.

Never flatten multiple objects into one concept.

Preserve object IDs and relationships.

Example:

"hammer, nails and electrical materials"

must remain three enriched objects.

==================================================
RELATIONSHIPS
==================================================

Use supplied relationships such as:

- requested_object
- category_of
- subcategory_of
- used_for
- applies_to
- accessory_of
- component_of
- related_to
- service_for
- contextualized_by

Do not invent relationships without sufficient evidence.


==================================================
SEMANTIC ORIGIN
==================================================

Every input object comes from CSRE and MUST include:

semantic_origin.phrase
semantic_origin.concept
semantic_origin.market_concept_id
semantic_origin.concept_status
semantic_origin.relationship = EXPRESSES
semantic_origin.origin = CSRE

Treat this as the established semantic identity.

Preserve it in the enrichment output.

Do not reconstruct it from taxonomy retrieval.
Do not replace the concept with a GPC class.
Do not invent a market_concept_id.

==================================================
ENRICHMENT LAYERS
==================================================

For each object, consider:

IDENTITY
DEFINITION
FUNCTION
USE CASES
DISTINGUISHING ATTRIBUTES
COMMERCIAL TERMINOLOGY
REGIONAL TERMINOLOGY
TAXONOMY-ORIENTED VOCABULARY
DISTINGUISHING FEATURES
CONFUSABLE CONCEPTS
HIERARCHY HINTS
EMBEDDING REPRESENTATIONS

Only populate layers supported by knowledge or evidence.

==================================================
FUNCTIONAL ENRICHMENT
==================================================

Describe what the object does, how it is used, and the relevant functional context.

Prefer information that distinguishes it from nearby concepts.

==================================================
TERMINOLOGY ENRICHMENT
==================================================

Expand useful synonyms and commercial language, including relevant Nigerian/local terminology when supported.

Do not manufacture slang or regional terms.

Preserve the original user terminology separately through the CSRE input.

==================================================
TAXONOMY-ORIENTED ENRICHMENT
==================================================

Generate semantic vocabulary that helps downstream systems identify the appropriate GPC domain, category, subcategory, or product representation.

Think about:

- function;
- material;
- object family;
- use;
- physical characteristics;
- industry/commercial context;
- category-defining language;
- distinctions from neighbouring concepts.

Do NOT output a final GPC code unless explicitly requested by a downstream contract outside this engine.

Do NOT distort the concept to fit a known taxonomy node.

==================================================
NO UNSUPPORTED SPECIFICITY
==================================================

Never add a brand, model, material, size, capacity, power rating, mechanism, or variant unless supported by the input or trusted evidence.

==================================================
EVIDENCE DECISION
==================================================

First determine whether existing knowledge plus CSRE output is sufficient.

If sufficient:
- enrich directly;
- do not invoke external evidence merely because the object is interesting.

If insufficient and the missing information materially affects GPC-oriented discrimination:
- request evidence from WRS;
- specify exactly what evidence is needed.

==================================================
WRS EVIDENCE USE
==================================================

Treat WRS output as external evidence.

Distinguish:

- source-supported fact;
- cross-source finding;
- model-derived semantic feature;
- unresolved uncertainty.

Preserve evidence IDs for derived facts.

==================================================
GPC BOUNDARY
==================================================

You are not the final GPC classifier.

You may generate:

- GPC-oriented vocabulary;
- hierarchy hints;
- distinguishing characteristics;
- candidate family terminology.

You must not fabricate GPC identifiers.

==================================================
CONFUSABLE CONCEPTS
==================================================

Identify nearby concepts that a vector search might confuse with the target.

For each important confusable concept, explain the distinguishing semantic signal where supported.

==================================================
MULTIPLE SPECIFICITY LEVELS
==================================================

The input may be a:

- domain;
- category;
- subcategory;
- product concept;
- service;
- material;
- capability;
- other commercial concept.

Do not force a product-level representation when the input itself is a category/domain/capability.

Enrich according to the object's actual specificity.

==================================================
FINAL RULE
==================================================

Your job is not to answer:

"Which GPC code is this?"

Your job is:

"What additional reliable semantic context will make downstream GPC retrieval and vector matching more accurate without changing what this object actually is?"
```

---

# 14. Runtime Enrichment Prompt

```text
TASK: ENRICH THE RESOLVED COMMERCIAL OBJECT SET

CSRE RESOLUTION OUTPUT:
{{resolver_output}}

CONVERSATION / MESSAGE CONTEXT:
{{context}}

AVAILABLE EVIDENCE:
{{available_evidence}}

AVAILABLE KNOWLEDGE STORE CONTEXT:
{{knowledge_context}}

DOWNSTREAM PURPOSE:
{{downstream_purpose}}

TARGET REPRESENTATION LEVEL:
{{target_level}}

Examples:
- product
- subcategory
- category
- domain
- service
- capability
- mixed object set

Perform enrichment without re-resolving the original expression.

For every object:

1. Preserve the CSRE identity.
2. Build a semantic profile.
3. Add functional information.
4. Add useful terminology.
5. Add distinguishing characteristics.
6. Identify important confusable concepts.
7. Generate GPC-oriented semantic vocabulary.
8. Create embedding/search representations.
9. Determine whether external evidence is actually needed.
10. If needed, produce an evidence request describing exactly what WRS must establish.

For multi-object inputs, enrich each object independently while preserving supplied relationships and shared context.

Do not produce final GPC classification.
Do not invent unsupported specificity.
```

---

# 15. Evidence Request Sub-Prompt

When enrichment determines that WRS is needed:

```text
TASK: SPECIFY EVIDENCE REQUIRED FOR SEMANTIC ENRICHMENT

OBJECT:
{{object}}

CURRENT ENRICHMENT:
{{enrichment_so_far}}

KNOWN GAPS:
{{gaps}}

GPC-ORIENTED PURPOSE:
{{purpose}}

Produce a precise WRS evidence request.

The request must state:

- what fact is missing;
- why the fact materially improves semantic discrimination or taxonomy retrieval;
- which candidate concepts need distinguishing;
- what geographic/local context matters;
- what source types are preferred;
- the exact payload fields Enrichment expects back.

Do not ask WRS to decide the final GPC classification.
```

---

# 16. Production Output Schema

The enrichment output MUST preserve the exact semantic identity produced by CSRE.

It MUST NOT force downstream components to reconstruct the Phrase → Concept relationship from
`canonical_form`.

```json
{
  "enrichment_status": "ENRICHED | PARTIAL | EVIDENCE_REQUIRED | BLOCKED",

  "source_resolution": {
    "resolver_version": "5.1",
    "resolution_request_id": "string"
  },

  "objects": [
    {
      "object_id": "string",

      "semantic_origin": {
        "phrase": "string",
        "concept": "string",
        "market_concept_id": "string|null",
        "concept_status": "KNOWN | PROPOSED",
        "relationship": "EXPRESSES",
        "origin": "CSRE"
      },

      "canonical_form": "string",
      "entity_type": "string",
      "definition": "string",

      "functional_profile": {
        "primary_function": null,
        "secondary_functions": [],
        "mechanism": null
      },

      "use_cases": [],
      "attributes": {},

      "commercial_terminology": {
        "synonyms": [],
        "aliases": [],
        "informal_terms": [],
        "regional_terms": [],
        "industry_terms": []
      },

      "taxonomy_semantics": {
        "domain_hints": [],
        "category_hints": [],
        "subcategory_hints": [],
        "object_family": [],
        "taxonomy_vocabulary": []
      },

      "distinguishing_features": [],

      "confusable_concepts": [
        {
          "concept": "string",
          "distinguishing_signal": "string"
        }
      ],

      "embedding_representations": {
        "canonical_embedding_text": "string",
        "functional_embedding_text": "string",
        "taxonomy_embedding_text": "string",
        "search_terms": [],
        "semantic_keywords": [],
        "negative_terms": []
      },

      "evidence": [
        {
          "evidence_id": "string",
          "derived_fields": []
        }
      ],

      "confidence": {
        "enrichment": 0.0,
        "functional_profile": 0.0,
        "taxonomy_semantics": 0.0
      },

      "evidence_required": false,
      "evidence_request": null,
      "resolution_concern": null
    }
  ],

  "relationships": [],

  "message_context": {
    "functional_context": [],
    "shared_constraints": []
  }
}
```

### Semantic-origin preservation rule

Enrichment MUST copy through:

```text
CSRE.semantic_origin.phrase
CSRE.semantic_origin.concept
CSRE.semantic_origin.market_concept_id
CSRE.semantic_origin.concept_status
CSRE.semantic_origin.relationship
CSRE.semantic_origin.origin
```

without changing their semantic meaning.

Enrichment may add terminology, functions, attributes, confusable concepts, and taxonomy-oriented
context, but it must not replace the CSRE-originated concept with a taxonomy candidate.

---

# 17. Specificity Rules

### Product

Enrich product identity, function, uses, distinguishing attributes, terminology, and confusables.

### Subcategory

Emphasize defining family characteristics, sibling distinctions, representative products, and terminology used to describe the family.

### Category

Emphasize scope, family members, distinguishing boundaries, and category language.

### Domain

Emphasize broad commercial scope, constituent categories/subcategories, terminology, and domain boundaries.

### Service

Emphasize service function, outcome, service vocabulary, equipment/context where useful, and nearby service distinctions.

### Capability

Emphasize what the capability enables, what offerings it covers, and the commercial objects/services associated with it.

### Material

Emphasize physical/commercial role, typical uses, distinguishing properties, and products commonly made from it when useful.

Do not transform one specificity level into another without sufficient basis.

---

# 18. Example: Single Object

Input from CSRE:

```json
{
  "objects": [
    {
      "object_id": "o1",
      "canonical_form": "plastic bag heat sealer",
      "entity_type": "MACHINE"
    }
  ]
}
```

Possible enrichment:

```text
primary function:
heat seals plastic film/bags

common terminology:
bag sealer, plastic bag sealing machine, nylon sealing machine

use cases:
retail packaging, food packaging, small-scale commercial packaging

distinguishing features:
thermal sealing of plastic film

confusable concepts:
vacuum sealer, continuous band sealer
```

No GPC code is asserted.

---

# 19. Example: Multiple Objects

Input:

> "I sell phones, chargers and electrical stuff."

Enrichment must preserve three semantic objects:

```text
phones
chargers
electrical stuff
```

The third remains a broad commercial category rather than being incorrectly expanded into individual electrical products.

The system should produce three enrichment profiles and retain any supplied relationships/context.

---

# 20. Example: Functional Context Relationship

Input:

> "I need a hammer and nails for roofing."

Output conceptually:

```text
OBJECT 1
hammer
  enriched with relevant roofing use context

OBJECT 2
nails
  enriched with relevant roofing use context

CONTEXT
roofing
  role = USE_CONTEXT
```

Roofing must not be silently promoted to a requested product.

---

# 21. Example: Evidence Decision

### Common concept

```text
hammer
```

Known information is sufficient.

Result:

```text
evidence_required = false
```

### Obscure product

```text
unknown local trade term
```

The semantic identity may be resolved but enrichment cannot reliably establish distinguishing characteristics.

Result:

```text
evidence_required = true
```

with a precise WRS request.

---

# 22. Invariants

1. CSRE establishes identity; Enrichment does not silently replace it.
2. Every CSRE object gets an independent enrichment profile.
3. Multi-object relationships are preserved.
4. Shared context may enrich objects but may not arbitrarily redefine them.
5. GPC is a downstream classifier, not the enrichment engine's final answer.
6. WRS is optional and evidence-driven.
7. Enrichment is a derived-semantic producer, not an authoritative evidence store.
8. External evidence lineage is preserved.
9. Unsupported specificity is forbidden.
10. Different specificity levels remain different semantic objects.
11. Embedding representations are purpose-built rather than one universal paragraph.
12. Enrichment optimizes semantic retrieval quality without changing the underlying referent.

---

# 23. End-to-End Responsibility Map

```text
RAW MESSAGE
    ↓
CSRE
    ├── segmentation
    ├── object extraction
    ├── semantic resolution
    ├── context/venue extraction
    ├── commercial interpretation
    └── canonical representation
             ↓
        ENRICHMENT
             ├── semantic expansion
             ├── function/use cases
             ├── terminology
             ├── distinguishing features
             ├── taxonomy-oriented vocabulary
             └── embedding/search representations
                       │
                       └── WRS when evidence is needed
                              ↓
                          evidence
                              ↓
                          enrichment
                              ↓
                    GPC / CAPABILITY MAPPER
                              ↓
                           MATCHING
```

The architecture deliberately keeps the responsibilities orthogonal:

> **CSRE determines what it is.**
>
> **WRS determines what external evidence supports or distinguishes it.**
>
> **Enrichment constructs the richer semantic representation needed downstream.**
>
> **GPC Resolver determines where it belongs in the taxonomy.**


# 24. Locked Market Semantic Integration

This section locks the Enrichment Engine's role in the evidence-driven market semantic architecture. All existing enrichment requirements, output layers, prompts, examples, and boundaries remain in force.

## 24.1 Consume CSRE-Originated Phrase + Concept

Enrichment MUST treat the CSRE semantic-origin relationship as the upstream semantic anchor.

```text
CSRE
Phrase → Concept
        ↓
ENRICHMENT
Concept → richer semantic representation
        ↓
GPC RESOLVER
Concept → GPC candidate / classification
```

Enrichment MUST preserve, unchanged:

- `surface_form` / original phrase;
- `canonical_form` / resolved concept;
- `object_id`;
- semantic confidence;
- concept status (`KNOWN` or `PROPOSED`, when provided);
- object relationships and shared context.

Enrichment MAY add semantic evidence and derived features around the concept, but must not silently replace the CSRE referent.

## 24.2 Market Concept Scheme Representation

The evolving Market Concept Scheme is the platform's semantic concept layer. **SKOS is the candidate representation for this layer**, subject to implementation validation and versioning.

Where the platform uses SKOS, concepts may be represented using:

- `skos:Concept` for market concepts;
- `skos:prefLabel` for the preferred concept label;
- `skos:altLabel` for aliases, local terms, and alternate commercial expressions;
- `skos:broader` / `skos:narrower` for concept hierarchy where justified;
- `skos:related` for genuinely symmetric semantic relatedness;
- SKOS mapping properties only where an actual mapping relationship has been established.

Enrichment MUST NOT use SKOS simply to manufacture taxonomy structure. Commercially directional relationships such as `USED_FOR`, `SUBSTITUTE_FOR`, `ACCESSORY_OF`, `COMMONLY_SOLD_WITH`, `SUPPLIED_BY`, or `SERVES_VENUE` belong in the platform's own RDF vocabulary and/or downstream Market Knowledge Graph.

## 24.3 Collaborative Category Cluster Enrichment

Enrichment must support **collaborative category cluster enrichment** without fabricating inventory.

A buyer interaction can reveal a commercially meaningful concept that expands marketplace semantic coverage even when the buyer's request does not yet map to an established vendor inventory record.

The operational rule is:

> **A buyer search permanently expands the marketplace's semantic coverage, while relevant vendors inherit candidate discoverability rather than fabricated inventory.**

Example:

```text
Buyer search: "dumbbells"
        ↓
CSRE: Phrase → Concept("dumbbells")
        ↓
GPC Resolver: Concept → GPC mapping
        ↓
Market Concept / Knowledge Graph cluster expands
        ↓
Relevant vendor concepts receive candidate discoverability priors
        ↓
NO confirmed inventory is created
```

Enrichment may produce the richer semantic cluster representation needed for retrieval, including:

- parent/child semantic concepts;
- useful aliases and commercial terminology;
- distinguishing features;
- confusable concepts;
- functional relationships;
- supported related concepts.

Enrichment MUST NOT turn a category-cluster relationship into a vendor inventory claim.

## 24.4 RDF Foundation

The platform's graph representation is based on **RDF as the foundational graph model**.

Enrichment outputs should therefore be serializable as semantic assertions that downstream graph services can represent as RDF resources and predicates.

Use:

```text
RDF
  = foundational graph representation

SKOS
  = semantic concept / scheme vocabulary where appropriate

Custom RDF vocabulary
  = commercial relationships, evidence, beliefs, demand, venues,
    inventory, and market behavior
```

The Enrichment Engine is a producer of semantic features, not the authoritative graph governance layer.

## 24.5 Evidence Lineage for Collaborative Enrichment

When a cluster relationship, synonym, local term, or distinguishing fact is supported by observed market evidence, preserve the evidence identifiers so the Market Knowledge Graph can distinguish:

```text
MODEL KNOWLEDGE
from
MARKET-OBSERVED EVIDENCE
from
DERIVED SEMANTIC FEATURE
```

This is especially important when a new buyer phrase causes expansion of a previously sparse category cluster.

---

# 25. Prompt Lock: Market Semantic Layer

Add the following rules to all production enrichment prompts:

```text
MARKET SEMANTIC ARCHITECTURE RULES

1. Preserve the CSRE Phrase → Concept relationship as the semantic origin.
2. Treat the resolved concept as the object being enriched.
3. Do not replace a market concept with a GPC node.
4. Treat the evolving Market Concept Scheme as separate from GPC.
5. SKOS may represent concept labels and semantic hierarchy/mappings when justified.
6. Use platform-specific RDF predicates for commercial relationships that SKOS does not semantically express.
7. A buyer-discovered concept may expand semantic category coverage.
8. Candidate discoverability for relevant vendors is not confirmed inventory.
9. Preserve evidence lineage for market-observed semantic features.
10. Do not create unsupported relationships merely to make a vector retrieval result look stronger.
```

These rules supplement, and do not replace, the existing enrichment prompt instructions.


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

# 26. IMPLEMENTATION INTEGRATION CONTRACT — v4

This section is authoritative for interoperability and supplements all prior enrichment requirements.

## 26.1 Canonical input contract

Enrichment MUST consume the CSRE v5 object contract without reconstructing semantic identity.

Minimum required input:

```json
{
  "schema_version": "5.0",
  "request_id": "string",
  "objects": [
    {
      "object_id": "string",
      "semantic_origin": {
        "phrase": "string",
        "concept": "string",
        "market_concept_id": "string|null",
        "concept_status": "KNOWN|PROPOSED",
        "relationship": "EXPRESSES",
        "origin": "CSRE",
        "request_id": "string",
        "semantic_confidence": 0.0
      }
    }
  ]
}
```

Enrichment MUST reject an object whose `semantic_origin.origin` is not `CSRE`
or whose relationship is not `EXPRESSES`.

## 26.2 Canonical enrichment response schema

The following JSON Schema is the machine-enforceable wire contract:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/enrichment-resolution-v4.json",
  "title": "GPC-Oriented Semantic Enrichment v4",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "request_id",
    "enrichment_status",
    "source_resolution",
    "objects",
    "relationships",
    "message_context"
  ],
  "properties": {
    "schema_version": { "const": "4.0" },
    "request_id": { "type": "string", "minLength": 1 },
    "enrichment_status": {
      "enum": ["ENRICHED", "PARTIAL", "EVIDENCE_REQUIRED", "BLOCKED"]
    },
    "source_resolution": {
      "type": "object",
      "additionalProperties": false,
      "required": ["resolver_version", "resolution_request_id"],
      "properties": {
        "resolver_version": { "type": "string" },
        "resolution_request_id": { "type": "string", "minLength": 1 }
      }
    },
    "objects": {
      "type": "array",
      "items": { "$ref": "#/$defs/object" }
    },
    "relationships": { "type": "array" },
    "message_context": { "type": "object" }
  },
  "$defs": {
    "semanticOrigin": {
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
    "object": {
      "type": "object",
      "additionalProperties": true,
      "required": ["object_id", "semantic_origin", "canonical_form", "entity_type"],
      "properties": {
        "object_id": { "type": "string" },
        "semantic_origin": { "$ref": "#/$defs/semanticOrigin" },
        "canonical_form": { "type": "string" },
        "entity_type": { "type": "string" },
        "definition": { "type": "string" },
        "brand": { "type": ["string", "null"] },
        "model": { "type": ["string", "null"] },
        "variant": { "type": ["string", "null"] },
        "attributes": { "type": "object" },
        "functional_profile": { "type": "object" },
        "use_cases": { "type": "array" },
        "commercial_terminology": { "type": "object" },
        "taxonomy_semantics": { "type": "object" },
        "distinguishing_features": { "type": "array" },
        "confusable_concepts": { "type": "array" },
        "embedding_representations": { "type": "object" },
        "evidence": { "type": "array" },
        "confidence": { "type": "object" }
      }
    }
  }
}
```

## 26.3 Prompt/output binding

The Production Master Prompt and Runtime Enrichment Prompt MUST be bound to the
`enrichment-resolution-v4` schema.

Structured prompts MUST instruct:

```text
Return exactly one JSON object conforming to the enrichment v4 schema.
Do not re-resolve the CSRE concept.
Preserve semantic_origin byte-for-byte except for schema serialization.
Do not invent GPC IDs.
Do not invent unsupported attributes.
```

## 26.4 GPC Resolver handoff

The object identity passed to GPC Resolver is:

```text
object_id
semantic_origin
canonical_form
entity_type
definition
brand
model
variant
attributes
aliases
commercial_interpretation
enrichment
evidence references
relationships
message context
```

GPC Resolver MUST receive the same `object_id` that originated in CSRE.

## 26.5 WRS handoff

When evidence is required, Enrichment MUST construct a consumer-aware WRS request that identifies:

```text
consumer.component = ENRICHMENT
consumer.version = 4.0
request_id
object_id
semantic_origin
question
required evidence fields
relationship target when applicable
```

The WRS result is evidence; Enrichment converts it only into derived semantic features
with evidence lineage preserved.

## 26.6 Market-cluster safety

Enrichment may identify semantic cluster candidates, but:

```text
buyer demand
≠ vendor capability
≠ inventory confirmation
```

Any vendor discoverability prior derived from market relationships must remain a downstream
Evidence System / Matching & Fanout responsibility.

---

# 27. STRUCTURED PROMPT OUTPUT CONTRACTS

Every Enrichment prompt that returns structured output MUST be validated against the
`enrichment-resolution-v4` contract from Section 26.

## 27.1 Evidence request prompt

The Evidence Request Sub-Prompt MUST produce a WRS v4 request, not free-form prose.

Its output is normalized to:

```text
schema_version = 4.0
request_id
consumer.component = ENRICHMENT
consumer.version = 4.0
consumer.purpose
evidence_request.question
evidence_request.context
evidence_request.candidates
evidence_request.relationship_target
evidence_request.evidence_requirements
evidence_request.requested_fields
evidence_request.output_contract
```

The canonical machine schema is:

```text
https://metamarket.local/schemas/wrs-request-v4.json
```

## 27.2 Master/runtime enrichment output

The Master System Prompt and Runtime Enrichment Prompt MUST return the full
`enrichment-resolution-v4.json` shape.

Partial enrichment MUST still include all top-level fields, with explicit status:

```text
ENRICHED
PARTIAL
EVIDENCE_REQUIRED
BLOCKED
```

## 27.3 Evidence lineage invariant

Every derived feature supported by WRS MUST carry one or more `evidence_id` references.
Model-only knowledge MUST be distinguishable from externally evidenced facts.

---

## Cross-Stack Version Matrix

```text
CSRE v5.3 (wire v5.0)
  ↓ exact semantic object contract
Enrichment v4.3 (wire v4.0)
  ↓ enriched object + preserved semantic origin
GPC Resolver v4.3 (wire v4.0)
  ↓ sovereign GPC mapping
Evidence System v4.3 (wire v4.0)
  ↔ WRS v4.3 (wire v4.0)
```

Enrichment MUST NOT import IDCE intent as semantic identity and MUST NOT treat a LangGraph routing
decision as evidence about the object itself.


---

# 28. FINAL IMPLEMENTATION INTEGRATION CONTRACT — v4.2

This section is authoritative for the CSRE v5.3 → Enrichment service boundary and the
Enrichment → GPC Resolver/WRS boundaries. The existing enrichment output wire schema remains
`enrichment-resolution-v4` (`schema_version = 4.0`); component/document version is 4.2.

## 28.1 Canonical Enrichment service request

```typescript
export interface EnrichmentServiceRequest {
  schemaVersion: '4.1';
  requestId: string;
  component: 'ENRICHMENT';
  componentVersion: '4.4';
  conversationId: string;
  turnId: string;
  contextSnapshotId: string;
  sourceResolution: {
    resolver: 'CSRE';
    componentVersion: '5.2';
    wireSchemaVersion: '5.0';
    resolutionRequestId: string;
  };
  objects: readonly object[];
  relationships: readonly object[];
  messageContext: object;
  downstreamPurpose: 'GPC_CLASSIFICATION' | 'SEMANTIC_SEARCH' | 'CAPABILITY_MATCHING' | 'OTHER';
  policyVersion: string;
}
```

## 28.2 Machine-enforceable request schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/enrichment-service-request-v4.1.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "request_id",
    "component",
    "component_version",
    "conversation_id",
    "turn_id",
    "context_snapshot_id",
    "source_resolution",
    "objects",
    "relationships",
    "message_context",
    "downstream_purpose",
    "policy_version"
  ],
  "properties": {
    "schema_version": { "const": "4.1" },
    "request_id": { "type": "string", "minLength": 1 },
    "component": { "const": "ENRICHMENT" },
    "component_version": { "const": "4.4" },
    "conversation_id": { "type": "string", "minLength": 1 },
    "turn_id": { "type": "string", "minLength": 1 },
    "context_snapshot_id": { "type": "string", "minLength": 1 },
    "source_resolution": {
      "type": "object",
      "additionalProperties": false,
      "required": ["resolver", "component_version", "wire_schema_version", "resolution_request_id"],
      "properties": {
        "resolver": { "const": "CSRE" },
        "component_version": { "const": "5.2" },
        "wire_schema_version": { "const": "5.0" },
        "resolution_request_id": { "type": "string", "minLength": 1 }
      }
    },
    "objects": { "type": "array", "minItems": 1 },
    "relationships": { "type": "array" },
    "message_context": { "type": "object" },
    "downstream_purpose": {
      "enum": ["GPC_CLASSIFICATION", "SEMANTIC_SEARCH", "CAPABILITY_MATCHING", "OTHER"]
    },
    "policy_version": { "type": "string", "minLength": 1 }
  }
}
```

Each item in `objects` MUST be a valid CSRE v5.0 object. Enrichment MUST preserve its
`object_id`, `canonical_form`, `entity_type`, and complete `semantic_origin`.

## 28.3 Output traceability

The top-level enrichment `request_id` is the Enrichment request correlation key.
`source_resolution.resolution_request_id` is the originating CSRE request key.
For every object:

```text
Enrichment request_id
CSRE resolution_request_id
CSRE object_id
semantic_origin.request_id
```

MUST remain recoverable together.

The existing response schema's `source_resolution.resolver_version` SHOULD be set to `"5.1"`
for the component version and its wire origin MUST remain explicitly `"5.0"` where this distinction
is required by deployment configuration.

## 28.4 WRS handoff invariant

Whenever Enrichment invokes WRS:

```text
ENRICHMENT request_id
      ↓
WRS request.request_id
      ↓
WRS response evidence[].evidence_id
      ↓
Enrichment object.evidence[].evidence_id
```

WRS evidence IDs MUST NOT be replaced by Enrichment-generated IDs.

## 28.5 GPC handoff invariant

Enrichment passes each object with the same `object_id` and complete CSRE `semantic_origin`.
The GPC Resolver MAY add taxonomy representations but MUST NOT overwrite the CSRE concept,
phrase, or relationship.

## 28.6 Example correction

Where the earlier illustrative output omitted request correlation, the production interpretation
is:

```json
"semantic_origin": {
  "phrase": "wall socket",
  "concept": "wall electrical socket",
  "market_concept_id": "mc_123",
  "concept_status": "KNOWN",
  "relationship": "EXPRESSES",
  "origin": "CSRE",
  "request_id": "req_123",
  "semantic_confidence": 0.972
}
```

This example is illustrative only; the executable schema remains authoritative.

---

# 9. NORMATIVE AGENDA COMPLETION — v4.3

**Effective:** 2026-09-10  
**Status:** Authoritative amendment.

## 9.1 MKG integration boundary

Semantic Enrichment may **read** MKG knowledge when that knowledge materially improves semantic retrieval, distinction, or contextualization. It must not directly mutate MKG.

Enrichment may consume:
- existing MarketConcept identities;
- approved commercial relationship knowledge;
- prior market terminology;
- graph-derived context;
- GPC lineage.

Enrichment may produce **derived semantic features**, but those features are not automatically Evidence or durable market truth. Externally supported derived claims must carry lineage and may be submitted to Evidence for evaluation.

## 9.2 Final processing boundary

```text
CSRE → Enrichment → GPC Resolver
           │             │
           └──────┬──────┘
                  ▼
                 MKG
                  ▲
                  │
               Evidence
```

MKG is the read/write authority for graph state; Evidence is the authority for evidence-backed learning decisions.

## 9.3 Relationship-aware enrichment

Existing multi-object and relationship-aware enrichment remains required. Relationship expansion must use explicit relation semantics rather than treating all nearby concepts as equivalent or as `skos:related`.



# 29. NORMATIVE AGENDA COMPLETION — v4.4 INTEROPERABILITY + KNOWLEDGE CONTEXT

**Effective:** 2026-09-12  
**Status:** Authoritative amendment.

## 29.1 Final component identity

```text
component               = ENRICHMENT
component_version       = 4.4
request schema_version  = 4.1
response schema_version = 4.0
CSRE dependency         = component_version 5.4 / wire schema 5.0
```

Earlier examples expecting CSRE component version `5.2` are superseded.

## 29.2 Final CSRE → Enrichment contract

`source_resolution.component_version` MUST accept the currently deployed CSRE component version `5.4` for the final package.

The Enrichment adapter MUST preserve:

```text
CSRE request_id
CSRE object_id
CSRE semantic_origin
CSRE canonical_form
CSRE entity_type
```

No enrichment field may overwrite the CSRE semantic identity.

## 29.3 Final MKG read port

Enrichment MAY call a typed `MKGReadPort` for:

- MarketConcept lookup;
- approved market terminology;
- prior phrase→concept knowledge;
- relationship context;
- locality-specific relationship context;
- validated GPC lineage.

The response MUST distinguish stored facts from graph-derived inference and MUST preserve provenance. Enrichment is forbidden from writing MKG.

## 29.4 Derived semantics vs evidence

Model-generated enrichment fields are derived semantic features. They are not automatically evidence or durable market truth. When a feature materially depends on external evidence or observed marketplace language, its lineage MUST identify the supporting evidence IDs.

## 29.5 Matching does not require GPC

Enrichment MUST be usable for `SEMANTIC_SEARCH` and `CAPABILITY_MATCHING` even when GPC mapping is absent. `GPC_CLASSIFICATION` is one downstream purpose, not a universal prerequisite for all discovery workflows.

## 29.6 Performance and call consolidation

Enrichment may execute deterministic retrieval and model enrichment in parallel where there is no dependency conflict. Live traces MUST record model call count and latency so any later call consolidation is evidence-based.
