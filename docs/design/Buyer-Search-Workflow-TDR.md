# Buyer Search Workflow
## Technical Design Record (TDR)

## 1. Overview
This document outlines the updated technical requirements and business rules for the MetaMarket Buyer Search Workflow. The workflow focuses on accumulating marketplace evidence from user interactions while reducing the complexity of the previous matching iterations. It efficiently matches buyers with capable vendors and facilitates immediate connections via WhatsApp and SMS, while gracefully handling both product and service requests.

## 2. Business Rules & Logic

### 2.1 Core Matching Principles
- **Vendor Capability Matching:** Uses the existing Capability Matching Engine (CME) pipeline.
- **Geographic Filtering:** Only vendors located in the buyer's city OR state are presented to the buyer.
- **Immediate Top-Tier Presentation:** Vendors ranked highly by the CME (≥ 85% confidence score) in the buyer's city or state are shown to the buyer concurrently while customer request messages are fanned out to other matched vendors.
- **Product Name Resolution:** The system strictly uses the **Resolved Product Name** derived by the NLU/MCOS during the entire workflow (e.g., messaging vendors, sending vendor cards, saving inventory).
- **Service Vendors:** The identical logic and workflow apply to Service Vendors.

### 2.2 Vendor Fan-Out & Notification
Every matched vendor receives a WhatsApp message structured as follows:

```text
New Customer Request

A customer in [City] is looking for [Resolved Product Name]

Can you fulfill this request?  
1. [Yes, I have it]
2. [No, I don't have it]
3. [I can get it]
4. [I can refer someone]
5. [I don't sell this, not my line of business]
```

*Vendors can respond by replying with the corresponding numbers (separated by commas or dashes) or exact text. Multiple selections are supported and order independent. MCOS/CME must correctly map numbered responses to their corresponding textual intents.*

### 2.3 Vendor Response Handling & Learning
The system reacts to vendor responses as follows:

| Vendor Response | System Action | Learning System Update |
| :--- | :--- | :--- |
| **"Yes, I have it"** or **"I can get it"** | Sends the Vendor Profile Card to the buyer via WhatsApp. Adds the resolved product to the vendor's inventory. | Learns about vendor capability and inventory availability. |
| **"No, I don't have it"** | Replies to the vendor: "ok, noted". No profile is sent to the buyer. | Updates evidence to reflect temporary unavailability. |
| **"I can refer someone"** | Prompts vendor for the referred person's contact details. | Learns about the vendor's referral network. |
| **"I don't sell this, not my line of business"** | No profile is sent to the buyer. | Learns about vendor's business scope and corrects inaccurate capability mappings. |

#### Vendor Profile Card payload:
- Business name
- City
- Star ratings
- WhatsApp number
- Brief description of capability
- Interactive CTA: "Message Vendor" (Links buyer to a WhatsApp DM chat with the vendor directly or the business page).

### 2.4 Buyer Experience & Delay Tactics
- **Simulated Typing:** The workflow uses WhatsApp's typing indicator *only* when actively searching for vendors. It must not be used to mask loops, errors, or system glitches.
- **Acknowledgment Message:** The system informs the user it is searching and will notify them once capable vendors are found.
- **Never Say "No Vendors Found":** The system will **NEVER** explicitly state it couldn't find vendors. If zero vendors are matched, it gracefully falls back to: *"We're on it. We'll notify you as soon as we find the right vendors that can fulfill your request."*

### 2.5 Voice/Cross-Channel Handoff
If the customer initiates the search via a phone call (Twilio integration):
1. **Identification:** System answers and identifies the user via phone number (or saves for later).
2. **Intent & Search:** Customer selects "buy" and states their need. The product-search-workflow is utilized for intent understanding and clarification.
3. **Channel Selection:** System asks for the preferred delivery channel (WhatsApp or SMS) for vendor lists.
4. **Handoff:** Call ends gracefully. The product-search-workflow resumes asynchronously.
5. **Delivery:** System sends the list of capable vendors via the selected channel (WhatsApp and SMS).

## 3. Technical Considerations & Constraints
- **Architecture Adherence:** Must not deviate from existing architecture; relies on MCOS for conversational state and CME for vendor ranking.
- **System Stability:** MCOS must handle this multi-step workflow gracefully, preventing crashes, loops, or context loss.
- **Optimal Speed:** The vendor notification and vendor card fan-out mechanism must be highly optimized. Learning processes must not block or delay the delivery of vendor cards to the buyer.
