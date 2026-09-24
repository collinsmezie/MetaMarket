# Web Retrieval System — Integrated Market Evidence Architecture v4.4

> This revision hardens consumer-specific evidence contracts, relationship-targeted evidence, and interoperability with CSRE, Enrichment, GPC Resolver, and the Evidence System.

# Web Retrieval System (WRS) v4.3
## Technical Design Requirements, Responsibility Contract, and Production Prompts

## 1. Purpose

The Web Retrieval System (WRS) is a shared evidence-acquisition capability for components that need externally grounded information.

Its core responsibility is:

> Given a structured evidence request from another component, retrieve relevant external information, evaluate source quality and consistency, extract decision-useful evidence, identify contradictions, preserve provenance, and return the result in the contract requested by the calling component.

WRS is **not** a semantic resolver, taxonomy classifier, enrichment engine, intent engine, or matching engine.

It supplies evidence to those components; it does not silently make their final decisions.

---

## 2. Scope of Responsibility

### WRS owns

- Web/external information retrieval.
- Query formulation and query expansion.
- Source discovery.
- Source quality and relevance evaluation.
- Evidence extraction.
- Evidence normalization.
- Candidate-support and candidate-contradiction reporting.
- Geographic/locality relevance evaluation.
- Temporal/currentness evaluation where relevant.
- Source provenance.
- Evidence confidence/contribution.
- Consumer-specific evidence packaging.
- Deduplication of equivalent evidence across sources.
- Clear separation of evidence from inference.

### WRS does not own

- Final semantic resolution.
- Canonical form selection.
- Buy/sell/price/availability intent.
- GPC classification.
- GPC code selection.
- Capability graph construction.
- Vendor matching.
- Vendor ranking.
- Final enrichment decisions.
- Permanent commercial truth without an explicit downstream persistence/validation process.

---

## 3. Architectural Principle: WRS Is Consumer-Aware

Different consumers require different evidence.

Therefore WRS must not expose one universal semantic answer format as its only response.

Every request MUST identify:

```json
{
  "consumer": {
    "component": "CSRE | ENRICHMENT | GPC_RESOLVER | MKG | MATCHING_FANOUT | OTHER",
    "version": "string",
    "purpose": "string"
  },
  "evidence_request": {
    "question": "string",
    "context": {},
    "candidates": [],
    "relationship_target": null,
    "evidence_requirements": [],
    "requested_fields": [],
    "output_contract": {}
  }
}
```

WRS must satisfy the caller's requested payload while preserving the stable evidence/provenance envelope.

---

## 4. Stable Response Envelope

Every successful WRS response SHOULD use a stable outer structure:

```json
{
  "request_id": "string",
  "consumer": {
    "component": "string",
    "version": "string",
    "purpose": "string"
  },
  "task_type": "string",
  "status": "SUCCESS | PARTIAL | NO_RELIABLE_EVIDENCE | ERROR",

  "evidence": [
    {
      "evidence_id": "string",
      "claim": "string",

      "supports": ["candidate-or-field-id"],
      "contradicts": ["candidate-or-field-id"],

      "relationship_target": {
        "subject_id": "string|null",
        "predicate": "string|null",
        "object_id": "string|null",
        "object_type": "string|null"
      },

      "quote": "short supporting excerpt when useful",
      "source_id": "string",
      "source_url": "string",
      "source_title": "string",
      "source_type": "manufacturer | retailer | government | standards | publication | marketplace | forum | other",
      "geographic_relevance": "HIGH | MEDIUM | LOW | UNKNOWN",
      "temporal_relevance": "CURRENT | HISTORICAL | UNKNOWN",
      "quality": "HIGH | MEDIUM | LOW",
      "confidence": 0.0
    }
  ],

  "findings": [],
  "contradictions": [],
  "sources": [],

  "confidence": {
    "overall": 0.0,
    "evidence_quality": 0.0,
    "evidence_consistency": 0.0
  },

  "payload": {}
}
```

### Relationship-target rule

When evidence concerns a relationship rather than a node, WRS MUST identify that relationship explicitly.

Examples:

```text
Phrase → EXPRESSES → MarketConcept
Concept → SUBSTITUTE_FOR → Concept
Concept → COMMONLY_SOLD_WITH → Concept
Vendor → SUPPLIES → Concept
Buyer → REQUESTED → Concept
```

WRS retrieves evidence for the relationship. It does not turn the retrieved relationship into durable market truth.

---

# 5. Evidence Versus Inference

WRS MUST distinguish:

- **Observed evidence:** directly supported by a source.
- **Cross-source finding:** a conclusion supported by multiple sources.
- **Inference:** a reasoned interpretation that is not directly stated by a source.
- **Unresolved:** evidence is insufficient.

WRS must never present an inference as direct source fact.

---

## 6. Retrieval Strategy

WRS should retrieve progressively:

1. Direct/high-confidence queries.
2. Query expansion using synonyms, aliases, spelling variants, local terminology, and relevant context.
3. Local/Nigerian queries where the request is geographically specific.
4. Candidate-disambiguation queries when multiple interpretations exist.
5. Deeper targeted retrieval only when evidence remains insufficient.

Do not search merely because a term is unusual.

Search when retrieval is likely to materially change confidence or fill a required evidence field.

---

## 7. Source Evaluation

A source should be evaluated against:

- directness to the question,
- authority for the claim,
- geographic relevance,
- temporal relevance,
- specificity,
- consistency with other sources,
- evidence of actual commercial usage,
- whether it refers to the same entity/concept.

A high-ranking search result is not automatically high-quality evidence.

For product characteristics, prefer authoritative technical/manufacturer/standards sources where available.

For local terminology, direct local commercial usage may be more valuable than generic global sources.

For current commercial conditions, prioritize current sources.

---

## 8. Contradiction Handling

When credible sources disagree:

- preserve the disagreement;
- identify what each source claims;
- assess whether the disagreement is geographic, temporal, product-variant-specific, or genuine semantic ambiguity;
- do not arbitrarily collapse contradictory evidence;
- return the strongest supported interpretation only when the evidence clearly favors it.

---

## 9. Consumer Profiles

### 9.1 CSRE evidence profile

CSRE usually needs evidence for:

- what an expression means;
- local/Nigerian commercial usage;
- product/entity identity;
- candidate interpretation support;
- candidate interpretation contradictions;
- brand/product relationships;
- functional descriptions;
- evidence distinguishing competing meanings.

Suggested payload:

```json
{
  "payload": {
    "semantic_target": {
      "phrase": "string",
      "proposed_concept": "string",
      "relationship": "EXPRESSES",
      "market_concept_id": "string|null"
    },
    "supported_candidates": [],
    "rejected_or_weakened_candidates": [],
    "local_usage": [],
    "entity_relationships": [],
    "semantic_findings": []
  }
}
```

For CSRE evidence requests, WRS SHOULD return evidence specifically against the supplied
Phrase → Concept relationship.


### 9.2 Enrichment evidence profile

Enrichment usually needs evidence for:

- product/category definitions;
- distinguishing attributes;
- functions;
- use cases;
- materials/construction;
- commercially meaningful terminology;
- known synonyms;
- taxonomy-distinguishing characteristics;
- related and confusable concepts;
- hierarchical relationships when externally supported.

Suggested payload:

```json
{
  "payload": {
    "identity_facts": [],
    "functional_facts": [],
    "attribute_facts": [],
    "use_case_facts": [],
    "terminology": [],
    "distinguishing_facts": [],
    "confusable_concepts": [],
    "hierarchy_evidence": []
  }
}
```

### 9.3 Venue/context evidence profile

Venue-oriented consumers may request:

- canonical venue names;
- venue types;
- commercial role;
- geographic usage;
- distinctions between venue and product/entity meanings.

### 9.4 Future profiles

WRS MUST allow additional consumer profiles without redesigning the evidence engine.

---

# 10. Production Master System Prompt

```text
SYSTEM ROLE: WEB RETRIEVAL SYSTEM (WRS)

You are the Web Retrieval System.

Your responsibility is to acquire reliable external evidence for another software component.

You are an evidence acquisition and evidence evaluation component.
You are NOT the final semantic resolver, taxonomy classifier, intent resolver, enrichment engine, or matching engine.

Your task is to determine:

1. What information the requesting component actually needs.
2. What external evidence can answer that need.
3. Which sources support or contradict relevant claims.
4. How strong, direct, current, and geographically relevant that evidence is.
5. How to return the evidence in the output structure requested by the consumer.

CORE RULE:

Return evidence and evidence-grounded findings.
Do not silently make the consuming component's final decision.

==================================================
CONSUMER CONTRACT
==================================================

The caller provides:

- consumer component
- consumer purpose
- question/request
- context
- candidate interpretations where relevant
- required evidence fields
- requested output structure

Treat these as the contract for this retrieval task.

You may adapt retrieval and evidence extraction to satisfy the request, but do not change the consumer's semantic responsibility.

==================================================
RETRIEVAL OBJECTIVE
==================================================

Retrieve information that materially helps answer the request.

Do not retrieve broad information that does not support the requested decision.

Do not search merely because an expression is unusual.
Search when external information is likely to improve the result.

==================================================
QUERY STRATEGY
==================================================

Construct queries using the most informative combination of:

- exact expression
- aliases
- spelling variants
- phonetic variants
- local terminology
- Nigerian usage
- contextual terms
- candidate interpretations
- functional description
- product characteristics
- geographic constraints

Use multiple targeted queries when necessary.

==================================================
LOCAL / INFORMAL MARKET EVIDENCE
==================================================

When the task involves Nigerian or other local commerce:

- prefer evidence demonstrating actual local usage;
- preserve local terminology;
- distinguish local commercial meaning from generic dictionary meaning;
- do not infer a local meaning merely because a phrase looks informal;
- evaluate whether multiple local meanings exist.


==================================================
MARKET RELATIONSHIP EVIDENCE
==================================================

When the caller provides a relationship target, retrieve evidence for that relationship itself.

Examples:

Phrase → EXPRESSES → MarketConcept
Concept → SUBSTITUTE_FOR → Concept
Vendor → SUPPLIES → Concept
Buyer → REQUESTED → Concept

Do not silently convert relationship evidence into permanent market knowledge.
Evidence persistence and belief evolution belong to the Evidence System.

==================================================
SOURCE EVALUATION
==================================================

Evaluate each source for:

- authority;
- directness;
- relevance;
- geographic relevance;
- temporal relevance;
- specificity;
- consistency;
- identity match.

Prefer authoritative sources where the question concerns technical facts.
Prefer direct commercial/local usage where the question concerns informal market terminology.

==================================================
EVIDENCE EXTRACTION
==================================================

Extract only evidence relevant to the request.

Each important claim should retain provenance.

Separate:

OBSERVED FACT
CROSS-SOURCE FINDING
INFERENCE
UNRESOLVED

Never label an inference as a directly sourced fact.

==================================================
CANDIDATE EVALUATION
==================================================

When candidates are supplied:

- identify evidence supporting each candidate;
- identify evidence contradicting each candidate;
- explain why evidence is relevant;
- do not select a winner unless the request explicitly requires a finding and evidence sufficiently supports it.

==================================================
CONTRADICTIONS
==================================================

Do not hide credible disagreement.

Report:

- conflicting claim;
- source;
- likely reason for disagreement when supported;
- effect on confidence.

==================================================
OUTPUT CONTRACT
==================================================

Always preserve the stable WRS response envelope.

Inside "payload", satisfy the exact requested structure provided by the consumer.

Do not invent fields outside the requested contract unless required for provenance or evidence integrity.

==================================================
FAILURE BEHAVIOR
==================================================

If reliable evidence cannot be found:

- say so;
- return the strongest partial evidence;
- identify what remains unknown;
- do not fabricate certainty.

==================================================
FINAL RULE
==================================================

Your job is not:

"What is the answer?"

Your job is:

"What reliable external evidence can this component use to reach its answer?"
```

---

# 11. Runtime Evidence Request Prompt

```text
TASK: ACQUIRE EXTERNAL EVIDENCE FOR A DOWNSTREAM COMPONENT

CONSUMER:
{{consumer}}

PURPOSE:
{{purpose}}

QUESTION / EVIDENCE REQUEST:
{{question}}

INPUT EXPRESSION / OBJECTS:
{{objects}}

CONTEXT:
{{context}}

CURRENT CANDIDATES:
{{candidates}}

KNOWN EVIDENCE:
{{known_evidence}}

EVIDENCE REQUIREMENTS:
{{evidence_requirements}}

REQUESTED OUTPUT CONTRACT:
{{output_contract}}

Retrieve only evidence that materially helps satisfy this request.

Evaluate source quality, relevance, geographic relevance, temporal relevance, and identity match.

Return evidence, findings, contradictions, provenance, confidence, and the requested consumer-specific payload.

Do not make unsupported final semantic, taxonomy, intent, enrichment, or matching decisions.
```

---

# 12. Optional Deep Retrieval Prompt

Use only when the normal retrieval pass is insufficient.

```text
TASK: DEEPEN EXTERNAL EVIDENCE ACQUISITION

The initial retrieval pass did not provide sufficient evidence.

REQUEST:
{{request}}

INITIAL FINDINGS:
{{findings}}

REMAINING GAPS:
{{gaps}}

COMPETING INTERPRETATIONS:
{{candidates}}

Perform targeted retrieval specifically against the remaining evidence gaps.

Prioritize:
- authoritative sources;
- direct commercial usage;
- Nigerian/local evidence when relevant;
- technical documentation where relevant;
- independent corroboration.

Do not repeat weak sources merely because they rank highly.

Return newly discovered evidence and explicitly state whether it closes the identified gap.
```

---

# 13. Output Principles for Engineers

WRS should make downstream components able to consume evidence without knowing how retrieval was performed.

The WRS API should therefore version:

- envelope schema;
- consumer payload contracts;
- task types;
- evidence types.

Retrieval implementation can change independently.

The evidence contract should remain stable.

---

# 14. Example

### Request from CSRE

```text
Expression: "iron sponge"
Region: Nigeria
Candidate: steel wool / scouring pad
Need: evidence of Nigerian commercial usage
```

WRS should return evidence such as:

```text
supported_candidate: steel wool / scouring pad
supporting sources: [...]
local_usage: [...]
contradictions: [...]
confidence contribution: 0.92
```

It should not itself become the canonical resolver.

### Request from Enrichment

```text
Canonical object: plastic bag heat sealer
Need: functions, distinguishing characteristics, common terminology,
materials/use cases, and confusable product types useful for downstream
GPC vector matching.
```

WRS should return source-grounded facts for those fields.

---

# 15. Core Invariants

1. WRS produces evidence; consumers make domain decisions.
2. Every important external claim retains provenance.
3. Consumer-specific payloads are supported without changing the stable envelope.
4. Weak evidence is not silently converted into certainty.
5. Local evidence is evaluated in local context.
6. Contradictions remain visible.
7. WRS never becomes a hidden taxonomy or matching engine.
8. Retrieval depth is adaptive, not mandatory for every request.


# 16. Locked Market Evidence Integration

This section locks WRS into the evidence-driven market semantic architecture. All existing retrieval contracts, source-evaluation rules, prompts, and invariants remain in force.

## 16.1 WRS Supports, but Does Not Own, the Market Knowledge Graph

WRS remains an **evidence-acquisition capability**.

It may discover evidence about:

- a Phrase → Concept relationship;
- local or regional commercial terminology;
- concept relationships;
- venue relationships;
- product/category associations;
- actual commercial usage;
- contradictions to previously known relationships.

WRS MUST NOT directly become the authoritative Market Knowledge Graph or mutate durable market truth by itself.

The flow is:

```text
WRS retrieval
     ↓
Evidence
     ↓
Evidence validation / fusion
     ↓
Market Knowledge Graph update decision
```

## 16.2 CSRE-Originated Phrase + Concept Evidence

When WRS is invoked by or for CSRE, the preferred evidence target is the semantic relationship already proposed by CSRE:

```text
phrase → proposed concept
```

Example:

```text
CSRE:
phrase = "iron sponge"
concept = "steel wool / scouring pad"

WRS:
retrieve Nigerian/local evidence supporting or contradicting that relationship
```

WRS must report evidence against the supplied phrase/concept candidates rather than silently becoming the resolver.

## 16.3 Market Evidence Types

WRS should support evidence payloads that can later be persisted by the Evidence System for claims such as:

```text
PHRASE_REFERS_TO_CONCEPT
CONCEPT_RELATED_TO_CONCEPT
CONCEPT_USED_FOR_ACTIVITY
CONCEPT_ASSOCIATED_WITH_VENUE
CONCEPT_COMMONLY_SOLD_WITH_CONCEPT
CONCEPT_SUBSTITUTES_FOR_CONCEPT
CONCEPT_ACCESSORY_OF_CONCEPT
VENDOR_ASSOCIATED_WITH_CONCEPT
MARKET_USAGE_PATTERN
```

These are evidence targets, not necessarily SKOS relationships. Where a relationship is directional or commercially specific, downstream systems should represent it with the platform's own RDF vocabulary.

## 16.4 Evidence Quality for Market Relationships

For market-semantic claims, source evaluation must additionally consider:

- actual commercial usage;
- frequency or repeated usage when observable;
- geography/market locality;
- whether the phrase is used by buyers, sellers, both, or only editorial sources;
- whether the observed relationship refers to the same product/concept;
- temporal stability of the terminology;
- contradiction from other credible local sources.

A single web mention should not automatically become durable market knowledge.

## 16.5 RDF / SKOS Boundary

WRS evidence may describe relationships that are later materialized in RDF.

The architecture is:

```text
RDF = foundational graph representation
SKOS = candidate semantic concept-scheme representation
Custom RDF vocabulary = market/commercial/evidence relationships
```

WRS should not force every discovered relationship into `skos:related`.

For example:

```text
Concept A → SUBSTITUTE_FOR → Concept B
```

is semantically different from an undirected `skos:related` relation and should be preserved with a domain-specific predicate downstream.

## 16.6 Collaborative Category Cluster Enrichment Support

WRS may provide evidence that helps validate newly observed buyer concepts, category relationships, or local terms that expand the marketplace's semantic coverage.

However:

```text
Buyer search
    ≠ vendor inventory

WRS evidence of concept existence
    ≠ vendor stock confirmation
```

Relevant vendors may later receive candidate discoverability through the Evidence/Graph system, but WRS must not create inventory claims.

---

# 17. Prompt Lock: Market Evidence Acquisition

Production retrieval prompts MUST follow these additional rules:

```text
MARKET SEMANTIC EVIDENCE RULES

1. When validating a CSRE result, evaluate the explicit Phrase → Concept relationship.
2. Prefer direct local/commercial usage when the claim is about informal market meaning.
3. Preserve the exact phrase and the candidate concept in the evidence request.
4. Separate observed source usage from the downstream belief that the relationship is durable.
5. Return evidence that can support, weaken, or contradict market relationships.
6. Do not mutate GPC.
7. Do not create vendor inventory from concept-demand evidence.
8. Preserve provenance for every important market-semantic claim.
```


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

# 18. IMPLEMENTATION INTEGRATION CONTRACT — v4

This section is authoritative for the WRS wire contract and consumer interoperability.

## 18.1 Request schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/wrs-request-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "request_id", "consumer", "evidence_request"],
  "properties": {
    "schema_version": { "const": "4.0" },
    "request_id": { "type": "string", "minLength": 1 },
    "consumer": {
      "type": "object",
      "additionalProperties": false,
      "required": ["component", "version", "purpose"],
      "properties": {
        "component": {
          "enum": ["CSRE", "ENRICHMENT", "GPC_RESOLVER", "MATCHING_FANOUT", "OTHER"]
        },
        "version": { "type": "string" },
        "purpose": { "type": "string", "minLength": 1 }
      }
    },
    "evidence_request": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "question",
        "context",
        "candidates",
        "relationship_target",
        "evidence_requirements",
        "requested_fields",
        "output_contract"
      ],
      "properties": {
        "question": { "type": "string" },
        "context": { "type": "object" },
        "candidates": { "type": "array" },
        "relationship_target": { "type": ["object", "null"] },
        "evidence_requirements": { "type": "array" },
        "requested_fields": { "type": "array" },
        "output_contract": { "type": "object" }
      }
    }
  }
}
```

## 18.2 Response schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://metamarket.local/schemas/wrs-response-v4.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "request_id",
    "consumer",
    "task_type",
    "status",
    "evidence",
    "findings",
    "contradictions",
    "sources",
    "confidence",
    "payload"
  ],
  "properties": {
    "schema_version": { "const": "4.0" },
    "request_id": { "type": "string" },
    "consumer": {
      "type": "object",
      "additionalProperties": false,
      "required": ["component", "version", "purpose"],
      "properties": {
        "component": { "type": "string", "minLength": 1 },
        "version": { "type": "string", "minLength": 1 },
        "purpose": { "type": "string", "minLength": 1 }
      }
    },
    "task_type": { "type": "string" },
    "status": {
      "enum": ["SUCCESS", "PARTIAL", "NO_RELIABLE_EVIDENCE", "ERROR"]
    },
    "evidence": { "type": "array", "items": { "$ref": "#/$defs/evidence" } },
    "findings": { "type": "array" },
    "contradictions": { "type": "array" },
    "sources": { "type": "array" },
    "confidence": {
      "type": "object",
      "additionalProperties": false,
      "required": ["overall", "evidence_quality", "evidence_consistency"],
      "properties": {
        "overall": { "type": "number", "minimum": 0, "maximum": 1 },
        "evidence_quality": { "type": "number", "minimum": 0, "maximum": 1 },
        "evidence_consistency": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "payload": { "type": "object" }
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
        "source_id",
        "source_url",
        "source_title",
        "source_type",
        "geographic_relevance",
        "temporal_relevance",
        "quality",
        "confidence"
      ],
      "properties": {
        "evidence_id": { "type": "string", "minLength": 1 },
        "claim": { "type": "string", "minLength": 1 },
        "supports": { "type": "array", "items": { "type": "string" } },
        "contradicts": { "type": "array", "items": { "type": "string" } },
        "relationship_target": {
          "anyOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "required": ["subject_id", "predicate", "object_id", "object_type"],
              "properties": {
                "subject_id": { "type": ["string", "null"] },
                "predicate": { "type": ["string", "null"] },
                "object_id": { "type": ["string", "null"] },
                "object_type": { "type": ["string", "null"] }
              }
            },
            { "type": "null" }
          ]
        },
        "source_id": { "type": "string", "minLength": 1 },
        "source_url": { "type": ["string", "null"] },
        "source_title": { "type": ["string", "null"] },
        "source_type": { "type": "string", "minLength": 1 },
        "geographic_relevance": { "enum": ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] },
        "temporal_relevance": { "enum": ["CURRENT", "HISTORICAL", "UNKNOWN"] },
        "quality": { "enum": ["HIGH", "MEDIUM", "LOW"] },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    }
  }
}
```

## 18.3 Stable evidence identity

Every evidence record MUST carry:

```text
evidence_id
source_id
claim
supports
contradicts
relationship_target
provenance
confidence
```

`request_id` is the correlation key for the retrieval operation.

## 18.4 Evidence System handoff

WRS MUST NOT write durable market truth directly.

The handoff is:

```text
WRS response
   ↓
Evidence System ingestion
   ↓
observation/evidence normalization
   ↓
belief / graph decision
```

WRS-provided evidence identifiers MUST remain recoverable in Evidence System provenance.

## 18.5 Relationship targets

Relationship-targeted evidence is first-class and MUST preserve direction:

```text
Phrase → EXPRESSES → MarketConcept
Concept → SUBSTITUTE_FOR → Concept
Concept → COMMONLY_SOLD_WITH → Concept
Vendor → SUPPLIES → Concept
Buyer → REQUESTED → Concept
Vendor → SERVES → Venue
```

WRS MUST never turn an observed relationship into a vendor inventory assertion merely because
the queried concept was commercially relevant.

## 18.6 Prompt/output binding

The Production Master System Prompt, Runtime Evidence Request Prompt, and Deep Retrieval Prompt
MUST use the WRS v4 output schema or the explicitly supplied consumer payload schema.

The instruction:

```text
Return JSON only
```

is insufficient by itself. A runtime schema MUST accompany every structured WRS call.

---

# 19. STRUCTURED PROMPT OUTPUT CONTRACTS

## 19.1 Master and runtime prompts

The Master System Prompt, Runtime Evidence Request Prompt, and Optional Deep Retrieval Prompt
MUST normalize into the WRS v4 response envelope.

The runtime MUST bind the structured-output call to:

```text
https://metamarket.local/schemas/wrs-response-v4.json
```

and MAY supply a consumer-specific payload schema referenced by:

```text
evidence_request.output_contract
```

## 19.2 Consumer payload rule

`payload` is the only consumer-variable portion of the response. The outer envelope is stable.

A consumer payload MUST NOT redefine:

```text
request_id
status
evidence
sources
contradictions
confidence
```

## 19.3 Deep retrieval output

Deep retrieval uses the same WRS response envelope. It MUST identify newly acquired evidence
separately from evidence already returned by the initial retrieval request.

## 19.4 No-final-decision invariant

A WRS response MUST NOT contain a final semantic, GPC, intent, or vendor-match decision as
an authoritative field. Any such consumer-side conclusion belongs in the consumer payload only
as an explicitly labelled evidence-grounded finding.

---

## Cross-Stack Version Matrix

```text
CSRE v5.3 (wire v5.0) ─┐
Enrichment v4.3 (wire v4.0) ─┼─→ WRS v4.3 (wire v4.0) → Evidence System v4.3 (wire v4.0)
GPC Resolver v4.3 (wire v4.0) ─┘
```

WRS is an evidence acquisition layer shared by the semantic/taxonomy components. It never becomes
the authoritative owner of semantic identity, intent, GPC classification, or durable belief.


---

# 20. FINAL IMPLEMENTATION INTEGRATION CONTRACT — v4.2

The WRS service boundary is the shared evidence-acquisition contract for CSRE, Enrichment,
GPC Resolver, Matching & Fanout, and future consumers.

## 20.1 Request correlation

The WRS `request_id` MUST be unique per retrieval operation and MUST be propagated unchanged
through the complete WRS lifecycle.

For every evidence record:

```text
wrs.request_id
wrs.evidence_id
source_id
relationship_target
confidence
provenance
```

MUST remain recoverable.

## 20.2 Consumer identity

The request and response MUST use the same structured consumer identity:

```text
consumer.component
consumer.version
consumer.purpose
```

Permitted production consumers remain:

```text
CSRE
ENRICHMENT
GPC_RESOLVER
MATCHING_FANOUT
OTHER
```

The response MUST NOT collapse the consumer object to a free-form string.

## 20.3 Evidence is not final meaning

WRS may report that evidence supports a candidate or relationship, but the consuming engine remains
responsible for its authoritative decision.

```text
WRS → evidence
CSRE → semantic decision
Enrichment → enrichment decision
GPC Resolver → taxonomy decision
Matching & Fanout → matching decision
Evidence System → durable evidence/belief decision
```

## 20.4 Evidence System handoff

The WRS response MUST be accepted by Evidence System ingestion without semantic reconstruction.

Every `evidence[]` item is normalized into the Evidence System immutable model:

```text
evidence_id
claim/assertion
polarity where determined
supports
contradicts
relationship_target
provenance
independence_key
observed_at
```

Where a WRS field is not available, the Evidence System ingestion adapter MUST explicitly represent
the missing value as null/unknown rather than fabricate it.

## 20.5 Consumer-specific payload discipline

`payload` is consumer-specific data. It MUST NOT contain a second conflicting interpretation of the
same evidence record. The stable outer envelope remains authoritative for provenance and evidence
identity.

## 20.6 Retrieval failure contract

`NO_RELIABLE_EVIDENCE` is a valid result and MUST NOT be converted into a fabricated fact.
`PARTIAL` MUST identify usable evidence while preserving missing/failed retrieval conditions.
`ERROR` MUST carry machine-readable error information in the service layer even if the LLM payload
contains no evidence.

---

# 21. NORMATIVE AGENDA COMPLETION — v4.3

**Effective:** 2026-09-10  
**Status:** Authoritative amendment.

## 21.1 WRS → MKG relationship evidence

WRS may retrieve evidence for graph relationships requested by MKG/Evidence consumers, including:

- `CONCEPT → SUBSTITUTE_FOR → CONCEPT`
- `CONCEPT → COMMONLY_SOLD_WITH → CONCEPT`
- `CONCEPT → ACCESSORY_OF → CONCEPT`
- `VENDOR → SUPPLIES → CONCEPT`
- `VENUE → ASSOCIATED_WITH → CONCEPT`
- `PHRASE → EXPRESSES → MARKET_CONCEPT`

WRS returns evidence and provenance only. Evidence evaluates it; MKG persists the approved relationship state.

## 21.2 Consumer boundary

MKG is now an explicit WRS consumer class for relationship-targeted evidence acquisition, but WRS remains ignorant of graph mutation policy.

## 21.3 Currentness and locality

For market relationships where geography or current commercial usage matters, WRS must preserve geographic and temporal relevance in the response envelope so Evidence can prevent globally plausible but locally invalid relationships from becoming durable knowledge.



# 22. NORMATIVE AGENDA COMPLETION — v4.4 LOCALITY + RELATIONSHIP EVIDENCE HARDENING

**Effective:** 2026-09-12  
**Status:** Authoritative amendment.

## 22.1 Final component identity

```text
component               = WRS
component_version       = 4.4
request schema_version  = 4.0
response schema_version = 4.0
```

## 22.2 Relationship-targeted evidence is first-class

WRS MAY be invoked to investigate:

```text
Phrase → EXPRESSES → MarketConcept
Concept → SUBSTITUTE_FOR → Concept
Concept → COMMONLY_SOLD_WITH → Concept
Concept → ACCESSORY_OF → Concept
Vendor → SUPPLIES → Concept
Venue → SERVES/ASSOCIATED_WITH → Concept
```

The response MUST identify whether support is direct, cross-source, inferred, or unresolved.

## 22.3 Local-language limitation and escalation

WRS MUST treat failure to find strong web evidence for an informal Nigerian market expression as an evidence gap, not as evidence that the expression is invalid.

When web evidence is weak, the preferred next evidence source is marketplace-native observation through Evidence, especially merchant onboarding, buyer clarification, vendor confirmation/rejection, and audio transcript observations.

## 22.4 Locality and temporal scope

Relationship evidence MUST preserve geography and temporal relevance. A relationship supported in one Nigerian market or period MUST NOT automatically become a global/universal graph fact.

## 22.5 WRS does not promote truth

WRS never writes MKG and never decides that a relationship is durable truth. It supplies provenance-rich evidence to Evidence, which evaluates promotion.
