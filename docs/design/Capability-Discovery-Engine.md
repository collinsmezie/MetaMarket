
# Capability Discovery Engine
## Guiding principle

> **Capability Discovery is the continuous process of observing every piece of evidence a person produces, converting it into probabilistic capability signals, organizing those signals into a hierarchical capability graph, and continuously updating a living Capability DNA that becomes a progressively more accurate representation of what that person can genuinely offer to the market.**

This approach naturally handles broad statements ("I sell household items"), precise product lists ("MCCBs, conduits, breakers"), services ("I install solar systems"), brands ("Schneider Electric"), and future interactions—all as evidence contributing to an evolving understanding rather than a one-time classification. It also aligns well with your earlier Capability Map Object and Seller DNA concepts, while providing a principled foundation for continuous learning. The capability discovery engine will power vendor onboarding, inventory updates feature, post onboarding workflow and more.

The key insight is this:

> **The system should not try to classify products. It should try to infer human capability.**

That sounds subtle, but it's a fundamental architectural shift.

A seller saying:

> "I sell electrical things."

is **not** primarily telling you about products. They are revealing something about **what they are capable of supplying**.

Likewise,

> "I sell household items."

is not a category. It is evidence about the seller's commercial capability.

---

# System Behaviour

Instead of thinking in terms of product classification, think in terms of evidence accumulation.

```
Seller utterance
        │
        ▼
Language Understanding
        │
        ▼
Capability Resolution
        │
        ▼
Evidence Extraction
        │
        ▼
Capability Inference
        │
        ▼
Capability Confidence Graph
        │
        ▼
Persistent Seller DNA
        │
        ▼
Continuous Learning
```

Notice there is no single "classification" step.

Once language is understood, **Capability Resolution** maps that meaning onto canonical capabilities drawn from an authoritative knowledge source (detailed later in the *Capability Resolver* section). Resolution is deliberately *not* classification: it produces ranked, probabilistic capability hypotheses—never a single fixed label—which then flow into evidence, inference, and the graph. This resolution step is what guarantees that "electrical things," "electric stuff," and "the things electricians buy" all converge on the same canonical capabilities.

The system is continuously estimating:

> **What is this person capable of providing?**

---

# Think of every seller as having a Capability Graph

Instead of storing

```
Categories
```

store

```
Capabilities
```

Example

```
Electrical Supply
    confidence 0.91

Lighting
    confidence 0.67

Industrial Electrical
    confidence 0.31

Consumer Electronics
    confidence 0.45

Solar Equipment
    confidence 0.18
```

This graph evolves.

It is never final.

---

# Every conversation is evidence

Imagine the seller says

> I sell electrical things.

The system should NOT conclude

```
Electrical
```

Instead

```
Evidence #1

Source:
Conversation

Strength:
Medium

Supports

Electrical Supply

Lighting

Power Distribution

Power Tools

Consumer Electronics

Industrial Components

Electrical Accessories
```

Nothing is confirmed.

Everything is hypothesis.

---

Later...(in response to a post onboarding question)

Seller says

> mostly wiring accessories

Now

```
Electrical Supply

Confidence
0.91 ↑

Lighting

0.41 ↓

Consumer Electronics

0.14 ↓

Industrial Components

0.67 ↑
```

The graph shifts.

---

# Every statement has different information density

Example

> We sell things.

Almost useless.

---

Example

> We sell electrical things.

Useful.

---

Example

> We stock Schneider breakers, armored cable, MCCBs and conduit fittings.

Extremely informative.

The engine should score every statement.

```
Information Density

Very Low

Low

Medium

High

Very High
```

Higher density means stronger capability updates.

---

# Capability Evidence Objects

Every extracted fact becomes an object.

Example

```
Evidence

Type:
Broad capability

Text:
Electrical things

Supports:

Electrical Supply

Lighting

Industrial Electrical

Consumer Electrical

Confidence:
0.64

Source:
Conversation

Timestamp
```

Another

```
Evidence

Type:
Named Product

Text:
MCCB

Supports

Industrial Electrical

Power Distribution

Electrical Protection

Confidence
0.98
```

Nothing disappears.

Evidence accumulates.

---

# Capability Discovery is Bayesian

The system should never think

> True or False

Instead

```
Probability

P(Seller supplies lighting)

0.81

P(Seller supplies generators)

0.29

P(Seller supplies solar)

0.18

P(Seller supplies electrical accessories)

0.94
```

Every interaction updates those probabilities.

---

# Multiple knowledge sources

The seller may reveal capability through many channels.

Conversation

> I sell generators

Post Onboarding Question

```
What was one thing you sold yesterday?
```

```
I Sold circuit breakers

```

Social Media (future support)

```
Now available:
Solar inverter
```

Image

(photo of plumbing fittings)


Business name

```
Bright Electricals Ltd
```

Website

```
Industrial Automation Solutions
```

Each contributes evidence.

---

# Capability Discovery should have multiple inference engines

Instead of one classifier, compose specialists.

### 1. Semantic Engine

Understands language.

```
I deal in electrical stuff.
```

↓

Electrical capability.

---

### 2. Product Recognition Engine

Knows

```
MCCB

Circuit Breaker

PVC Conduit

Schneider
```

↓

Electrical Distribution

---

### 3. GS1 GPC Mapping Engine

Maps products

↓

GS1 GPC classes

↓

Capability domains

---

### 4. Market Knowledge Engine

Knows

```
If seller stocks
Paint

Cement

Tiles

They probably supply

Building Materials
```

---

### 5. Behavioral Engine

Learns from interactions.

```
Seller repeatedly affirms to customer request

Generators

Solar Panels

Inverters

```

↓

Increase energy capability.

---

### 6. Conversation Memory Engine

Tracks history.

Month 1

```
Electrical
```

Month 3

```
Electrical

Solar

Industrial Automation
```

Month 8

```
Electrical

Industrial Controls

PLC

Factory Automation
```

Seller profile evolves.

---

### These engines produce signals, not final capability names

Each engine above emits *candidate signals*, not canonical capabilities. The Semantic, Product Recognition, and GS1 GPC Mapping engines in particular all feed a single downstream component—the **Capability Resolver** (specified later)—whose job is to turn those probabilistic signals into consistent, canonical capability identifiers. The engines reason and rank; the resolver decides the canonical name. This split is what keeps capability names identical across every seller, no matter which engine first surfaced the signal.

---

# Capability Hierarchy

Instead of flat categories.

```
Business Capability

Electrical

    Power Distribution

        Circuit Protection

            MCCB

            MCB

            RCCB

        Wiring

            Cable

            Conduit

Lighting

Consumer Electronics

Solar

Industrial Automation
```

Evidence can attach anywhere.

Mentioning "MCCB" increases confidence for:

* MCCB
* Circuit Protection
* Power Distribution
* Electrical

This propagation makes the system robust.

---

# Vendor DNA

Eventually every vendor has a living representation.

```
Vendor DNA

Identity

Capabilities

Confidence

Industries

Brands

Products

Services

Customers

Price Level

Regions Served

Business Scale

Supply Reliability

Expertise

Business Intent

Evidence History

Growth Timeline
```

This DNA is never rebuilt.

It continuously evolves.

---

# One capability can imply others

If someone says

> I repair phones.

The system should infer more than:

```
Phone Repair
```

It will infer, with different confidence levels:

* Mobile device diagnostics
* Screen replacement
* Battery replacement
* Spare parts sourcing
* Electronics troubleshooting
* Customer support

These are inferred capabilities, not explicitly stated ones.

---










# knowledge acquisition under extreme interaction constraints

Most AI systems assume users will cooperate by filling forms, uploading catalogs, connecting CRMs, or answering many questions. Users often won't. An informal trader on WhatsApp wants to get back to business, not build a digital profile.

That means the central challenge isn't *"How do we classify sellers?"* It's:

> **How do we learn as much as possible while asking for almost nothing?**

This MUST be treated as a first-principles design constraint.

---

## Principle 1: Every interaction must have immediate value

The system should never ask for information *just to learn*.

Instead, learning should be a by-product of helping the user.

Bad:

> What products do you sell?

Good:

> A buyer is looking for ceiling fans. Can you supply them?

Regardless of the answer, we have learned something.

Every question should simultaneously:

* help the seller,
* improve matching,
* acquire knowledge.

Knowledge acquisition should feel invisible.

---

# Principle 2: One message should yield many facts

Suppose a seller says:

> I have plumbing materials.

A traditional chatbot stores:

> Plumbing

A Capability Discovery Engine should extract dozens of signals.

Example:

**Explicit evidence**

* Plumbing

**Implicit evidence**

* Sells physical goods
* Likely serves builders
* Likely stocks fittings
* Likely understands sizes/specifications
* Likely local inventory
* Likely B2B and B2C

No additional questions were asked.

The system's intelligence comes from extracting more than the user consciously provided.

---

# Principle 3: Curiosity Budget

Every seller has a limited willingness to answer questions.

Imagine every user has a hidden variable:

```
Curiosity Budget

20 seconds

or

3 questions

or

1 minute
```

If you waste it,

the user leaves.

Therefore every question must maximize information gain.

Instead of saying:

> List what you sell?

Ask:

> Describe what you sell in a simple way?

One answer might reveal ten capability areas.

---

# Principle 4: Questions compete

Suppose the system could ask one of these:

Question A

> Do you sell batteries?

Information gain:

0.2 bits

Question B

> If someone walks into your shop, what kinds of things do they usually ask for?

Information gain:

4.7 bits

Always choose Question B.

This is an information theory problem.

---

# Principle 5: Learn opportunistically

Suppose the seller replies to a buyer:

> I don't have it but I can get it tomorrow.

That sentence is gold.

We learned:

* inventory is flexible
* supplier network exists
* sourcing capability
* lead time
* willingness to special order

Nobody asked.

---

# Principle 6: Observe behavior, not just answers

Actions often reveal more than words.

Example:

Buyer requests:

> 25kg POP cement.

Seller affirms.

You now know they can supply cement—even if they never explicitly listed it.

Similarly, repeated rejections reveal boundaries.

Behavior is evidence.

---

# Principle 7: Never ask for lists

This is huge.

Most onboarding fails because of prompts like:

> List everything you sell.

Nobody wants to type 300 products.

Instead ask for progressively easier expressions(post onboarding).

For example:

```
Describe your business in one sentence.
```

Later:

```
What's the most common thing your customers ask for?
```

Later:

```
What's something you sold today?
```

Later:

```
What did someone ask for that you didn't have?
```

Each answer is tiny.

Collectively they become enormous.

---

# Principle 8: The profile is never "complete"

Traditional systems think:

```
Registration

↓

Complete Profile

↓

Done
```

Instead:

```
Day 1

4% known

↓

Week 2

17%

↓

Month 3

46%

↓

Month 12

82%

↓

Month 30

94%
```

The seller never notices this progression.

---

# Principle 9: Build a Capability Memory

Instead of storing only facts, store uncertainty.

Example

```
Lighting

0.62

Evidence

Conversation

Customer requests

Supplier inference
```

This lets the profile evolve instead of becoming stale.

---

# Principle 10: Think in terms of "Compression"

Suppose someone says:

> I run a building materials shop.

Those five words compress thousands of facts.

A human immediately imagines:

* cement
* blocks
* roofing sheets
* nails
* plumbing
* paint
* tiles
* tools
* adhesives

The AI should do the same.

The seller shouldn't need to enumerate them.

This is semantic compression.

---

# A new idea: Capability Entropy

Not all sellers are equally understood.

Measure uncertainty.

```
Capability Entropy

Electrical

0.12

Very certain

Fashion

0.88

Very uncertain

Solar

0.73

Possible

Industrial

0.41
```

The AI should ask questions only where entropy is highest and where reducing it will most improve marketplace matching.

---

# Progressive Capability Discovery (PCD)

Imagine the system is always discovering.

Every interaction follows the same cycle:

```
Observe
      ↓
Extract
      ↓
Resolve
      ↓
Infer
      ↓
Estimate Confidence
      ↓
Estimate Uncertainty
      ↓
Decide Whether to Ask
      ↓
Learn
      ↓
Update Capability DNA
```

The **"Resolve"** step hands the extracted meaning to the Capability Resolver, which returns canonical capabilities with confidence *before* inference and graph updates begin—so every downstream step operates on standardized identifiers rather than raw language. The crucial step is **"Decide Whether to Ask."** The system should only interrupt the user when the expected value of the new information exceeds the cost of the interruption.

---

# An idea that is particularly well suited to informal markets

**Market participation post onboarding**.

For example:

* Every customer request a vendor receives is an opportunity to learn what they can supply.
* Every "yes," "no," or "I can get it tomorrow" becomes structured evidence.
* Every correction ("No, I don't sell TVs, only electrical wiring") sharpens the capability graph.
* Every successful fulfillment increases confidence in related capabilities.

Over time, the seller's profile becomes rich without ever requiring a long form or catalog upload.

In other words, the marketplace doesn't pause to collect knowledge—it **learns while creating value**. That design preserves the simplicity of a WhatsApp-first experience while allowing the Capability Discovery system to continuously evolve into a more accurate representation of each person's business capabilities.
















## Discovering knowledge from people who may not even know what they know

Most knowledge acquisition systems make a hidden assumption:

> "The user knows how to describe themselves."

In reality users often don't.

An informal trader might sell 800 different products and still answer:

> "I just sell market things."

or

> "Anything."

or

> "Normal things."

From an AI perspective, these are almost information-free. But from a human perspective, they're completely normal.

This means the AI cannot depend on the user's ability to articulate their own capabilities.

And this leads to several new design principles.

---

# Principle 11: The AI must understand the user's mental model, not just their words

There are at least four levels of knowledge.

**Level 1 — Expert**

> "We distribute low-voltage electrical protection equipment."

Very precise.

---

**Level 2 — Semi-skilled**

> "We sell electrical materials."

Still useful.

---

**Level 3 — Informal trader**

> "Electric things."

Very broad.

---

**Level 4 — Uninformed**

> "The things electricians buy."

Ironically, this is extremely human.

A good Capability Discovery system should recognize that all four may refer to nearly the same business.

The challenge isn't translation between languages—it's translation between **levels of commercial literacy**.

---

# Principle 12: People describe businesses through prototypes, not taxonomies

Humans rarely think in categories.

Instead they think in examples.

Ask:

> What do you sell?

Response:

> Cement.

The seller also sells:

* blocks
* nails
* roofing sheets
* wheelbarrows
* tiles

But they only mentioned cement because it was the first thing that came to mind.

One example should trigger a search through related capability clusters, not just a literal mapping.

---

# Principle 13: The AI should speak the user's language, not the ontology's language

Never ask:

> Which category best describes your business?

Instead ask:

> If your friend wanted to explain your shop, what would they say?

or

> What do most people come to buy from you?

These questions align with how people naturally think.

---

# Principle 14: Discover through stories, not forms

People struggle with abstraction.

They excel at recalling experiences.

Bad:

> What services do you provide?

Better:

> Tell me about the last customer you sold to.

One story may reveal:

* products
* services
* delivery
* sourcing
* installation
* payment methods
* customer type

A single narrative is often richer than a checklist.

---

# Principle 15: Use recognition instead of recall

Psychology tells us that recognition is easier than recall.

Recall:

> List everything you sell.

Hard.

Recognition:

> Do customers ever come to you for paint?

Much easier.

But we don't want to ask hundreds of yes/no questions.

So the trick is to ask only the highest-value recognition questions based on current uncertainty.

---

# Principle 16: Learn the language of local markets

Informal markets have their own vocabulary.

Examples:

* "provisions"
* "building materials"
* "electronics"
* "phone accessories"
* "chemicals"
* "motor parts"
* "fashion things"
* "plastic"

None of these map cleanly to formal taxonomies, but every local buyer understands them.

The AI should have a **Market Language Layer**.

```
"provisions"

↓

Rice
Beans
Oil
Sugar
Milk
Beverages
...

↓

Capability Graph
```

This becomes a form of semantic translation between informal language and structured capability.

---

# Principle 17: Infer from what people omit

Suppose someone says:

> I sell cement.

Should we conclude they don't sell nails?

No.

Sometimes silence means ignorance, not absence.

The AI should distinguish between:

* **Unknown**
* **Probably not**
* **Definitely not**

Most systems collapse all three into "No."

That creates brittle profiles.

---

# A concept that could become a core innovation: Cognitive Load-Aware Discovery (CLAD)

Instead of assuming every user can answer every question, the AI estimates:

```
Knowledge Level

Commercial Vocabulary

Literacy

Patience

Conversation Fatigue

Response Quality
```

Then adapts.

A retired engineer might get:

> Do you stock variable frequency drives?

An informal trader might get:

> Do electricians usually come to your shop, or is it mostly people buying TVs and radios?

Same objective.

Different cognitive load.

---

# Another concept: Capability Discovery by Buyer Demand

This turns a weakness into a strength.

Suppose a new seller joins.

Profile:

```
Unknown
```

After the ultra simple onboarding, let the marketplace teach the system.

Buyer 1

> Need 10 bags of cement.

Seller:

> Yes.

Learn.

Buyer 2

> Need roofing nails.

Seller:

> Yes.

Learn.

Buyer 3

> Need paint.

Seller:

> Yes.

Learn.

After only a few interactions, the AI starts to infer:

> This seller is likely a building materials supplier.

The marketplace itself becomes the teacher.

---

## The principle that defines the entire architecture

Most AI assistants assume:

> **The user is the source of truth.**

For our target market, that assumption doesn't hold consistently.

Instead, your system should assume:

> **Truth emerges from many small interactions over time.**

A vendor may not know how to describe their business. A customer may use informal names for products. Neither may be technically literate. But across dozens of conversations, successful matches, refusals, sourcing promises ("I can get it tomorrow"), and recurring requests, the AI gradually converges on an increasingly accurate model of the seller's true capabilities.

In that sense, the conversation is not the product—it's the sensing mechanism. The marketplace itself becomes a continuous observation system, allowing the Capability DNA to evolve from sparse, imperfect signals into a robust representation of what each person can genuinely offer. This philosophy is especially well suited to informal markets because it does not require users to become better at describing themselves; it requires the AI to become better at understanding them.





I think this deserves a proper Technical Design Record because what we're designing isn't simply an AI feature—it's the **core intelligence layer** of your marketplace. Below is the beginning of what I would consider **Capability Discovery System (CDS) TDR v1.0**.

---

# Technical Design Record (TDR)

## Capability Discovery System (CDS)

**Version:** 1.0

**Status:** Draft

**Purpose:** Core AI Intelligence Layer

---

# 1. Overview

The Capability Discovery System (CDS) is an AI-driven intelligence system whose purpose is to continuously discover, infer, organize, and evolve the understanding of what value an individual or business can provide.

Unlike traditional onboarding systems that rely on structured forms, product catalogs, or explicit user descriptions, CDS assumes that users may be unable, unwilling, or unavailable to accurately describe their capabilities.

Instead, CDS learns incrementally from natural interactions while minimizing user effort.

The system is designed primarily for informal markets where businesses often communicate through low-friction interfaces such as WhatsApp, voice calls, or SMS.

---

# 2. Vision

Create an AI that understands businesses better than they understand themselves.

The system should gradually build an increasingly accurate representation of a person's commercial capability without requiring formal onboarding or technical knowledge.

---

# 3. Design Philosophy

The Capability Discovery System is founded on the following principles.

## Principle 1

Users should work.

The AI should learn.

Never the reverse.

---

## Principle 2

Every interaction should simultaneously create value and generate knowledge.

Learning must always be a side effect of usefulness.

---

## Principle 3

Capability is the target.

Products are merely evidence.

---

## Principle 4

Knowledge is probabilistic.

Nothing is absolutely true.

Everything has confidence.

---

## Principle 5

Capability discovery never ends.

Profiles continuously evolve.

---

## Principle 6

Users should never feel like they are completing onboarding.

---

## Principle 7

The AI should adapt to human thinking.

Humans should not adapt to machine thinking.

---

# 4. Problem Statement

Existing marketplaces assume sellers can accurately describe themselves.

This assumption fails in informal economies.

Common characteristics include:

* little technical knowledge
* limited digital literacy
* limited commercial vocabulary
* little patience
* inability to enumerate products
* inconsistent terminology
* busy work environments
* intermittent internet
* mobile-first usage

Therefore, relying on forms, categories, or manual catalog creation produces poor-quality business profiles.

---

# 5. Objectives

The system shall:

* Discover business capabilities.
* Resolve capabilities to canonical, deterministic identifiers.
* Infer hidden capabilities.
* Build a continuously evolving Capability DNA.
* Minimize user effort.
* Operate through natural conversation.
* Support multilingual and local market language.
* Handle sparse information.
* Continuously improve confidence.
* Know what it knows.
* Know what it does not know.

---

# 6. Non Objectives

The system is NOT intended to:

* build complete inventory catalogs
* replace ERP systems
* force structured onboarding
* require users to understand taxonomy

---

# 7. Core Concept

The system does not classify products.

The system discovers capability.

Instead of asking

> What products do you sell?

the system answers

> What is this person capable of providing?

---

# 8. Capability DNA

Every seller possesses a continuously evolving Capability DNA.

Capability DNA represents the AI's current understanding of the business.

It includes:

* Capabilities (stored as **canonical identifiers resolved by the Capability Resolver**, never free-text labels)
* Products
* Services
* Brands
* Industries
* Customer Types
* Supply Style
* Fulfillment Style
* Geography
* Confidence Scores
* Evidence History
* Knowledge Gaps
* Conversation Memory
* Timeline of Growth

Capability DNA is never complete.

It evolves continuously.

---

# 9. Capability Graph

Capabilities are represented as a graph rather than flat categories.

Example

```
Electrical

├── Wiring

├── Lighting

├── Power Distribution

├── Industrial Automation

├── Solar

└── Consumer Electronics
```

Evidence updates any node.

Nodes are the canonical capability identifiers produced by the Capability Resolver, so evidence from different sellers—and different phrasings of the same meaning—attaches to the same nodes.

Confidence propagates through the hierarchy.

---

# 10. Evidence Model

Everything becomes evidence.

Examples include:

Conversation

Buyer Requests

Seller Responses

Accepted Jobs

Rejected Jobs

Corrections

Stories

Examples

Product Mentions

Brand Mentions

Service Descriptions

General Business Statements

Behavior

Evidence never disappears.

Only confidence changes.

---

# 11. Evidence Object

Each evidence item contains:

```
Evidence ID

Source

Timestamp

Original Text

Normalized Meaning

Resolved Capabilities (canonical identifiers from the Capability Resolver)

Supported Capabilities

Confidence Contribution

Information Density

Reliability Score

Conversation Context

Reasoning Trace
```

Evidence is immutable.

Inference is dynamic.

The capability identifiers referenced by every evidence object are always produced by the Capability Resolver, guaranteeing that identical meaning maps to identical canonical capabilities across all sellers.

---

# 12. Progressive Capability Discovery

Capability discovery is continuous.

Observe

↓

Extract

↓

Resolve
(Capability Resolver → canonical capabilities)

↓

Infer

↓

Estimate Confidence

↓

Estimate Uncertainty

↓

Learn

↓

Update Capability DNA

↓

Repeat

No final profile exists.

---

# 13. Market Language Layer

Users communicate using market language rather than taxonomy.

Examples:

"Electrical things"

"Market items"

"Provisions"

"Chemicals"

"Plastic"

"Building materials"

The system must translate these expressions into capability hypotheses.

This layer is market-specific and continuously expandable.

---

# 14. Semantic Compression Engine

Humans communicate compressed knowledge.

Example

"I sell building materials."

actually represents hundreds or thousands of possible products.

The Semantic Compression Engine expands these compressed statements into capability hypotheses.

---

# 15. Knowledge Levels

Users possess varying commercial literacy.

Level 1

Expert

---

Level 2

Experienced Trader

---

Level 3

Informal Seller

---

Level 4

Low Knowledge

The AI adapts to the user's knowledge level.

The user should never need to learn technical terminology.

---

# 16. Cognitive Load Model

Every conversation estimates:

* User patience
* Commercial vocabulary
* Literacy
* Technical knowledge
* Response quality
* Conversation fatigue

This determines:

* whether to ask a question
* how complex it should be
* when to stop asking

---

# 17. Curiosity Budget

Every seller has a limited willingness to answer questions.

Questions spend that budget.

Therefore every question must maximize expected information gain.

The system should ask fewer, smarter questions.

---

# 18. Recognition over Recall

Humans recognize better than they recall.

Instead of

"List everything you sell"

prefer

"What do customers usually come to buy from you?"

or

"What did you sell today?"

---

# 19. Stories over Forms

Narratives contain richer information than structured questionnaires.

One story can reveal:

* capabilities
* customers
* logistics
* services
* expertise
* sourcing
* delivery

---

# 20. Capability Entropy

Every capability has uncertainty.

The AI continuously estimates:

How certain am I?

Which unknowns matter most?

Questions target high-value uncertainty.

---

# 21. Marketplace as Sensor

Marketplace activity continuously teaches the AI.

Buyer asks.

Seller answers.

Buyer buys.

Seller rejects.

Seller sources.

All become evidence.

The marketplace itself becomes the observation system.

---

# 22. System Architecture

The Capability Discovery System consists of the following cooperating intelligence modules.

## Interaction Engine

Handles WhatsApp, SMS, Voice, API, Web.

---

## Conversation Understanding Engine

Extracts meaning from natural language.

---

## Market Language Engine

Translates informal market expressions.

---

## Semantic Compression Engine

Expands broad commercial statements.

---

## Capability Resolver

Resolves interpreted meaning into canonical capability identifiers. It is the boundary between probabilistic language understanding and deterministic commercial knowledge, and it is a first-class component rather than a sub-part of the inference engine. It sits between the understanding/compression engines and evidence extraction, so all downstream evidence and inference operate on standardized identifiers. See the *Capability Resolver* specification for its full contract.

---

## Evidence Extraction Engine

Converts interactions into structured evidence.

---

## Capability Inference Engine

Updates capability probabilities.

---

## Capability Graph Engine

Maintains hierarchical capability relationships.

---

## Curiosity Engine

Determines whether asking a question creates more value than interruption.

---

## Memory Engine

Maintains Capability DNA.

---

## Learning Engine

Improves inference rules using marketplace outcomes.

---

## Matching Engine

Uses Capability DNA for buyer matching.

---

# 23. Continuous Learning Loop

```
Conversation

↓

Capability Resolution

↓

Evidence

↓

Inference

↓

Capability Graph

↓

Capability DNA

↓

Marketplace Matching

↓

Marketplace Feedback

↓

New Evidence

↓

Better Inference
```

---


## Closing Philosophy

The Capability Discovery System is not an onboarding workflow or a classification engine. It is a **living commercial intelligence system**. Its purpose is to reduce the burden on people—especially those in informal markets—by shifting the responsibility of understanding from the user to the AI.

The defining principle of the system is:

> **People should conduct their business naturally. The AI should continuously observe, reason, learn, and refine its understanding until it becomes an increasingly accurate representation of what each person can genuinely offer.**

---


The **Capability Resolver** is a first-class component of the architecture (see §22, *System Architecture*), not a sub-part of the inference engine. It is referenced throughout the discovery pipeline above—in the System Behaviour flow, the Progressive Capability Discovery cycle (both the narrative and §12 versions), the Capability DNA and Evidence models, and the Continuous Learning Loop. The following section specifies its contract in full.

---


# Capability Resolver

> **Specification for the first-class component introduced in §22.** In the pipelines throughout this document (Understanding → **Capability Resolution** → Evidence → Inference → DNA), this section defines exactly what the resolution stage does.

## Purpose

The Capability Resolver is responsible for converting the semantic meaning extracted from human language into deterministic, canonical capability references that can be used consistently throughout the Commercial Intelligence Engine.

The resolver ensures that the AI never invents or stores arbitrary capability names. Instead, it resolves interpreted meaning against an authoritative knowledge source.

The resolver is the boundary between probabilistic language understanding and deterministic commercial knowledge.

---

## Design Principle

The AI is responsible for reasoning.

The Capability Resolver is responsible for standardization.

The Commercial Intelligence Engine SHALL NOT allow Large Language Models to generate canonical capability names.

Large Language Models SHALL only:

- interpret user intent
- understand business meaning
- infer hidden capability signals
- estimate confidence
- rank possible capability candidates

Canonical capability identifiers SHALL always originate from an authoritative knowledge source.

---

## Responsibilities

The Capability Resolver SHALL:

- Resolve interpreted business meaning into canonical capability identifiers.
- Ensure deterministic capability naming.
- Eliminate synonym fragmentation.
- Maintain consistency across sellers.
- Support hierarchical capability expansion.
- Provide traceable reasoning for every resolved capability.
- Return confidence scores for each resolved capability.
- Preserve unresolved hypotheses for future refinement.

---

## Inputs

The resolver accepts semantic interpretations produced by the Conversation Understanding Engine.

Example

Input

"I sell household items."

Semantic interpretation

General household goods retailer.

Broad capability statement.

Low specificity.

---

## Resolution Strategy

### Product Capabilities

For product-based businesses, the resolver SHALL resolve semantic meaning using the GS1 GPC knowledge base.

The GS1 taxonomy SHALL be treated as the authoritative source of canonical product capability identifiers.

Resolution consists of:

1. Retrieve candidate GPC nodes.
2. Rank candidates using semantic similarity.
3. Select highest confidence nodes.
4. Expand related nodes using GPC hierarchy.
5. Produce probabilistic capability hypotheses.

The resolver SHALL never create new GPC capability names.

---

### Service Capabilities

Service capabilities SHALL NOT depend on a predefined taxonomy.

Instead, the resolver SHALL invoke AI reasoning to infer:

- primary capability
- supporting capabilities
- prerequisite capabilities
- adjacent capabilities
- downstream capabilities
- upstream capabilities
- complementary capabilities

These inferred capabilities SHALL be stored as semantic capability objects inside Capability DNA.

Unlike product capabilities, service capabilities are dynamic and continuously refined by marketplace evidence.

---

## Candidate Retrieval

Product capability resolution SHALL follow a retrieval-first approach.

Pipeline

Semantic Meaning

↓

Vector Search over GPC

↓

Top Candidate Nodes

↓

AI Ranking

↓

Resolved Capability Set

The AI SHALL only rank retrieved candidates.

It SHALL NOT generate arbitrary capability identifiers.

---

## Capability Expansion

Once canonical capabilities have been resolved, the resolver SHALL expand related commercial capability hypotheses.

Expansion sources include:

- GPC hierarchy
- parent nodes
- child nodes
- sibling nodes
- business archetypes
- marketplace evidence
- commercial evidence graph

Expanded capabilities SHALL remain probabilistic until sufficient supporting evidence exists.

---

## Confidence Assignment

Every resolved capability SHALL contain:

- capability identifier
- canonical name
- confidence
- evidence source
- reasoning trace
- timestamp

Confidence SHALL represent the system's belief that the seller possesses the capability.

---

## Determinism Requirement

Given identical:

- user input
- GPC version
- capability graph
- commercial evidence

the resolver SHALL produce identical canonical capability identifiers.

Minor differences in AI reasoning SHALL NOT affect stored capability identifiers.

---

## Extensibility

The resolver SHALL support multiple capability domains.

Current

- Product Capabilities (GS1 GPC)

Future

- Services
- Skills
- Equipment
- Manufacturing
- Logistics
- Professional Expertise

without requiring architectural redesign.

---

# Testing the Current Architecture

We'll walk through the pipeline exactly as it exists today.

---

# Test Case 1 — Broad Statement

### Input

> "I sell household items."

---

## Step 1 — Conversation Understanding

Output

```text
Business Description

Broad Capability Statement

Business Type

General Household Goods

Specificity

Low
```

---

## Step 2 — Capability Resolver

Semantic search over GPC

Returns

```text
Household Products

Kitchen Merchandise

Cleaning Products

Storage & Organization

Laundry Products

Plastic Household Goods
```

---

## Step 3 — Capability Expansion

Expand nearby capability hypotheses

```text
Household Products

↓

Cleaning

↓

Laundry

↓

Kitchen

↓

Plastic Products
```

No capability is confirmed.

Only hypotheses.

---

## Step 4 — Evidence Object

```text
Evidence

Text

"I sell household items"

Supports

Household Products      0.93

Plastic Goods          0.58

Kitchen Merchandise    0.46

Cleaning Products      0.41

Laundry Products       0.32
```

---

## Step 5 — DNA Update

```text
Capability DNA

Household Products      0.93

Plastic Goods           0.58

Kitchen Merchandise     0.46

Cleaning Products       0.41

Laundry Products        0.32
```

No questions asked.

Learning continues later.

---

# Test Case 2 — Small Product List

Input

> "I sell buckets, basins and mops."

---

## Conversation Understanding

Recognizes

* Product List

Information density

High

---

## Capability Resolver

Each product resolves into GPC.

```text
Bucket

↓

Plastic Household Goods

Basin

↓

Plastic Household Goods

Mop

↓

Cleaning Products
```

---

Aggregate

```text
Plastic Household Goods

Cleaning Products

Household Products
```

---

Expansion

```text
Plastic Household Goods

↓

Storage

↓

Laundry

↓

Kitchen Containers
```

Those remain hypotheses.

---

Evidence

```text
Plastic Household Goods 0.96

Cleaning Products       0.88

Storage                 0.44

Laundry                 0.41

Kitchen Containers      0.28
```

---

DNA

```text
Plastic Household Goods 0.96

Cleaning Products       0.88

Storage                 0.44

Laundry                 0.41
```

Notice how much stronger the profile becomes than Test Case 1.

---

# Test Case 3 — Service Provider

Input

> "I repair generators."

There is no taxonomy.

---

## Conversation Understanding

Recognizes

```text
Business Description

Service

Repair

Target

Generator
```

---

## Service Capability Resolver

Instead of taxonomy

AI reasons.

Primary capability

```text
Generator Repair
```

Now it expands.

The AI asks

> If someone can repair generators,
> what related commercial capabilities are reasonably implied?

Possible output

```text
Generator Diagnostics

Generator Maintenance

Fault Troubleshooting

Generator Installation

Generator Parts Replacement

Electrical Repair

On-site Field Service

Preventive Maintenance

Power Equipment Knowledge
```

These are **capability hypotheses**, not guaranteed facts.

Each gets a confidence based on how directly it follows from the original statement. For example:

```text
Generator Repair             0.98
Generator Diagnostics        0.90
Generator Maintenance        0.82
Generator Parts Replacement  0.70
Electrical Repair            0.55
Generator Installation       0.35
Preventive Maintenance       0.40
```

---

## Evidence

```text
Source

Conversation

Original Text

"I repair generators"

Supports

Generator Repair

Generator Diagnostics

Generator Maintenance

Generator Parts Replacement
```

---

## DNA

```text
Generator Repair             0.98

Generator Diagnostics        0.90

Generator Maintenance        0.82

Generator Parts Replacement  0.70

Electrical Repair            0.55
```

---

# Later Matching

Customer

> "My generator won't start."

Matching Engine

Instead of matching only

```text
Generator Repair
```

it searches semantically across the provider's Service Capability DNA.

The request may resolve into:

```text
Generator Repair

Generator Diagnostics

Electrical Repair

Power Equipment Service
```

This means a provider who never explicitly said "I diagnose generators" can still be matched because that capability was reasonably inferred from stronger evidence. The Capability Matching Engine can rank them appropriately, using confidence scores to prioritize specialists while still surfacing adjacent providers when needed.

---


# Desired Test Outcomes -  **litmus test** for whether the architecture is correct.

If the system cannot intelligently handle:

> "I sell household items."

then it will almost certainly fail on the informal market, because that is exactly how people naturally describe their businesses.

However, The system should **never treat "I sell household items" as a classification task.** Instead, it should treat it as the beginning of a **hypothesis-generation and evidence-accumulation process**.

Let's walk through the entire lifecycle.

---

# Stage 1 — Raw Interaction

Seller sends on WhatsApp:

> "I sell household items."

At this point, the AI **knows almost nothing**.

It should resist the temptation to classify.

Instead, it creates a new observation.

```text
Observation #001

Type:
Natural Language Statement

Confidence:
High (the user definitely said it)

Meaning:
Unknown (needs interpretation)
```

Notice the distinction:

We are certain about **what was said**.

We are uncertain about **what it means**.

---

# Stage 2 — Conversation Understanding Engine

The language model interprets the sentence.

It identifies:

```text
Intent:
Business Description

Entity:
Household Items

Expression Type:
Broad Capability Statement

Specificity:
Very Low

Information Density:
Low

Requires Expansion:
Yes
```

Notice something important.

The engine does **not** ask:

> What category is this?

Instead it asks:

> What hypotheses does this statement support?

This is a completely different mindset.

---

# Stage 3 — Market Language Engine

Now the system asks:

> What does "household items" usually mean **in this market**?

This is where local knowledge becomes critical.

For example, in Nigeria:

"Household items" may commonly include:

* buckets
* basins
* plastic chairs
* brooms
* mops
* coolers
* kitchen utensils
* plates
* cups
* storage containers
* laundry baskets
* flasks
* hangers

In another country, it might lean toward furniture or home décor.

The interpretation is **market-aware**, not universal.

Output:

```text
Market Interpretation

Primary Prototype

General Household Goods Store

Confidence:
0.83
```

---

# Stage 4 — Semantic Compression Engine

This is where the real magic happens.

Humans compress.

AI expands.

The sentence

> "I sell household items"

is expanded into hypotheses.

Instead of one capability:

```text
Household Items
```

the engine generates:

```text
Household Goods

Kitchenware

Cleaning Supplies

Plastic Products

Storage Solutions

Home Organization

Laundry Accessories

Basic Home Essentials
```

Notice:

Nothing is confirmed.

Everything is a hypothesis.

---

# Stage 5 — Capability Resolution & Expansion

First the **Capability Resolver** maps each compressed hypothesis onto canonical capability identifiers (via GS1 GPC for products, AI reasoning for services), so nothing downstream ever depends on an invented name. The expanded names shown below are these resolved canonical capabilities, not free-text labels.

It then expands each resolved capability through the Capability Graph.

For example:

```text
Household Goods

↓

Kitchen

↓

Cookware

↓

Utensils

↓

Food Storage
```

Another branch:

```text
Household Goods

↓

Cleaning

↓

Buckets

↓

Mops

↓

Brooms
```

Another:

```text
Household Goods

↓

Plastic Products

↓

Basins

↓

Chairs

↓

Containers
```

The graph is expanding possibilities, not asserting inventory.

---

# Stage 6 — Evidence Generator

Now the system creates evidence.

```text
Evidence

Source:
Conversation

Original Text:
"I sell household items"

Supports:

Household Goods

0.92

Kitchenware

0.48

Cleaning Supplies

0.41

Plastic Goods

0.56

Storage Products

0.37

Home Organization

0.29
```

Notice the confidence decreases as we move away from the original statement.

---

# Stage 7 — Capability DNA Update

Instead of storing:

```text
Seller Category

Household
```

The DNA becomes:

```text
Capabilities

Household Goods

0.92

Plastic Products

0.56

Kitchenware

0.48

Cleaning

0.41

Laundry

0.31

Furniture

0.17

Lighting

0.06
```

Already this is far richer.

---

# Stage 8 — Curiosity Engine

Now the AI asks:

Should I ask something?

It evaluates:

Expected Information Gain.

If the seller is busy:

Don't ask.

Wait.

If there is an opportunity:

Ask ONE question.

Not

> List everything you sell.

Instead:

> When customers visit your shop, what do they usually ask for first?

This single question could collapse the uncertainty dramatically.

Suppose they answer:

> Mostly buckets and plastic chairs.

Now the graph changes.

Plastic Products jumps.

Furniture becomes Outdoor Plastic Furniture.

Kitchenware decreases.

---

# Stage 9 — Marketplace Learning

Buyer later asks:

> Do you have frying pans?

Seller:

> Yes.

Now:

Kitchenware ↑

---

Buyer:

> Do you have wardrobes?

Seller:

> No.

Furniture ↓

---

Buyer:

> Do you have laundry baskets?

Seller:

> Yes.

Storage ↑

Plastic ↑

Laundry ↑

---

Without asking the seller anything, the profile becomes increasingly accurate.

---

# Stage 10 — Long-Term Learning

After six months:

The AI now knows:

```text
Seller DNA

Primary

Plastic Household Goods

0.97

Cleaning Equipment

0.91

Laundry Accessories

0.88

Kitchen Storage

0.82

Furniture

0.14

Cookware

0.09
```

Notice:

The seller never filled out a form.

---

# One step further

## Separate "Declared Capability" from "Discovered Capability"

Every seller actually has two profiles.

### Declared Capability

What they say.

```text
Household Items
```

---

### Discovered Capability

What the AI has learned.

```text
Plastic Chairs

Buckets

Laundry Baskets

Mops

Storage Containers

Coolers

Brooms

Cleaning Brushes
```

The second profile becomes richer over time.

Eventually it may become more accurate than the first.

---

# Add another layer to the architecture

Currently:

```text
Conversation

↓

Understanding

↓

Evidence

↓

Inference

↓

DNA
```

I would insert a new layer.

```text
Conversation

↓

Understanding

↓

Prototype Generation

↓

Capability Resolution
(canonical resolve + capability expansion)

↓

Evidence

↓

Inference

↓

DNA
```

This **Prototype Generation Layer** is what allows the AI to think like a market expert. Prototype generation feeds the **Capability Resolver**, which performs the canonical resolution and capability expansion described earlier—so expansion is not a separate ad-hoc step but part of resolution, keeping every expanded hypothesis anchored to a canonical capability identifier.

When someone says:

> "I sell household items."

the AI first recognizes the **business archetype** ("general household goods shop") before reasoning about individual capabilities. That archetype carries prior knowledge about what such shops typically stock, what customers usually ask for, common co-occurring products, and regional variations. It doesn't assume the seller has every item; instead, it establishes a probabilistic starting point that subsequent interactions can refine.

## Why this matters

This addresses the central challenge: users in informal markets often communicate with broad, compressed, or imprecise language. Rather than forcing them to become more precise, the AI uses market knowledge to **expand broad statements into hypotheses**, then uses conversation and marketplace behavior to continuously confirm, weaken, or reject those hypotheses.

In other words:

> **Broad statements are not a problem to solve—they are seeds from which the Capability Discovery System grows an increasingly accurate understanding.**

This is one of the defining characteristics of the architecture. It doesn't demand precision from users; it generates precision through continuous reasoning learning and evidence accumulation.
