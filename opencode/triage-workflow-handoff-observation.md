# Observation Report: Triage Workflow Fallback & Handoff Issue

## Overview
When a user begins a conversation with a greeting (e.g., `"Hello"` or `"Hi"`), they receive a canned Phase 1 placeholder message (*"Got it — you want to list your business. Seller onboarding opens shortly..."*) upon selecting **"Sell"**, even though the **`VendorOnboarding`** workflow is fully implemented and registered in the application.

---

## Technical Root Cause Analysis

### 1. Initial Greeting Routing
- When a user sends a non-specific greeting like `"Hello"`, `IntentResolutionService` classifies the message intent as `smalltalk`.
- Neither `VendorOnboardingWorkflow` (priority `50`) nor `BuyerSearchWorkflow` (priority `50`) claims `smalltalk`.
- The system defaults to starting the **`TriageWorkflow`** (`triage.workflow.ts`, priority `-100`).

### 2. Triage Disambiguation State
- `TriageWorkflow` enters `Classify` $\rightarrow$ `AwaitDetail` state and prompts the user:
  > *"I want to make sure I help you with the right thing. Are you looking to buy something, or do you want to list your business so buyers can find you?"*
  > **Buttons**: `[I want to buy]` | `[I want to sell]`
- The conversation's active pointer (`activeWorkflowId`) is updated to the `TriageWorkflow` instance ID.

### 3. Active Workflow Resume & Placeholder Response
- When the user selects **"Sell"** (or taps `[I want to sell]`), `TurnProcessor` identifies an active workflow instance (`TriageWorkflow` in `AwaitDetail` state).
- Following standard continuity logic (**Case A: Continuing Active Workflow**), `TurnProcessor` resumes `TriageWorkflow` directly without re-evaluating workflow routing.
- `TriageWorkflow`'s `AwaitDetail.execute()` reads the choice (`vendor_onboarding`), retrieves the static Phase 1 placeholder text from `PLANNED_CAPABILITIES.vendor_onboarding.response`, returns that text, and marks `TriageWorkflow` as `Complete`.
- Result: The user is presented with the Phase 1 placeholder text instead of being transitioned into the live `VendorOnboardingWorkflow`.

---

## Affected Code Paths
- `src/domain/workflows/definitions/triage.workflow.ts`
  - Lines 32–51 (`PLANNED_CAPABILITIES` dictionary)
  - Lines 126–172 (`awaitDetail` state execution and `readChoice` logic)
- `src/application/pipeline/turn-processor.service.ts`
  - Lines 144–154 (`continuity.analyze` and workflow resumption)

---

## Recommended Fix for Engineers

To ensure users who select an option during Triage are smoothly transitioned into active feature workflows:

1. **Workflow Handoff / Delegation in Triage**:
   - In `triage.workflow.ts` (`awaitDetail.execute`), when `choice` resolves to a capability that has a registered full workflow (`vendor_onboarding` or `buyer_product_search`), do not return static `PLANNED_CAPABILITIES` text.
   - Instead, signal a workflow transition/handoff (or complete `Triage` and trigger the target workflow via `WorkflowManager`).

2. **Alternative (Routing Re-evaluation on Disambiguation)**:
   - When a triage disambiguation choice is selected, allow `TurnProcessor` or `WorkflowManager` to treat the resolved intent (`vendor_onboarding`) as a new workflow trigger so `VendorOnboardingWorkflow` is instantiated immediately.
