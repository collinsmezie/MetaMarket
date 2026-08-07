# Vendor Onboarding Flow (Updated)

## Overview

Vendor onboarding is the initial Capability Discovery session for a vendor.

Its purpose is to collect only the minimum amount of information required to create an initial Vendor DNA while minimizing cognitive load.

The onboarding workflow SHALL be orchestrated by the Conversation OS.

The Capability Discovery Engine SHALL continuously refine the Vendor DNA after onboarding using marketplace interactions.

---

# Workflow

## Step 1 — Capability Discovery

The AI SHALL ask the vendor:

> "What do you sell or what service do you provide?"

The vendor MAY respond using any natural language.

Examples include:

- Broad business descriptions
- Business domains
- Categories
- Subcategories
- Product lists
- Services
- Mixed capabilities
- Local market terminology
- Incomplete descriptions

All responses SHALL be processed by the Capability Discovery Engine.

The CDE SHALL generate:

- initial Capability DNA
- capability confidence scores
- expanded capability hypotheses
- information density
- ambiguity score

---

## Step 2 — Clarification (Optional)

The clarification gate SHALL key on **information density**, not ambiguity alone.

- A statement at `medium` density or above names a real commercial domain that the CDE can
  expand into concrete capability hypotheses. The engine already understood the vendor, so
  the AI SHALL NOT ask a clarification question.
- A contentless statement (`very_low` or `low` density — "I sell things", "anything",
  "market items") leaves nothing to expand. If the ambiguity score also exceeds the
  configured threshold, the AI SHALL spend the ONE clarification question.

The clarification question SHALL maximize expected information gain.

**Not clarified** — "I sell electrical things." is `medium` density. The CDE treats broad
statements as "seeds from which the system grows understanding" and expands this one into a
shop archetype with implied capabilities (wiring, breakers, sockets, bulbs, conduits), so
no question is asked and the clarification budget is untouched.

**Clarified** — a statement with nothing to expand:

Vendor

> "I sell things."

AI

> "Can you name the kinds of things you sell?"

The vendor's response SHALL be processed by the CDE.

The CDE SHALL update:

- capability confidence
- uncertainty
- capability graph
- Vendor DNA

### Clarification Budget

The onboarding workflow SHALL ask at most ONE clarification question, and only when a
statement has nothing to expand (`very_low`/`low` density). Information-dense statements
consume none of the budget.

If ambiguity remains after the clarification response, onboarding SHALL continue.

The system SHALL NOT continue asking additional clarification questions.

Remaining uncertainty SHALL be preserved inside the Vendor DNA as probabilistic capability hypotheses.

Future marketplace evidence SHALL be used to refine the profile.

Sources of future evidence include:

- inventory updates
- responses to customer requests
- successful matches
- rejected matches
- customer conversations
- subsequent onboarding conversations
- post onboarding conversations
- corrections made by the vendor

This ensures onboarding remains short while allowing continuous capability discovery.

---

## Step 3 — Location Discovery

The AI SHALL naturally ask for the vendor's business location.

Example:

> "Which city and state is your business located in?"

The vendor MAY respond naturally.

Examples

"Aba"

"Warri"

"Yaba"

"Enugu"

"Lagos"

"Aba, Abia"

The AI SHALL reason about the provided location.

If the AI has high confidence that the city belongs to a particular state, it SHALL naturally confirm the inference.

Example

Vendor

> "Warri"

AI

> "That's Warri in Delta State, right?"

Vendor

> "Yes."

The normalized location SHALL be stored as:

- City
- State
- Country

If the AI cannot confidently infer the state, it SHALL ask a single follow-up question.

Example

> "Which state is that in?"

The workflow SHALL continue once both city and state have been resolved.

---

## Step 4 — Business Name

The AI SHALL ask:

> "Lastly, what's your business name?"

Accepted values include:

- registered business names
- informal shop names
- trading names
- personal brands

The business name SHALL become the display name for the vendor profile.

---

## Step 5 — Vendor Profile Creation

The Vendor Profile Builder SHALL assemble:

- Business Name
- Normalized Location
- Capability DNA
- Confidence Scores
- Evidence Objects
- Capability Graph
- Conversation Summary
- Profile Metadata

The vendor SHALL become searchable immediately after profile creation.

Capability Discovery SHALL continue throughout the vendor's lifetime.