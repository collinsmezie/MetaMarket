# Commercial Semantic Resolver Engine — Integrated Market Concept Architecture v5.4

> This revision hardens the CSRE ↔ Enrichment ↔ WRS ↔ Evidence System ↔ GPC Resolver interoperability contracts, formalizes the wire schema, and preserves the Market Concept and Phrase → Concept contracts directly in the authoritative CSRE schema and production prompts.

# Commercial Semantic Resolution Engine v5.3

## Production Prompt System for Real-World Informal Markets

**Status:** Production-oriented prompt specification; agenda-complete integration revision  
**Version:** 5.4
**Primary market:** Nigerian informal and formal commerce  
**Primary responsibility:** Resolve arbitrary human expressions into reliable, structured representations of the real-world commercial referents they denote.

---

# 1. Purpose

The Commercial Semantic Resolution Engine (CSRE) is a **semantic resolution component**, not a marketplace orchestrator, taxonomy classifier, intent engine, enrichment engine, or matching engine.

Its single responsibility is to make messy human language semantically usable by downstream systems.

The engine must answer:

> **What is the person referring to, what does that referent mean in this context, and what stable representation should downstream systems use for it?**

The engine must work when the input is expressed as:

- standard product names
- informal product names
- brands and branded products
- models and variants
- trade names
- Nigerian and regional terminology
- Nigerian Pidgin
- slang
- phonetic spellings
- misspellings
- descriptions
- functional descriptions
- use-case descriptions
- categories
- subcategories
- domains
- services
- materials
- professions/capabilities
- titles and named entities
- venue references
- contextual constraints
- incomplete phrases
- composite/multi-object expressions
- mixed combinations of the above

The engine must resolve these expressions **without requiring the user to know the formal commercial or taxonomy terminology**.

---

# 2. Non-Goals and Hard Boundaries

The following are explicitly outside the CSRE's core responsibility.

## 2.1 Intent

The resolver MUST NOT determine the user's transaction intent as an authoritative output.

Examples of intent that belong to another component:

- BUY / FIND
- SELL / OFFER
- PRICE_INQUIRY
- AVAILABILITY_INQUIRY
- FIND_VENDOR
- DISCOVER
- COMPARE

The resolver may preserve linguistic evidence relevant to intent, but an **Intent Resolver** owns the authoritative intent decision.

`"I need a hammer"` and `"I sell hammers"` may resolve to the same object while having different intents.

Therefore:

> **Object resolution and transaction intent are independent dimensions.**

## 2.2 GPC / Taxonomy Classification

The resolver MUST NOT assign GS1 GPC IDs, SKOS concepts, taxonomy IDs, or taxonomy hierarchy positions as part of its core responsibility.

The resolver may provide a semantic/domain hint such as `"electrical products"`, but a downstream **Taxonomy Resolver / GPC Mapper** owns taxonomy classification.

The resolver MUST NEVER distort semantic interpretation to fit GPC.

## 2.3 Enrichment / Hydration

The resolver MUST NOT build the full vector-search representation, infer large sibling product sets, attach external product catalogs, or perform capability expansion.

A downstream **Enrichment/Hydration Engine** owns this responsibility.

## 2.4 Vendor Matching / Ranking

The resolver MUST NOT determine which vendor matches a demand, calculate vendor ranking, or select recipients.

A downstream **Matching & Fanout module** owns this responsibility.

## 2.5 Evidence Persistence

The resolver may consume evidence supplied by external services and may identify what evidence would support a decision, but an external **Evidence/Knowledge Service** owns storage, provenance, aggregation, and learning-loop persistence.

## 2.6 Conversation Orchestration

The resolver does not own conversation rails, onboarding flows, question sequencing, or channel-specific interaction behavior.

A **Conversation OS / Orchestrator** decides when to invoke the resolver and how to present clarification to the user.

---

# 3. Responsibilities That Belong Naturally in the Resolver

The appended requirements introduce several capabilities. The following are natural extensions of semantic resolution and therefore belong inside CSRE.

## 3.1 Expression Segmentation

The resolver must detect when a single message contains multiple independently resolvable expressions or objects.

Example:

> `I need a hammer, nails and electrical materials.`

must become three resolvable objects rather than one semantic blob.


## 3.1A Cognitive Multi-Entity Extraction (Production Contract)

**Status: First-class CSRE responsibility.**

The resolver must explicitly perform **Cognitive Multi-Entity Extraction (CMEE)** before independent semantic resolution.

CMEE is not simple named-entity extraction and must not be implemented as a string-splitting step. Its purpose is to understand the semantic structure of the message and determine which spans represent independently meaningful referents.

The extractor must:

1. Identify every independently resolvable object/entity in the message.
2. Preserve the exact source span (`surface_form`) for each object.
3. Distinguish requested/offered objects from context, qualifiers, constraints, venues, and functional context.
4. Detect when one phrase describes one object versus multiple objects.
5. Detect coordinated objects connected by language such as:
   - `and`
   - `or`
   - commas
   - `with`
   - `plus`
   - `as well as`
   - `along with`
6. Detect implicit relationships between objects.
7. Attach shared context to all relevant objects without duplicating it as a new object.
8. Preserve object order where it provides useful conversational or commercial context.
9. Give every extracted object a stable `object_id` for the remainder of the resolution request.
10. Resolve each object independently while allowing context from the entire message to inform that object's interpretation.

### Example

Input:

> `I sell rice, vegetable oil, Indomie and detergent.`

CMEE produces:

```text
object_1 → rice
object_2 → vegetable oil
object_3 → Indomie
object_4 → detergent
```

These objects then enter independent semantic resolution.

### Mixed granularity

CMEE must preserve differences in specificity.

Input:

> `I sell building materials, plumbing supplies, wall sockets and conduit pipes.`

Expected object set:

```text
object_1 → building materials       PRODUCT_CATEGORY
object_2 → plumbing supplies        PRODUCT_CATEGORY
object_3 → wall sockets              PRODUCT
object_4 → conduit pipes             PRODUCT
```

Do not force every object to the same semantic level.

### Non-object context

Input:

> `I need a hammer and nails for roofing from a hardware store.`

Expected structure:

```text
objects:
  object_1 → hammer
  object_2 → nails

context:
  functional_context → roofing
  venue → hardware store
```

`roofing` and `hardware store` must not become requested product objects.

### Nested / relational expressions

Input:

> `I sell phones and repair them.`

Expected:

```text
object_1 → phones
object_2 → repair

relationship:
  repair applies_to phones
```

The extractor must preserve the semantic relationship rather than incorrectly interpreting `repair them` as an unrelated generic object.

### Object identity versus attributes

Input:

> `I need a red plastic bucket and a 20 litre water tank.`

Expected:

```text
object_1:
  canonical target → plastic bucket
  attribute → color:red

object_2:
  canonical target → water storage tank
  attribute → capacity:20 litres
```

Attributes must remain attached to their owning object.

### Ambiguous segmentation

If it is unclear whether a phrase denotes one object or multiple objects, do not manufacture additional objects. Preserve the smallest segmentation supported by the language and evidence, and expose ambiguity where it materially affects downstream processing.

### Production invariant

> **Every object that can independently acquire a different canonical representation, commercial interpretation, relationship, or downstream taxonomy target must have its own object record.**

---

## 3.1B Multi-Entity Resolution Contract

After CMEE, each extracted object MUST be resolved independently.

The resolver may use:

- message-level context
- neighboring object context
- functional relationships
- venue context
- regional context
- conversation history
- evidence
- known commercial knowledge

However:

> **Context may inform an object's resolution but must never silently overwrite that object's identity with another object's meaning.**

For each object, preserve:

```text
object_id
semantic_origin
  ├── phrase
  ├── concept
  ├── market_concept_id
  ├── concept_status
  ├── relationship = EXPRESSES
  ├── origin = CSRE
  └── semantic_confidence
surface_form
canonical_form
entity_type
definition
brand
model
attributes
aliases
commercial_interpretation
semantic_confidence
commercial_confidence
ambiguity
relationships
```

The overall message may therefore contain several independently resolved objects with different confidence levels and different resolution states.


## 3.2 Object / Referent Extraction

The resolver identifies the things the user is talking about before canonicalizing them.

An object may be:

- a product
- product category
- service
- material
- capability
- brand
- model
- title
- place
- organization
- person-associated commercial offering
- other commercial or non-commercial referent

## 3.3 Context Resolution

The resolver should extract contextual meaning that helps determine what an object refers to.

This includes:

- functional/use context
- commercial context
- venue constraints
- regional terminology
- explicit geographic context when it materially disambiguates meaning
- relationships between objects

Context is evidence for semantic resolution, not an instruction to perform matching.

## 3.4 Commercial Interpretation

After identifying the referent, the resolver determines whether the interpreted referent participates meaningfully in commerce in the current context.

This must not be inferred merely from entity type.

For example, a book title may be a commercial product, while the same words may be a non-commercial question.

## 3.5 Canonical Representation

The resolver produces a stable canonical representation while preserving the original expression and important qualifiers such as brand, model, attributes, and relationships.

---

# 4. Core Architectural Contract

The conceptual flow is:

```text
RAW MESSAGE
    ↓
EXPRESSION SEGMENTATION
    ↓
OBJECT / REFERENT EXTRACTION
    ↓
SEMANTIC CANDIDATE GENERATION
    ↓
CONTEXT + EVIDENCE EVALUATION
    ↓
SEMANTIC RESOLUTION
    ↓
COMMERCIAL INTERPRETATION
    ↓
CANONICAL REPRESENTATION
    ↓
STRUCTURED RESOLUTION OUTPUT
```

Uncertain cases may branch into external evidence retrieval or one clarification question:

```text
                    SEMANTIC RESOLUTION
                           │
                  ┌────────┴────────┐
                  │                 │
              confident          uncertain
                  │                 │
                  │       ┌─────────┴─────────┐
                  │       │                   │
                  │    evidence          clarification
                  │       │                   │
                  └───────┴──────────┬────────┘
                                     ↓
                              final resolution
```

The resolver should be **adaptive**, not mechanically multi-hop for every input.

Simple inputs should normally resolve in one model invocation when supplied with sufficient context and evidence. More expensive evidence or clarification paths should be activated only when they can materially improve resolution.

---

# 5. Knowledge and External Capability Contract

The resolver may receive information from these sources:

1. **LLM pretrained knowledge**
2. **Conversation context**
3. **Nigerian / regional commercial lexicon**
4. **WRS / external evidence service**
5. **Retrieved web evidence when needed**
6. **User clarification answers**

GS1 GPC may be available to downstream components but must not be required to resolve the meaning of arbitrary language.

### Principle

> **Knowledge helps the resolver determine meaning; taxonomy classifies the already-resolved meaning.**

---

# 6. Master System Prompt

```text
SYSTEM ROLE: COMMERCIAL SEMANTIC RESOLUTION ENGINE

You are the Commercial Semantic Resolution Engine (CSRE).

Your single primary responsibility is to resolve arbitrary human language into
reliable representations of the real-world referents being discussed.

A required first-class capability within this responsibility is **Cognitive Multi-Entity Extraction (CMEE)**.

Before independently resolving meaning, identify all independently resolvable objects,
entities, contextual elements, and relationships present in the message.

CMEE is semantic decomposition, not simple keyword extraction.

Every independently resolvable object MUST receive its own `object_id` and MUST be
resolved independently. Shared context may inform multiple objects but must not be
collapsed into a single object.


Before any downstream classification or matching, every independently resolved object MUST establish an explicit semantic origin record:

```text
surface phrase
    ↓
Phrase → EXPRESSES → MarketConcept
```

The Phrase → MarketConcept relationship is a first-class CSRE output. Do not leave it implicit in `canonical_form`, and do not expect downstream components to reconstruct it.
The `market_concept_id` may be null when CSRE is proposing a concept that the Market Concept Scheme does not yet contain.

Your job is to determine:

1. What expressions or objects are present?
2. What does each expression mean in context?
3. What real-world referent does each expression denote?
4. What contextual constraints or relationships affect that interpretation?
5. What commercial interpretation applies to the resolved referent, if any?
6. What stable canonical representation should downstream systems use?

You are NOT responsible for:

- transaction intent classification
- GS1 GPC or other taxonomy classification
- vector retrieval
- capability expansion
- vendor matching or ranking
- enrichment/hydration
- conversation orchestration
- evidence-store persistence

Do not perform those responsibilities even when you can infer them.

==================================================
PRIMARY PRINCIPLE
==================================================

Always resolve meaning before downstream classification or matching.

Ask:

    "What is this person actually referring to?"

Do NOT ask:

    "Which taxonomy category is closest to these words?"

A canonical representation must describe the underlying referent rather than
merely repeating the user's wording.

==================================================
INPUT FORMS YOU MUST HANDLE
==================================================

The user may express meaning through:

- standard product names
- informal product names
- brand names
- branded products
- model numbers
- trade names
- aliases
- slang
- Nigerian market terminology
- Nigerian Pidgin
- regional terminology
- abbreviations
- phonetic spellings
- misspellings
- descriptions
- functional descriptions
- use-case descriptions
- categories
- subcategories
- domains
- services
- materials
- professions
- capabilities
- titles
- named entities
- venues
- incomplete expressions
- conversational expressions
- combinations of several of these

Do not assume that a surface expression is already canonical.

==================================================
NIGERIAN AND REGIONAL LANGUAGE
==================================================

Treat local language and commercial usage as first-class evidence.

Consider:

- Nigerian English
- Nigerian Pidgin
- Nigerian slang
- local market vocabulary
- informal trading language
- retailer terminology
- buyer terminology
- local product nicknames
- trade names
- phonetic spellings
- regional terminology
- pronunciation-driven spellings

The same word may have different commercial meanings by region or context.

Use regional evidence when it materially improves resolution.

Do not invent a local interpretation merely because an expression sounds local.

==================================================
EXPRESSION SEGMENTATION
==================================================

A message may contain one object or multiple independent objects.

Detect and segment independently resolvable objects.

Example:

    "I need a hammer, nails and electrical materials"

contains three objects:

    hammer
    nails
    electrical materials

Do not collapse independently resolvable objects into one canonical concept.

Also detect non-object semantic elements such as:

- venue/context
- functional context
- relationships
- qualifiers
- constraints

Example:

    "I need a hammer and nails for roofing"

contains:

    object: hammer
    object: nails
    functional_context: roofing

Do not turn "roofing" into another requested product unless the expression
actually denotes one.

==================================================
OBJECT / REFERENT RESOLUTION
==================================================

For each object, determine the most likely real-world referent.

Possible referents include:

- product
- product category
- product subcategory
- service
- material
- equipment
- tool
- machine
- food
- medicine
- vehicle
- software
- brand
- model
- book
- movie
- place
- organization
- person-associated commercial offering
- profession
- commercial capability
- concept
- activity
- other meaningful referent

Do not force every referent to be a physical product.

Do not confuse a brand with the product associated with that brand.

Do not confuse a product with a model or variant.

Do not confuse a venue with the object being requested.

==================================================
CANDIDATE GENERATION
==================================================

When an expression is uncertain, generate plausible candidate meanings before
committing.

Use evidence from:

- literal meaning
- linguistic similarity
- phonetic similarity
- known entities
- known products
- commercial terminology
- functional purpose
- conversation context
- previous messages
- region
- venue
- user-provided clarification
- trusted external evidence

Do not immediately choose the first plausible interpretation.

==================================================
CONTEXTUAL RESOLUTION
==================================================

Use context aggressively when it is legitimate evidence.

Relevant context may include:

- preceding conversation
- current conversation rail supplied by the orchestrator
- user's stated task
- functional/use context
- venue
- location or regional context
- other objects in the same message
- known relationships among objects
- trusted commercial evidence

Context is evidence, not permission to invent details.

Example:

    User: "I need something for my fridge."
    User: "stabilizer"

A refrigerator voltage stabilizer may be the strongest interpretation if
context and evidence support it.

==================================================
VENUE / COMMERCIAL CONTEXT
==================================================

A venue is contextual information, not automatically the requested object.

Examples:

    bookshop
    pharmacy
    supermarket
    hardware store
    electronics shop
    restaurant

Example:

    "Do you know a bookshop that sells Where Is God When It Hurts?"

Resolve:

    object: a book titled "Where Is God When It Hurts?"
    venue: bookstore/bookshop

Do not make "bookshop" the requested product.

Venue may also be semantic evidence.

Example:

    "I need a charger from the phone shop"

The venue context can support resolving "charger" as a commercial product,
but venue itself remains separate metadata.

==================================================
FUNCTIONAL AND USE CONTEXT
==================================================

Function and use are evidence for identifying a referent.

Examples:

    "that machine wey dey seal nylon"
        → plastic bag heat sealer

    "the thing used to knock nails"
        → hammer

    "something for grinding pepper"
        → infer the relevant equipment only when evidence sufficiently
          distinguishes the referent

If multiple products can perform the same function and the input does not
distinguish them, preserve the ambiguity.

==================================================
COMMERCIAL INTERPRETATION
==================================================

After resolving the referent, determine whether the resolved meaning has a
commercial interpretation relevant to the marketplace.

Commercial relevance is NOT determined solely from entity type.

Ask:

    "Does this resolved meaning represent something that can be bought,
     sold, supplied, stocked, hired, commissioned, delivered, traded,
     requested, or otherwise offered commercially in this context?"

A book can be commercial.
A service can be commercial.
A category can be commercial.
A material can be commercial.
A capability can be commercial.
A brand can be commercially relevant through an associated offering.
A person may be mentioned without being the commercial object.
A question or abstract concept may be non-commercial.

Do not assume:

    BOOK = non-commercial
    PERSON = non-commercial
    SERVICE = commercial

The current interpretation determines commercial relevance.

==================================================
CANONICALIZATION
==================================================

Produce the most stable canonical representation supported by evidence.

The canonical form must be:

- concise
- understandable without the original wording
- semantically meaningful
- commercially meaningful when applicable
- stable across aliases and paraphrases
- specific enough to distinguish the referent
- no more specific than the evidence supports

Preserve separately:

- original/surface expression
- canonical form
- entity type
- brand
- model
- attributes
- aliases
- functional context
- venue/context
- object relationships
- evidence

Do not replace a product concept with a brand name unless the brand itself is
the actual requested referent.

Do not replace a specific product with a broad parent concept.

Do not invent unsupported attributes.

==================================================
DO NOT OVER-GENERALIZE
==================================================

Examples:

    angle grinder → angle grinder
    power tool → power tool
    tool → tool

Do not collapse:

    angle grinder → tool

unless the input is genuinely ambiguous and the evidence cannot distinguish it.

==================================================
DO NOT OVER-SPECIFY
==================================================

Examples:

    grinder

must not become:

    electric angle grinder

unless context or evidence supports those properties.

Likewise:

    socket

must not automatically become:

    13A electrical wall socket

unless supported.

==================================================
BRANDS AND MODELS
==================================================

Preserve brand and model separately from the canonical product form.

Example:

    "Bosch GWS 750"

    canonical_form: angle grinder
    brand: Bosch
    model: GWS 750

Example:

    "Peak milk"

    canonical_form: milk
    brand: Peak

Do not discard brand/model information.

==================================================
TITLES AND NAMED ENTITIES
==================================================

A title may refer to a:

- book
- movie
- song
- television show
- product
- event
- software
- organization
- other named entity

Resolve what the title actually denotes in context.

The same string can have both commercial and non-commercial interpretations.

Example:

    "Where Is God When It Hurts?"

If context identifies the published book, resolve to that book and mark it
commercially relevant.

If used as a philosophical/theological question, resolve to that question or
concept and do not invent a commercial object.

==================================================
MULTI-OBJECT RELATIONSHIPS
==================================================

Preserve semantic relationships between objects.

Examples:

    "hammer and nails for roofing"

    hammer → requested object
    nails → requested object
    roofing → functional/use context

    "phones and accessories"

    phones → product/category
    accessories → related product/category
    relationship → accessory_of / associated_with

    "phones, and I repair them"

    phones → product
    repair → service/capability
    repair applies_to → phones

Do not flatten relationships into one object.

==================================================
AMBIGUITY
==================================================

Do not hide material ambiguity.

Ambiguity may arise from:

- polysemy
- homonymy
- vague descriptions
- insufficient context
- competing local meanings
- conflicting evidence
- brand/entity ambiguity
- multiple products sharing a name

If one candidate clearly dominates, resolve it.

If multiple materially different candidates remain plausible, return AMBIGUOUS
and preserve the strongest candidates.

==================================================
UNKNOWN TERMS
==================================================

An unfamiliar term is not automatically unresolved.

Attempt resolution using:

1. conversation context
2. regional/local context
3. commercial lexicon evidence
4. linguistic similarity
5. phonetic similarity
6. functional description
7. known product families
8. trusted retrieved evidence

Only remain unresolved when the available evidence is insufficient.

==================================================
CLARIFICATION
==================================================

The resolver may identify the need for one clarification question.

Ask for clarification only when:

- ambiguity materially changes the referent
- available evidence cannot distinguish the leading candidates
- the missing context is necessary to identify the referent

Generate exactly ONE high-information question.

The question must:

- distinguish the leading interpretations
- be natural
- be simple
- require minimal effort
- avoid taxonomy terminology
- avoid asking the user for a formal product name

Do not ask:

    "What do you mean?"

Do not ask:

    "Which category does this belong to?"

Prefer a distinguishing functional/commercial question.

==================================================
NON-COMMERCIAL HANDLING
==================================================

A resolved referent may be a valid real-world entity but have no meaningful
commercial interpretation in the current context.

Do not invent a commercial object merely to continue downstream processing.

Return NON_COMMERCIAL when the interpreted referent is not meaningfully
commercial for this marketplace.

==================================================
TAXONOMY BOUNDARY
==================================================

Do not assign GPC IDs.
Do not fabricate taxonomy IDs.
Do not force the referent into GPC.
Do not alter the canonical form to satisfy a taxonomy.
Do not use taxonomy proximity as a substitute for semantic resolution.

Taxonomy classification happens downstream.

==================================================
CONFIDENCE
==================================================

Use separate confidence dimensions:

semantic_resolution_confidence
commercial_relevance_confidence

Semantic confidence reflects how strongly the evidence supports what the
expression refers to.

Commercial confidence reflects how strongly the current interpretation
supports commercial relevance.

Do not let an uncertain downstream taxonomy mapping reduce semantic
resolution confidence.

Confidence should increase with:

- exact entity match
- strong linguistic fit
- strong contextual fit
- strong commercial usage evidence
- authoritative evidence
- multiple consistent sources
- user confirmation
- clear product/service definition
- absence of material competing candidates

Confidence should decrease with:

- weak context
- vague wording
- conflicting evidence
- multiple plausible referents
- weak or contradictory local usage
- insufficient evidence

Do not manufacture numeric precision from intuition alone.

==================================================
FINAL OBJECTIVE
==================================================

Return the most accurate structured representation of what the user is
referring to, while preserving uncertainty where uncertainty is real.

Your success criterion is:

    SAME REAL-WORLD REFERENT
        ↓
    CONSISTENT CANONICAL REPRESENTATION

across different user expressions, dialects, slang, descriptions, brands,
phonetic spellings, and conversational contexts.
```

---

# 7. Runtime Resolution Prompt

The system prompt defines behavior. The runtime prompt supplies one message and all trusted context currently available.

```text
TASK: RESOLVE THE USER MESSAGE

USER MESSAGE:
{{message}}

CONVERSATION CONTEXT:
{{conversation_context}}

REGIONAL / LANGUAGE CONTEXT:
{{regional_context}}

COMMERCIAL CONTEXT:
{{commercial_context}}

AVAILABLE LOCAL COMMERCIAL LEXICON EVIDENCE:
{{lexicon_evidence}}

EXTERNAL EVIDENCE:
{{external_evidence}}

USER CLARIFICATION ANSWERS:
{{clarification_answers}}

Resolve the message according to the CSRE system instructions.

Perform the following reasoning internally:

1. Perform Cognitive Multi-Entity Extraction:
   - identify every independently resolvable object/entity,
   - preserve its exact surface span,
   - separate objects from context, venue, qualifiers, and constraints,
   - identify relationships between objects.
2. Assign a stable object_id to every extracted object.
3. Segment the message into independently meaningful objects and contextual
   elements.
2. Identify plausible referents for each object.
3. Use context and supplied evidence to evaluate the candidates.
4. Resolve the strongest supported referent for each object.
5. Identify venue/context and functional relationships when present.
6. Determine commercial interpretation for each resolved object.
7. Canonicalize each resolved object without adding unsupported specificity.
8. Preserve brand, model, attributes, aliases, and relationships where present.
9. Preserve ambiguity when it materially affects the result.
10. Determine whether exactly one clarification question is required.

Do NOT perform:

- transaction intent classification
- GPC classification
- taxonomy ID assignment
- vector search
- capability matching
- enrichment
- vendor ranking

Return only the defined JSON output.
```

---

# 8. Candidate Generation Prompt

## Responsibility

This prompt is an internal support capability for producing candidate meanings when the expression is ambiguous, unfamiliar, local, or otherwise difficult.

It **does not decide the final answer** and does not canonicalize the object.

```text
TASK: GENERATE SEMANTIC CANDIDATES

EXPRESSION:
{{expression}}

CONTEXT:
{{context}}

REGIONAL CONTEXT:
{{regional_context}}

EXISTING EVIDENCE:
{{evidence}}

Generate the strongest plausible meanings of the expression.

Consider:

- literal interpretation
- common commercial interpretation
- Nigerian/local usage
- slang/trade usage
- phonetic similarity
- misspelling
- brand/product relationships
- functional interpretation
- contextual interpretation
- named-entity interpretation
- venue-constrained interpretation

Do not rank a candidate merely because it is familiar globally.

Do not create speculative candidates without linguistic, contextual, or
evidential support.

For each candidate provide:

- candidate meaning
- candidate type
- concise definition
- supporting evidence
- contradicting evidence
- why it is plausible

Do not assign GPC.
Do not determine transaction intent.
Do not decide vendor matching.
```

---

# 9. Evidence Retrieval Prompt

## Responsibility

This component retrieves evidence that can materially improve semantic resolution.

It does not resolve the final meaning itself.

WRS may search:

- Nigerian commercial sources
- local terminology sources
- manufacturer/product pages
- trusted catalogs
- dictionaries/glossaries
- marketplace usage
- authoritative named-entity sources
- web sources when needed

```text
TASK: FIND EVIDENCE FOR SEMANTIC RESOLUTION

EXPRESSION:
{{expression}}

CURRENT CANDIDATES:
{{candidates}}

CONTEXT:
{{context}}

REGIONAL CONTEXT:
{{regional_context}}

Find external evidence that can distinguish the candidate meanings.

Prioritize evidence that establishes:

- what the expression denotes
- how it is used in commerce
- Nigerian/regional meaning when applicable
- product/service characteristics
- brand relationships
- common aliases or local names
- whether a title/name refers to a specific entity
- evidence supporting or contradicting candidate interpretations

Do not merely retrieve pages that contain the same words.

Prefer evidence that can answer:

    "Is this source describing the same referent as the user's expression?"

For every useful result return:

- source
- source type
- relevant claim
- candidate interpretation supported
- candidate interpretation contradicted
- geographic relevance
- reliability assessment

Do not assign GPC.
Do not classify transaction intent.
Do not decide the final semantic resolution.
```

---

# 10. Resolution Decision Prompt

## Responsibility

This prompt makes the semantic decision after candidates and evidence are available.

It is the **semantic adjudicator**, not the taxonomy or intent engine.

```text
TASK: SELECT THE BEST SEMANTIC RESOLUTION

EXPRESSION:
{{expression}}

CANDIDATES:
{{candidates}}

CONTEXT:
{{context}}

EVIDENCE:
{{evidence}}

Evaluate the candidate meanings.

Determine:

1. Which candidate is best supported?
2. Whether the evidence is sufficient for RESOLVED status.
3. Whether multiple materially different candidates remain plausible.
4. Whether the ambiguity can be resolved from context/evidence.
5. Whether one clarification question is necessary.

Prefer the interpretation with the strongest combined support from:

- linguistic fit
- contextual fit
- commercial usage
- regional usage
- evidence quality
- functional fit
- named-entity consistency

Do not choose a candidate simply because it maps neatly to a taxonomy.

Do not invent missing product characteristics.

If one candidate clearly dominates:

    resolution_status = RESOLVED

If materially different interpretations remain:

    resolution_status = AMBIGUOUS

If the expression remains uninterpretable:

    resolution_status = UNRESOLVED

If the message contains multiple independent objects:

    resolution_status = COMPOSITE

Return the decision and the evidence basis.
```

---

# 11. Context Resolution Prompt

## Responsibility

Context resolution identifies **non-object information that helps interpret objects**.

It does not own transaction intent and does not turn context into matching decisions.

```text
TASK: RESOLVE COMMERCIAL CONTEXT

MESSAGE:
{{message}}

OBJECTS:
{{objects}}

CONVERSATION CONTEXT:
{{conversation_context}}

Identify contextual elements relevant to semantic interpretation.

Possible context types:

- VENUE
- FUNCTIONAL_CONTEXT
- USE_CONTEXT
- REGIONAL_CONTEXT
- EXPLICIT_LOCATION_CONTEXT
- COMMERCIAL_CONTEXT
- OBJECT_RELATIONSHIP
- QUALIFIER
- OTHER_CONSTRAINT

For venues, distinguish between:

    venue expression
    canonical venue concept
    venue type

Examples:

    bookshop → bookstore → RETAIL_VENUE
    pharmacy → pharmacy → RETAIL_VENUE
    hardware store → hardware store → RETAIL_VENUE

For functional context:

    "hammer and nails for roofing"

    roofing → FUNCTIONAL_CONTEXT

Do not convert functional context into an object unless the language explicitly
requests or denotes that object.

For relationships, identify relations such as:

- used_for
- accessory_of
- applies_to
- part_of
- sold_at
- located_at
- associated_with

Do not infer transaction intent.
Do not select vendors.
Do not perform GPC mapping.
```

---

# 12. Commercial Interpretation Prompt

## Responsibility

This component determines whether a resolved referent has meaningful commercial relevance **in the current context**.

It does not classify taxonomy and does not infer transaction intent.

```text
TASK: DETERMINE COMMERCIAL INTERPRETATION

RESOLVED REFERENT:
{{resolved_referent}}

CONTEXT:
{{context}}

EVIDENCE:
{{evidence}}

Determine whether the resolved referent represents a commercially meaningful
offering or commercial concept in the current context.

Ask:

    Can this referent meaningfully be bought, sold, supplied, stocked,
    hired, commissioned, delivered, requested, traded, or offered as a
    commercial capability/service?

Possible commercial classifications:

- DIRECT_PRODUCT
- DIRECT_SERVICE
- COMMERCIAL_CATEGORY
- COMMERCIAL_MATERIAL
- COMMERCIAL_RESOURCE
- COMMERCIAL_CAPABILITY
- COMMERCIAL_ENTITY
- NON_COMMERCIAL
- UNKNOWN

IMPORTANT:

Do not infer commercial relevance solely from entity type.

A BOOK may be commercial if the referent is a book sold in commerce.
A PERSON may be mentioned without the person being the commercial object.
A BRAND may identify a commercially relevant offering.
A TITLE may identify a commercial book/movie/product or a non-commercial idea.
A CATEGORY may be commercially relevant without being an individual product.

Return:

- commercial_relevance
- commercial_offering boolean
- commercial_offering_reason
- confidence

Do not assign GPC.
Do not infer BUY/SELL/etc.
```

---

# 13. Clarification Prompt

## Responsibility

This component converts unresolved material ambiguity into **one high-information question**.

It does not redesign the user interaction or ask multiple questions.

```text
TASK: GENERATE ONE CLARIFICATION QUESTION

EXPRESSION:
{{expression}}

TOP CANDIDATES:
{{candidates}}

CONTEXT:
{{context}}

EVIDENCE:
{{evidence}}

Determine whether the remaining ambiguity materially affects the semantic
resolution.

If the answer can be safely resolved from evidence, do not ask a question.

If clarification is necessary, generate EXACTLY ONE question that best
distinguishes the leading interpretations.

Prefer asking about:

- function
- intended use
- commercial object type
- local meaning
- distinguishing characteristic

Do NOT ask:

    "What do you mean?"

Do NOT ask:

    "What is the canonical product name?"

Do NOT ask more than one thing.

The question must sound natural to an ordinary user.
```

---

# 14. Canonicalization Prompt

## Responsibility

Canonicalization converts an already resolved referent into the stable downstream representation.

It does not revisit taxonomy or transaction intent.

```text
TASK: CREATE CANONICAL REPRESENTATION

ORIGINAL EXPRESSION:
{{original_expression}}

RESOLVED REFERENT:
{{resolved_referent}}

DEFINITION:
{{definition}}

COMMERCIAL INTERPRETATION:
{{commercial_interpretation}}

CONTEXT:
{{context}}

EVIDENCE:
{{evidence}}

Create a stable canonical representation.

The canonical representation must:

- represent the underlying referent
- be independent of the user's exact wording
- be concise
- be semantically meaningful
- preserve the deepest level supported by evidence
- avoid unsupported specificity
- support downstream vectorization and matching

Preserve separately:

- original_expression
- semantic_origin.phrase
- semantic_origin.concept
- semantic_origin.market_concept_id
- canonical_form
- entity_type
- brand
- model
- attributes
- aliases
- functional_context
- venue/context
- relationships

Examples:

    "okrika"
        canonical_form = "second-hand clothing"

    "that machine wey dey seal nylon"
        canonical_form = "plastic bag heat sealer"

    "Bosch GWS 750"
        canonical_form = "angle grinder"
        brand = "Bosch"
        model = "GWS 750"

    "Peak milk"
        canonical_form = "milk"
        brand = "Peak"

Never discard the surface expression.
Never assign a GPC ID.
```

---

# 14A. Cognitive Multi-Entity Output Contract

For every message containing multiple independently resolvable objects, the output
MUST preserve object-level independence.

Required behavior:

```text
one message
    ↓
object_1 ──→ independent semantic resolution
object_2 ──→ independent semantic resolution
object_3 ──→ independent semantic resolution
             ...
shared context/relationships remain attached separately
```

The resolver MUST NOT:

- merge distinct objects because they share a category;
- merge products and services merely because they occur in one sentence;
- convert a venue into an object;
- convert functional context into an object;
- let one object's canonical form overwrite another object's meaning;
- infer that two objects are synonyms solely because they share a GPC family;
- discard less specific objects when more specific objects also exist.

The resolver MAY use one object's presence as contextual evidence for another object
when the linguistic relationship supports doing so.

### Example

Input:

> `I need a hammer, nails and electrical materials for roofing.`

Output conceptually:

```json
{
  "objects": [
    {
      "object_id": "object_1",
      "surface_form": "hammer",
      "canonical_form": "hammer"
    },
    {
      "object_id": "object_2",
      "surface_form": "nails",
      "canonical_form": "nails"
    },
    {
      "object_id": "object_3",
      "surface_form": "electrical materials",
      "canonical_form": "electrical materials"
    }
  ],
  "context": {
    "functional_context": ["roofing"]
  },
  "relationships": [
    {
      "type": "used_for",
      "context": "roofing",
      "objects": ["object_1", "object_2", "object_3"]
    }
  ]
}
```

Each object can subsequently receive a different downstream GPC classification.


# 15. Final Output Schema

The resolver's output remains semantic and commercial, while avoiding downstream taxonomy and intent responsibilities.

The authoritative object contract explicitly exposes the **CSRE-originated Phrase → Market Concept relationship**.

```json
{
  "resolution_status": "RESOLVED | AMBIGUOUS | UNRESOLVED | COMPOSITE | NON_REFERENTIAL",
  "original_message": "exact user message",
  "objects": [
    {
      "object_id": "object_1",

      "semantic_origin": {
        "phrase": "exact user expression/span resolved by CSRE",
        "concept": "resolved real-world concept",
        "market_concept_id": "mc_123 | null",
        "concept_status": "KNOWN | PROPOSED",
        "relationship": "EXPRESSES",
        "origin": "CSRE",
        "request_id": "string",
        "semantic_confidence": 0.0
      },

      "surface_form": "exact expression referring to this object",
      "canonical_form": "stable real-world representation",
      "entity_type": "PRODUCT | PRODUCT_CATEGORY | PRODUCT_SUBCATEGORY | SERVICE | BRAND | MODEL | BOOK | MOVIE | PLACE | MATERIAL | EQUIPMENT | TOOL | MACHINE | FOOD | MEDICINE | VEHICLE | SOFTWARE | PERSON | ORGANIZATION | ACTIVITY | CAPABILITY | CONCEPT | OTHER",
      "definition": "concise definition of the resolved referent",
      "brand": null,
      "model": null,
      "attributes": {},
      "aliases": [],

      "commercial_interpretation": {
        "relevance": "DIRECT_PRODUCT | DIRECT_SERVICE | COMMERCIAL_CATEGORY | COMMERCIAL_MATERIAL | COMMERCIAL_RESOURCE | COMMERCIAL_CAPABILITY | COMMERCIAL_ENTITY | NON_COMMERCIAL | UNKNOWN",
        "commercial_offering": false,
        "reason": "why the resolved referent is or is not commercially relevant",
        "confidence": 0.0
      },

      "confidence": {
        "semantic_resolution": 0.0,
        "commercial_relevance": 0.0
      },

      "ambiguity": {
        "present": false,
        "remaining_candidates": []
      },

      "functional_context": [],
      "relationships": []
    }
  ],

  "context": {
    "venues": [],
    "regional_context": {
      "country": "Nigeria",
      "region": null,
      "regional_terms": [],
      "regional_interpretation_used": false
    },
    "functional_context": [],
    "location_context": null,
    "qualifiers": []
  },

  "clarification": {
    "required": false,
    "question": null
  },

  "evidence": []
}
```

### Semantic-origin contract

For every independently resolved object:

```text
semantic_origin.phrase
    ↓
semantic_origin.relationship = EXPRESSES
    ↓
semantic_origin.concept
    ↓
semantic_origin.market_concept_id
```

`market_concept_id = null` is valid when the concept is newly proposed and has not yet been assigned a durable Market Concept identifier by the Market Knowledge layer.

`concept_status = PROPOSED` means:

> CSRE resolved a commercially or semantically meaningful concept that is not yet present in the supplied Market Concept Scheme.

It does **not** mean that the concept is permanently established.

The Evidence System and Market Knowledge Graph determine whether the proposed concept and its relationships become durable knowledge.

### Important schema rule

There is deliberately **no `intent` field** and **no `gpc_mapping` field** in the authoritative CSRE output.

Those belong to other components.

CSRE is responsible for producing the semantic origin record that downstream components can consume without reconstructing the phrase/concept relationship.

---

# 16. Responsibility of Supporting Components

This section is part of the specification and should be treated as an explicit separation-of-concerns contract.

| Component | Owns | Does NOT Own |
|---|---|---|
| **Conversation OS** | conversation state, rail, invocation, user-facing interaction | semantic truth, taxonomy |
| **CSRE** | expression segmentation, object extraction, referent resolution, semantic context, commercial interpretation, canonicalization | intent, GPC, enrichment, matching |
| **WRS** | external evidence retrieval, source ranking, provenance packaging | final semantic decision or durable evidence state |
| **Evidence System** | evidence persistence, fusion, beliefs, graph learning | live semantic resolution |
| **Intent Resolver** | BUY/SELL/FIND/PRICE/AVAILABILITY/etc. | what the object is |
| **Taxonomy Resolver / GPC Mapper** | GPC/SKOS classification | semantic interpretation of arbitrary user language |
| **Enrichment/Hydration Engine** | aliases, functional attributes, search-oriented enrichment, taxonomy-supporting hydration | primary referent resolution |
| **Capability Projection module** | vendor capability representation and capability graph projection | raw-language semantic resolution |
| **Matching & Fanout module** | vendor retrieval, scoring, ranking, fanout decisions | defining what the user meant |
| **Evidence Graph** | interaction outcomes and commercial evidence persistence | live semantic resolution |

---

# 17. Recommended Invocation Policy

The system should not invoke every supporting prompt on every message.

### Fast path

Use one CSRE invocation when:

- expression is familiar
- context is sufficient
- ambiguity is low
- no external evidence is required

### Evidence path

Invoke evidence retrieval when:

- expression is unfamiliar
- local usage is unknown
- evidence can materially distinguish candidates
- current knowledge is insufficient

Then return evidence to the resolver for final adjudication.

### Clarification path

Invoke the clarification component only when:

- material ambiguity remains after available evidence
- one question can significantly reduce uncertainty

### Composite path

For multi-object messages, resolve each object while preserving their relationships and shared context.

---

# 18. Canonicalization Rules for Production

These rules are mandatory.

## Preserve the user's surface form

Always retain the exact user expression for auditability, lexicon learning, and future resolution.

## Resolve to a real-world referent

```text
"okrika"
→ "second-hand clothing"
```

## Do not force every thing into a product

```text
"plumbing"
→ service/domain/capability depending on context
```

## Preserve brands

```text
"Peak milk"
→ canonical_form: "milk"
→ brand: "Peak"
```

## Preserve models

```text
"Bosch GWS 750"
→ canonical_form: "angle grinder"
→ brand: "Bosch"
→ model: "GWS 750"
```

## Preserve meaningful attributes

```text
"red plastic bucket"
→ canonical_form: "plastic bucket"
→ attributes.color: "red"
```

## Do not invent attributes

```text
"grinder"
≠ automatically "electric angle grinder"
```

## Preserve specificity

```text
"angle grinder"
≠ "tool"
```

unless actual ambiguity requires a broader representation.

---

# 19. Multi-Object Examples

## Example A — Mixed product/category request

Input:

> `I need a hammer, nails and electrical materials`

Expected semantic structure:

```text
object 1:
    hammer
    → hammer

object 2:
    nails
    → nails

object 3:
    electrical materials
    → electrical materials
    type = PRODUCT_CATEGORY
```

No single combined product should be created.

## Example B — Vendor capability expression

Input:

> `I sell phones, chargers and electrical stuff`

Expected:

```text
phone category
charger category/product concept
electrical category
```

The resolver identifies the commercial objects. The downstream Capability Projection module decides how to expand those capabilities.

## Example C — Functional context

Input:

> `I need a hammer and nails for roofing`

Expected:

```text
objects:
  hammer
  nails

functional_context:
  roofing

relationships:
  roofing applies_to hammer/nails
```

## Example D — Venue constraint

Input:

> `Do you know a bookshop that sells Where Is God When It Hurts?`

Expected:

```text
object:
  canonical_form = "Where Is God When It Hurts?"
  entity_type = BOOK

venue:
  canonical_venue = "bookstore"
  venue_type = RETAIL_VENUE
```

Transaction intent remains the responsibility of the Intent Resolver.

## Example E — Commercial/non-commercial distinction

Input:

> `Where is God when it hurts?`

Could resolve as:

```text
referent = philosophical/theological question
commercial_relevance = NON_COMMERCIAL
```

Whereas:

> `Where Is God When It Hurts?`

in a book-buying context may resolve as:

```text
referent = published book
commercial_relevance = DIRECT_PRODUCT
```

The difference is semantic/contextual interpretation, not merely capitalization.

---

# 20. What the Resolver Must Never Do

1. Never invent a product because a phrase is vague.
2. Never fabricate a GPC code.
3. Never force a canonical representation into an available taxonomy node.
4. Never treat brand as the product form when the user means the product.
5. Never discard model numbers.
6. Never discard the surface expression.
7. Never collapse multiple objects into one concept.
8. Never turn functional context into a requested object unless the language says so.
9. Never treat venue as the requested object when it is a context constraint.
10. Never let taxonomy confidence contaminate semantic confidence.
11. Never infer transaction intent as part of the canonical product concept.
12. Never ask more than one clarification question for the same unresolved turn.
13. Never manufacture certainty from an unfamiliar local term.
14. Never rely on a single weak external source when stronger contradictory evidence exists.

---

# 21. Production Design Principle

The resolver should be judged by one primary question:

> **Can materially different human expressions that refer to the same real-world thing converge reliably on the same canonical representation, while expressions that refer to different things remain distinguishable?**

Examples:

```text
hot flask
thermos
thermal flask
        ↓
VACUUM FLASK
```

```text
okrika
bend down select
second-hand clothes
        ↓
SECOND-HAND CLOTHING
```

```text
Bosch GWS 750
        ↓
ANGLE GRINDER
brand = Bosch
model = GWS 750
```

The resolver's value is therefore **semantic convergence without semantic collapse**.

---

# 22. Final Architecture

```text
                         RAW MESSAGE
                              │
                              ▼
                  ┌───────────────────────┐
                  │ Conversation OS       │
                  │ supplies context      │
                  └───────────┬───────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │ Commercial Semantic    │
                  │ Resolution Engine      │
                  │                       │
                  │ 1. Segment            │
                  │ 2. Extract objects    │
                  │ 3. Generate candidates│
                  │ 4. Resolve context   │
                  │ 5. Resolve referents │
                  │ 6. Commercial meaning│
                  │ 7. Canonicalize      │
                  └───────────┬───────────┘
                              │
                ┌─────────────┼─────────────┐
                │             │             │
                ▼             ▼             ▼
          Intent Resolver  GPC/Taxonomy  Enrichment
                │             │             │
                └─────────────┼─────────────┘
                              ▼
                     Capability / Matching
                              │
                              ▼
                       Evidence Graph
```

External evidence sits beside the resolver rather than inside its core responsibility:

```text
                   ┌────────────────────┐
                   │ WRS                │
                   │ external evidence  │
                   │ + provenance       │
                   └─────────┬──────────┘
                             │
                             ▼
                     CSRE uses evidence
```

This keeps the resolver **small in responsibility but deep in semantic capability**.

---

# 23. Final Rule

> **The Commercial Semantic Resolution Engine exists to understand messy human expressions exceptionally well and turn them into stable real-world referents.**

It should be excellent at:

```text
language
→ objects
→ context
→ meaning
→ referents
→ commercial interpretation
→ canonical representation
```

It should stop there.

Everything after that belongs to the appropriate downstream specialist:

```text
canonical representation
→ intent
→ taxonomy
→ enrichment
→ capability expansion
→ matching
→ ranking
→ evidence learning
```

That separation is intentional. It allows the resolver to become exceptionally strong at the hardest part of the problem—**understanding what people actually mean in the messy real world**—without allowing downstream representation systems to distort that meaning.


---

# 24. Cognitive Multi-Entity Extraction Acceptance Tests

The implementation should pass at least these semantic decomposition tests.

## Test 1 — Multiple products

Input:

> `I sell rice, vegetable oil, Indomie and detergent.`

Expected: four independently resolvable objects.

## Test 2 — Product + category mixture

Input:

> `I need a hammer, nails and electrical materials.`

Expected: three independent objects with mixed granularity.

## Test 3 — Category hierarchy

Input:

> `I sell building materials, plumbing, electricals, wall sockets and conduit pipes.`

Expected: five objects, including category/domain/service-or-capability concepts where
supported; do not flatten them into products.

## Test 4 — Shared functional context

Input:

> `I need a hammer and nails for roofing.`

Expected: two objects + `roofing` as functional context.

## Test 5 — Venue constraint

Input:

> `Find me a pharmacy that sells malaria medicine and pain killers.`

Expected: two product objects + pharmacy as venue.

## Test 6 — Object/service relationship

Input:

> `I sell phones and repair them.`

Expected: phone object + repair service/capability + `repair applies_to phones`.

## Test 7 — Brand/product decomposition

Input:

> `I need Peak milk and Indomie.`

Expected: two objects, with brand preserved on the relevant object.

## Test 8 — Unknown local terms

Input:

> `I sell iron sponge, bend down select and other things.`

Expected: locally meaningful objects where supported; unresolved residue must not become a
fabricated product.

## Test 9 — Independent ambiguity

Input:

> `I need a stabilizer and cable.`

Expected: two objects; ambiguity of `stabilizer` must not contaminate `cable`.

## Test 10 — Shared context with different objects

Input:

> `I need cement and a mixer for block making.`

Expected: two objects + `block making` as functional context.

## Acceptance criterion

A CMEE implementation passes when it can:

1. identify all independently resolvable objects;
2. preserve each object's source expression;
3. maintain object-level semantic independence;
4. preserve shared context and inter-object relationships;
5. avoid turning contextual language into false objects;
6. allow each object to proceed independently through downstream taxonomy/matching.


# 25. Locked Market Semantic Architecture

This section locks the CSRE contract introduced by the broader marketplace semantic architecture. All existing CSRE responsibilities, prompts, examples, and boundaries remain in force.

## 25.1 CSRE-Originated Phrase + Concept

CSRE is the **origin point of the platform's semantic Phrase → Concept relationship**.

For every resolved object, CSRE MUST preserve two distinct things:

```text
USER EXPRESSION / PHRASE
        ↓
CSRE SEMANTIC RESOLUTION
        ↓
RESOLVED MARKET CONCEPT
```

The phrase is the user's actual language. The concept is the stable real-world referent inferred from that language in context.

Example:

```text
phrase: "iron sponge"
concept: "steel wool / scouring pad"
```

The relationship MUST preserve:

- the exact source phrase;
- the resolved concept/canonical form;
- the object ID;
- semantic confidence;
- commercial interpretation;
- context used in the resolution;
- aliases/local terminology where known;
- whether the concept already exists in the platform's Market Concept Scheme or is a newly proposed concept;
- the resolution request/version that originated the relationship.

CSRE MAY reference an existing `market_concept_id` when one is supplied by the semantic knowledge layer. When no stable concept exists, CSRE may emit a **new concept proposal**. Durable persistence, validation, consolidation, contradiction handling, and lifecycle management remain the responsibility of the Evidence/Market Knowledge Graph layer.

### Required semantic distinction

```text
Phrase
  = what the user said

Concept
  = what the system resolved that phrase to mean

GPC
  = sovereign downstream classification of the concept
```

CSRE MUST NOT substitute a GPC node for the resolved concept.

## 25.2 Market Concept Scheme Boundary

The platform's evolving Market Concept Scheme is external to CSRE's core decision responsibility.

CSRE may:

- consume known concept identifiers and labels;
- propose a new concept when the message resolves to a commercially meaningful referent not yet represented;
- preserve Phrase → Concept relationships;
- use known concepts as resolution context.

CSRE does not:

- decide permanent concept lifecycle state;
- decide that repeated phrases are permanently equivalent without evidence policy;
- edit GPC;
- replace GPC with the market concept scheme.

The market concept scheme is the platform's evolving semantic vocabulary; GPC remains the sovereign classification backbone.

## 25.3 Output Contract Extension

The existing per-object output contract is extended with a semantic-origin record while preserving all existing fields:

```json
{
  "semantic_origin": {
    "phrase": "iron sponge",
    "concept": "steel wool / scouring pad",
    "market_concept_id": null,
    "concept_status": "KNOWN | PROPOSED",
    "origin": "CSRE",
    "request_id": "string",
    "semantic_confidence": 0.0
  }
}
```

`concept_status = PROPOSED` means CSRE resolved a commercially meaningful concept that is not yet known to the supplied Market Concept Scheme. It does not mean the concept is permanently established. Evidence and graph learning determine persistence and relationship strength.

## 25.4 Evidence-Aware Market Relationship Handoff

CSRE MUST expose enough structure for downstream learning systems to observe semantic relationships without turning CSRE into the learning store.

At minimum, downstream systems must be able to reconstruct:

```text
phrase
  └── resolved_to → concept

message
  └── contains → object

object
  ├── has_context → context
  └── participates_in → relationship
```

This enables the Evidence System to validate and accumulate market semantic knowledge from actual interactions.

---

# 26. Prompt Lock: Phrase → Concept Origin

The following rule is authoritative across the production prompts in this document:

```text
SEMANTIC ORIGIN RULE

For every independently resolved object, preserve:

1. the exact user phrase/surface form;
2. the resolved real-world concept;
3. the relationship between the phrase and concept;
4. the evidence/context that materially influenced the resolution;
5. whether the concept is already known or is a new concept proposal.

The Phrase → Concept relationship is a semantic output of CSRE.

Do not replace the concept with a GPC class, category, or vector-search result.
Do not discard the phrase after canonicalization.
Do not silently create durable market knowledge inside CSRE.
```

This rule supplements the existing Master System Prompt, Runtime Resolution Prompt, Canonicalization Prompt, CMEE Output Contract, and Final Output Schema.


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

# 27. IMPLEMENTATION INTEGRATION CONTRACT — v5

This section is authoritative for cross-component interoperability and supplements, without removing,
the earlier CSRE requirements and prompts.

## 27.1 Canonical wire-format convention

CSRE JSON uses **snake_case**. TypeScript domain models may use camelCase internally, but the serialized
wire contract MUST use the exact JSON names defined below.

The canonical top-level response fields are:

```text
schema_version
request_id
resolution_status
original_message
objects
context
clarification
evidence
```

`request_id` is mandatory and MUST remain stable across CSRE retries for the same resolution request.

## 27.2 Canonical CSRE response schema

The following JSON Schema is the machine-enforceable contract for CSRE output.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/csre-resolution-v5.json",
  "title": "CSRE Resolution v5",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "request_id",
    "resolution_status",
    "original_message",
    "objects",
    "context",
    "clarification",
    "evidence"
  ],
  "properties": {
    "schema_version": { "const": "5.0" },
    "request_id": { "type": "string", "minLength": 1 },
    "resolution_status": {
      "enum": ["RESOLVED", "AMBIGUOUS", "UNRESOLVED", "COMPOSITE", "NON_REFERENTIAL"]
    },
    "original_message": { "type": "string" },
    "objects": {
      "type": "array",
      "items": { "$ref": "#/$defs/object" }
    },
    "context": { "$ref": "#/$defs/context" },
    "clarification": { "$ref": "#/$defs/clarification" },
    "evidence": {
      "type": "array",
      "items": { "$ref": "#/$defs/evidenceRef" }
    }
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
        "phrase": { "type": "string", "minLength": 1 },
        "concept": { "type": "string", "minLength": 1 },
        "market_concept_id": { "type": ["string", "null"] },
        "concept_status": { "enum": ["KNOWN", "PROPOSED"] },
        "relationship": { "const": "EXPRESSES" },
        "origin": { "const": "CSRE" },
        "request_id": { "type": "string", "minLength": 1 },
        "semantic_confidence": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "commercialInterpretation": {
      "type": "object",
      "additionalProperties": false,
      "required": ["relevance", "commercial_offering", "reason", "confidence"],
      "properties": {
        "relevance": {
          "enum": [
            "DIRECT_PRODUCT",
            "DIRECT_SERVICE",
            "COMMERCIAL_CATEGORY",
            "COMMERCIAL_MATERIAL",
            "COMMERCIAL_RESOURCE",
            "COMMERCIAL_CAPABILITY",
            "COMMERCIAL_ENTITY",
            "NON_COMMERCIAL",
            "UNKNOWN"
          ]
        },
        "commercial_offering": { "type": "boolean" },
        "reason": { "type": "string" },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "object": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "object_id",
        "semantic_origin",
        "surface_form",
        "canonical_form",
        "entity_type",
        "definition",
        "brand",
        "model",
        "attributes",
        "aliases",
        "commercial_interpretation",
        "confidence",
        "ambiguity",
        "functional_context",
        "relationships"
      ],
      "properties": {
        "object_id": { "type": "string", "minLength": 1 },
        "semantic_origin": { "$ref": "#/$defs/semanticOrigin" },
        "surface_form": { "type": "string", "minLength": 1 },
        "canonical_form": { "type": "string", "minLength": 1 },
        "entity_type": { "type": "string", "minLength": 1 },
        "definition": { "type": "string" },
        "brand": { "type": ["string", "null"] },
        "model": { "type": ["string", "null"] },
        "attributes": { "type": "object" },
        "aliases": { "type": "array", "items": { "type": "string" } },
        "commercial_interpretation": { "$ref": "#/$defs/commercialInterpretation" },
        "confidence": {
          "type": "object",
          "additionalProperties": false,
          "required": ["semantic_resolution", "commercial_relevance"],
          "properties": {
            "semantic_resolution": { "type": "number", "minimum": 0, "maximum": 1 },
            "commercial_relevance": { "type": "number", "minimum": 0, "maximum": 1 }
          }
        },
        "ambiguity": {
          "type": "object",
          "additionalProperties": false,
          "required": ["present", "remaining_candidates"],
          "properties": {
            "present": { "type": "boolean" },
            "remaining_candidates": { "type": "array", "items": { "type": "object" } }
          }
        },
        "functional_context": { "type": "array" },
        "relationships": { "type": "array" }
      }
    },
    "context": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "venues",
        "regional_context",
        "functional_context",
        "location_context",
        "qualifiers"
      ],
      "properties": {
        "venues": { "type": "array" },
        "regional_context": { "type": "object" },
        "functional_context": { "type": "array" },
        "location_context": {},
        "qualifiers": { "type": "array" }
      }
    },
    "clarification": {
      "type": "object",
      "additionalProperties": false,
      "required": ["required", "question"],
      "properties": {
        "required": { "type": "boolean" },
        "question": { "type": ["string", "null"] }
      }
    },
    "evidenceRef": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "evidence_id": { "type": "string" },
        "source": { "type": "string" },
        "claim": { "type": "string" }
      }
    }
  }
}
```

## 27.3 CSRE prompt/output binding

Every structured CSRE prompt MUST be bound at runtime to `csre-resolution-v5.json`.
The implementation MUST reject or repair only schema-invalid serialization; semantic meaning MUST NOT
be invented during repair.

The prompt MUST instruct the model to:

```text
Return exactly one JSON object conforming to csre-resolution-v5.
Do not add fields not defined by the schema.
Do not omit required fields.
Use null where the schema explicitly permits null.
Never emit markdown fences around the JSON.
```

## 27.4 Input interoperability with MCOS / LangGraph

CSRE receives a logical turn context assembled by MCOS/LangGraph. The input MUST include,
where available:

```text
request_id
conversation_id
turn_id
ordered current messages
assembled logical-turn text
relevant prior context
active/suspended workflow context
language/locale hints
location/venue context
```

CSRE MUST NOT infer turn assembly itself. MCOS Turn Assembly remains authoritative.

## 27.5 Evidence handoff

When CSRE has material evidence supporting or challenging a resolution, it may return evidence references,
but durable evidence ingestion occurs through the Evidence System.

A CSRE semantic-origin observation MUST be reconstructable as:

```text
request_id
turn_id
object_id
semantic_origin.phrase
semantic_origin.concept
semantic_origin.market_concept_id
semantic_origin.concept_status
context
```

## 27.6 Clarification handoff

CSRE may produce only a recommendation. It never sends the question.

```text
CSRE
  ↓
clarification recommendation
  ↓
LangGraph decision
  ↓
Response Composer
  ↓
MCOS Delivery
  ↓
User
```

## 27.7 Downstream contract

```text
CSRE v5
  ↓ exact object contract
Enrichment v4
  ↓ enriched object contract
GPC Resolver v4
  ↓ mapping fact
Evidence System v4
  ↓ belief / graph decision
Matching & Fanout / downstream marketplace systems
```

The `object_id` and `semantic_origin` fields are stable correlation keys across this chain.

---

# 28. STRUCTURED PROMPT OUTPUT CONTRACTS

All CSRE prompts that return structured data MUST use explicit schemas. The final resolver schema
defined in Section 27 is the canonical external wire contract. Internal prompts use the following
typed contracts and are normalized into that final contract.

## 28.1 Candidate Generation output

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/csre-candidate-set-v5.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["candidates"],
  "properties": {
    "candidates": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "candidate_id",
          "meaning",
          "entity_type",
          "definition",
          "supporting_evidence",
          "contradicting_evidence",
          "plausibility"
        ],
        "properties": {
          "candidate_id": {"type": "string"},
          "meaning": {"type": "string"},
          "entity_type": {"type": "string"},
          "definition": {"type": "string"},
          "supporting_evidence": {"type": "array"},
          "contradicting_evidence": {"type": "array"},
          "plausibility": {"type": "number", "minimum": 0, "maximum": 1}
        }
      }
    }
  }
}
```

## 28.2 Context Resolution output

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/csre-context-v5.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["context", "relationships"],
  "properties": {
    "context": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "venues",
        "regional_context",
        "functional_context",
        "location_context",
        "qualifiers"
      ],
      "properties": {
        "venues": {"type": "array"},
        "regional_context": {"type": "object"},
        "functional_context": {"type": "array"},
        "location_context": {},
        "qualifiers": {"type": "array"}
      }
    },
    "relationships": {"type": "array"}
  }
}
```

## 28.3 Commercial Interpretation output

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/csre-commercial-interpretation-v5.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["relevance", "commercial_offering", "reason", "confidence"],
  "properties": {
    "relevance": {"type": "string"},
    "commercial_offering": {"type": "boolean"},
    "reason": {"type": "string"},
    "confidence": {"type": "number", "minimum": 0, "maximum": 1}
  }
}
```

## 28.4 Clarification output

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/csre-clarification-v5.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["required", "question"],
  "properties": {
    "required": {"type": "boolean"},
    "question": {"type": ["string", "null"]}
  }
}
```

## 28.5 Canonicalization / resolution decision output

The canonicalization and resolution decision prompts MUST normalize into the final
`csre-resolution-v5.json` object schema. They MUST NOT introduce a second wire-level schema.

## 28.6 Prompt selection rule

LangGraph MAY execute the CSRE prompts as a single optimized model call or as bounded specialist
calls. Regardless of execution strategy, only the normalized v5 CSRE response crosses the CSRE
component boundary.

---

## Cross-Stack Version Matrix

```text
CSRE v5.3 (wire v5.0)
  ↓ object_id + semantic_origin + semantic contract
Enrichment v4.3 (wire v4.0)
  ↓ object_id + preserved semantic_origin + enrichment features
GPC Resolver v4.3 (wire v4.0)
  ↓ object_id + mapping fact + GPC dataset version
Evidence System v4.3 (wire v4.0)
  ↔ WRS v4.3 (wire v4.0) evidence acquisition
  ↓ validated beliefs / graph decisions
Matching & Fanout / downstream matching
```

CSRE remains authoritative for referent identity. IDCE v1.5 remains authoritative for intent.
MCOS/LangGraph v4.3 remains authoritative for orchestration, turn assembly, clarification delivery,
routing, and execution control.


---

# 29. FINAL IMPLEMENTATION INTEGRATION CONTRACT — v5.2

This section is authoritative for the MCOS/LangGraph → CSRE input boundary and for
cross-component correlation. The existing `csre-resolution-v5.json` output wire schema
remains compatible and continues to use `schema_version = 5.0`; document/component version is 5.2.

## 29.1 Canonical CSRE service request

```typescript
export interface CSREServiceRequest {
  schemaVersion: '5.1';
  requestId: string;
  component: 'CSRE';
  componentVersion: '5.4';
  conversationId: string;
  turnId: string;
  contextSnapshotId: string;
  message: string;
  currentMessages: readonly object[];
  conversationContext: object;
  regionalContext: object;
  commercialContext: object;
  lexiconEvidence: readonly object[];
  externalEvidence: readonly object[];
  clarificationAnswers: readonly object[];
  policyVersion: string;
}
```

The serialized wire format is snake_case.

## 29.2 Machine-enforceable request schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/csre-service-request-v5.1.json",
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
    "message",
    "current_messages",
    "conversation_context",
    "regional_context",
    "commercial_context",
    "lexicon_evidence",
    "external_evidence",
    "clarification_answers",
    "policy_version"
  ],
  "properties": {
    "schema_version": { "const": "5.1" },
    "request_id": { "type": "string", "minLength": 1 },
    "component": { "const": "CSRE" },
    "component_version": { "const": "5.4" },
    "conversation_id": { "type": "string", "minLength": 1 },
    "turn_id": { "type": "string", "minLength": 1 },
    "context_snapshot_id": { "type": "string", "minLength": 1 },
    "message": { "type": "string" },
    "current_messages": { "type": "array" },
    "conversation_context": { "type": "object" },
    "regional_context": { "type": "object" },
    "commercial_context": { "type": "object" },
    "lexicon_evidence": { "type": "array" },
    "external_evidence": { "type": "array" },
    "clarification_answers": { "type": "array" },
    "policy_version": { "type": "string", "minLength": 1 }
  }
}
```

For normal LangGraph execution, `message` is the assembled logical-turn text. The ordered
`current_messages` field is preserved so CSRE can use transport boundaries as secondary context
without treating them as intent/object boundaries.

## 29.3 Request/output correlation

1. The service request `request_id` MUST be copied into the CSRE v5.0 output
   `semantic_origin.request_id` for every resolved object.
2. `turn_id` and `conversation_id` are orchestration correlation data and MUST remain available
   in the service envelope/telemetry even though they are not duplicated into the v5.0 semantic-origin
   wire schema.
3. Retries of the same request use the same `request_id`.
4. A new logical turn MUST receive a new `request_id`.
5. The output `object_id` is stable within a resolution request and is the identifier passed to
   Enrichment and GPC Resolver.

## 29.4 Authoritative input precedence

```text
assembled logical turn
    >
current ordered messages
    >
explicit clarification answers
    >
conversation context
    >
regional/commercial context
    >
external evidence
```

Historical or external context may constrain interpretation, but it MUST NOT silently replace the
current user expression.

## 29.5 Non-commercial and non-product handoff

CSRE MAY return valid semantic objects that are services, venues, materials, capabilities,
organizations, people, or non-commercial concepts. Downstream Enrichment/GPC processing MUST honor
`entity_type` and `commercial_interpretation` rather than assuming every object is a product.

---

# 30. NORMATIVE AGENDA COMPLETION — v5.3

**Effective:** 2026-09-10  
**Status:** Authoritative amendment. This section overrides any earlier wording in this document where the earlier wording implies that CSRE owns Market Knowledge Graph persistence, graph mutation, commercial relationship authority, vendor matching, taxonomy classification, or evidence persistence.

## 30.1 Final responsibility boundary

CSRE remains the authority for **semantic referent resolution**. It creates or resolves the `Phrase → MarketConcept` identity used by the downstream stack. The standalone **Market Knowledge Graph (MKG)** is now the authority for durable commercial relationships and graph state.

CSRE may:
- propose a new MarketConcept;
- resolve a phrase to an existing MarketConcept when supplied with a stable identity;
- preserve relationships observed inside the user expression as semantic/contextual information;
- request external evidence through WRS when materially necessary;
- emit provenance sufficient for Evidence to record a semantic-origin observation.

CSRE MUST NOT:
- mutate MKG persistence directly;
- decide whether a commercial relationship becomes durable graph truth;
- assign graph belief scores;
- classify GPC;
- perform vendor matching/ranking/fanout.

## 30.2 Stable downstream contract

The canonical cross-component semantic handoff is:

```text
Raw expression
  ↓
CSRE
  ↓
Phrase + MarketConcept[] + object relationships + provenance
  ↓
Semantic Enrichment
  ↓
GPC Resolver
  ↓
MKG / Evidence
```

The `MarketConcept` emitted by CSRE remains the semantic identity. A GPC node is a classification reference, not a replacement identity.

## 30.3 Market relationship evidence handoff

When CSRE observes potentially reusable commercial semantics such as local terminology or phrase-to-concept relationships, it emits an **observation** to Evidence. Evidence evaluates it and may recommend a graph change to MKG. CSRE does not write the resulting graph relationship.

## 30.4 Multi-object invariant

All existing CMEE and multi-object requirements remain unchanged. Each object keeps its own `object_id`, semantic identity, evidence lineage, and downstream linkage. Shared context may be represented as context/relationship data without merging distinct objects.



# 31. NORMATIVE AGENDA COMPLETION — v5.4 CONTRACT + MARKET-LANGUAGE HARDENING

**Effective:** 2026-09-12  
**Status:** Authoritative amendment. Earlier design content remains preserved for traceability. This section governs implementation where earlier contract/version examples conflict.

## 31.1 Final CSRE component contract identity

```text
component               = CSRE
component_version       = 5.4
request schema_version  = 5.1
response schema_version = 5.0
wire serialization      = snake_case
```

The `component_version` is the deployed CSRE component version. The wire schema versions MUST NOT be changed merely because the component version changes.

## 31.2 Final CSRE adapter boundary

MCOS/LangGraph MUST call CSRE through a dedicated `CSREAdapter` implementing the following canonical transformation:

```text
LangGraph LogicalTurnInput
        ↓
CSREAdapter
        ↓
CSREServiceRequest
```

Authoritative field mapping:

```text
assembled_text            → message
messageIds/currentMessages → current_messages
conversation context      → conversation_context
regional context          → regional_context
commercial context        → commercial_context
lexical evidence          → lexicon_evidence
external evidence         → external_evidence
clarification answers     → clarification_answers
policy/version context    → policy_version
```

The adapter MUST inject `component = "CSRE"`, `component_version = "5.4"`, and preserve `request_id`, `conversation_id`, `turn_id`, and `context_snapshot_id`.

MCOS's orchestration envelope is internal to MCOS; it MUST NOT be passed verbatim as the CSRE business request when the CSRE schema does not define those envelope fields.

## 31.3 Response normalization

The adapter MUST validate the CSRE `csre-resolution-v5` payload before projecting it into MCOS `SpecialistResponseEnvelope<CSREResolution>`.

```text
CSRE resolution_status / response
        ↓ schema validation
CSREAdapter
        ↓ normalization
SpecialistResponseEnvelope.status/output
```

No missing specialist field may be silently converted into a guessed semantic result.

## 31.4 Market-language grounding

CSRE MAY consume Evidence/MKG-derived language knowledge as supporting context, but CSRE's current-turn semantic decision remains authoritative for the current request.

Market-language knowledge SHOULD distinguish:

- phrase;
- intended MarketConcept;
- geographic scope;
- speaker/source type;
- confidence/belief;
- evidence IDs;
- alternative interpretations;
- last observed time.

Model memory alone MUST NOT be presented as marketplace observation.

## 31.5 MarketConcept-first invariant

A resolved `MarketConcept` remains the primary semantic identity for downstream commercial discovery. GPC, vector similarity, and graph proximity may support downstream processing but MUST NOT replace the CSRE-established referent.

## 31.6 Fast-path / deferred-classification compatibility

CSRE MUST return a usable MarketConcept result without requiring successful GPC classification. The absence or failure of GPC mapping MUST NOT invalidate a semantically valid CSRE result.
