# Seller Records: Mobinco Bookshop & AutoZone Ventures

> Full data records for two active sellers, pulled directly from the MetaMarket database (Postgres, `metamarket` DB) at 2026-08-10.
> Every record below is a faithful dump of the live rows — vendor profile, capability DNA, evidence, conversation history, wallet ledger, workflows, and delivery events.

---

## 1. Mobinco Bookshop

### 1.1 Vendor Profile (`vendors`)

| Field | Value |
|---|---|
| id | `9a0efd77-803d-40eb-b6d7-87362d134521` |
| user_id (WhatsApp) | `+2349127834513` |
| conversation_id | `692b0d5c-2744-454b-9ac5-ad9a68becaaa` |
| business_name | Mobinco Bookshop |
| city / state / country | Warri / Delta / Nigeria |
| location_confidence | 1.000 |
| latitude / longitude | (null) |
| status | active |
| declared_products | `{books}` |
| declared_services | `{}` |
| brands | `{}` |
| onboarded_at | 2026-08-10 18:43:02.721 |
| conversation_summary | `bookshop Capabilities: Printed Books/Compositions, Books Variety Packs, Exercise Books, Books, Stationery Paper/Card/Film, Stationery Paper/Card/Film Other, Textual/Printed/Reference Materials Variety Packs, Digital eBook Content, Stationery Item Storage/Desk Accessories, Stationery Files/Folders/Wallets, Textual/Printed/Reference Materials, Stationery/Office Machinery. Sells: books.` |

### 1.2 Capability DNA (`vendor_capabilities`) — 16 rows

| Capability | Confidence | Inferred | Evidence count |
|---|---|---|---|
| Printed Books/Compositions | 0.659 | no | 1 |
| Exercise Books | 0.630 | no | 1 |
| Books Variety Packs | 0.630 | no | 1 |
| Books | 0.515 | yes | 1 |
| Stationery Paper/Card/Film | 0.492 | yes | 1 |
| Stationery Paper/Card/Film Other | 0.414 | yes | 1 |
| Stationery Item Storage/Desk Accessories | 0.414 | yes | 1 |
| Stationery Files/Folders/Wallets | 0.414 | yes | 1 |
| Textual/Printed/Reference Materials Variety Packs | 0.414 | yes | 1 |
| Digital eBook Content | 0.414 | yes | 1 |
| Textual/Printed/Reference Materials | 0.404 | yes | 1 |
| Stationery/Office Machinery | 0.387 | yes | 1 |
| Stationery Storage/Filing | 0.333 | yes | 1 |
| Textual/Printed/Reference Materials Variety Packs | 0.333 | yes | 1 |
| Textual/Printed/Reference Materials | 0.326 | yes | 1 |
| Stationery/Office Machinery/Occasion Supplies | 0.315 | yes | 1 |

### 1.3 Capability Evidence (`capability_evidence`) — 2 rows

**Evidence #1 (vague statement, no capabilities derived)**
- source: `onboarding_statement`
- original_text: `I want to Sell`
- normalized_meaning: *The vendor's statement is too vague to determine any specific trade or product category. A clarification is necessary to proceed.*
- information_density: `very_low`
- supports: `[]`
- reasoning: *The vendor's statement is too vague to determine any specific trade or product category. A clarification is necessary to proceed.*
- observed_at: 2026-08-10 18:41:24.134

**Evidence #2 (the real statement)**
- source: `onboarding_statement`
- original_text: `I have a bookshop`
- normalized_meaning: `bookshop`
- information_density: `medium`
- supports (16 capabilities, strongest first):
  1. `Printed Books/Compositions` (id 10000926) — strength 0.95
  2. `Books Variety Packs` (id 10004107) — 0.90
  3. `Exercise Books` (id 10005893) — 0.90
  4. `Books` (id 60010200) — 0.7125
  5. `Stationery Paper/Card/Film` (id 62061100) — 0.675
  6. `Textual/Printed/Reference Materials` (id 60010000) — 0.534
  7. `Stationery Paper/Card/Film Other` (id 10005120) — 0.55
  8. `Textual/Printed/Reference Materials Variety Packs` (id 10002103) — 0.55
  9. `Digital eBook Content` (id 10000925) — 0.55
  10. `Stationery Item Storage/Desk Accessories` (id 10001320) — 0.55
  11. `Stationery Files/Folders/Wallets` (id 10001318) — 0.55
  12. `Stationery/Office Machinery` (id 62060000) — 0.506
  13. `Textual/Printed/Reference Materials Variety Packs` (id 60010100) — 0.4125
  14. `Stationery Storage/Filing` (id 62060900) — 0.4125
  15. `Textual/Printed/Reference Materials` (id 60000000) — 0.401
  16. `Stationery/Office Machinery/Occasion Supplies` (id 62000000) — 0.38
- reasoning: *The vendor explicitly stated they have a bookshop. This implies they sell books and potentially related items like stationery and educational materials.*
- observed_at: 2026-08-10 18:42:09.279

### 1.4 Conversation (`conversations`)

| Field | Value |
|---|---|
| id | `692b0d5c-2744-454b-9ac5-ad9a68becaaa` |
| user_id | `+2349127834513` |
| last_channel | whatsapp |
| memory_summary | (empty) |
| created_at / updated_at | 2026-08-10 18:41:03.229 / 19:01:58.597 |

### 1.5 Chat History (`history_entries`) — 15 turns

| # | Role | Content | Workflow | Timestamp |
|---|---|---|---|---|
| 1 | user | Hi | — | 18:41:03 |
| 2 | assistant | Hello! Welcome to MetaMarket… Are you looking to buy something, or do you want to list your business? | Triage `dd377737-…` | 18:41:06 |
| 3 | user | I want to Sell | — | 18:41:16 |
| 4 | assistant | What do you sell or what service do you provide? | Onboarding `f66092f7-…` | 18:41:26 |
| 5 | user | I have a bookshop | — | 18:41:56 |
| 6 | assistant | Which city and state is your business located in? | Onboarding | 18:42:12 |
| 7 | user | Warri | — | 18:42:20 |
| 8 | assistant | That's Warri in Delta State, right? | Onboarding | 18:42:27 |
| 9 | user | Yes pls | — | 18:42:39 |
| 10 | assistant | Lastly, what's your business name? | Onboarding | 18:42:46 |
| 11 | user | Mobinco Bookshop | — | 18:42:58 |
| 12 | assistant | 🎁 Welcome, Grant Received! You have been credited with 2000 free visibility credits… Balance: 2000 | (wallet push) | 18:43:02 |
| 13 | assistant | All set, Mobinco Bookshop. You're listed in Warri, Delta State… | Onboarding `f66092f7-…` | 18:43:04 |
| 14 | assistant | New Customer Request — customer in Warri looking for "Greeting Cards/Invitations". Can you fulfill? | (fan-out) | 18:45:26 |
| 15 | user | Yes, I have it | — | 18:45:43 |
| 16 | assistant | 🎉 You're in — your profile has been sent to the customer. Balance: 1900 Credits | (wallet push) | 18:45:44 |
| 17 | user | I'm looking for steering cover | — | 18:50:35 |
| 18 | assistant | We're checking across our seller network for *steering cover*… | BuyerSearch `91d85060-…` | 18:50:54 |
| 19 | user | I need brake pads | — | 19:01:37 |
| 20 | assistant | We found a match for *brake pads*: **AutoZone Ventures**, Warri, Delta ⭐⭐⭐⭐⭐… | BuyerSearch `ff1d5088-…` | 19:01:58 |

### 1.6 Wallet & Ledger (`credit_wallets` + `credit_transactions`)

**Wallet:** id `0dcb4370-…`, user `+2349127834513`, **balance 1900 credits**

| Type | Amount | Reason | Provider reference | Metadata | Created |
|---|---|---|---|---|---|
| credit | 2000 | onboarding_grant | `onboarding:9a0efd77-…` | `{grant: onboarding, vendorId: 9a0efd77-…, triggeredBy: seller.onboarded}` | 18:43:02 |
| debit | 100 | responded_to_customer_request | `response:e053df2f-…:9a0efd77-…` | `{product: wedding cards, requestId: e053df2f-…, deliveryId: f9cf941b-…, capabilityId: 10001209}` | 18:45:43 |

### 1.7 Workflows (`workflow_instances`) — 4

| Type | Current state | Status | Priority | Resumable | Summary |
|---|---|---|---|---|---|
| Triage | Complete | completed | -100 | yes | Triage: user wants to list your business. |
| VendorOnboarding | Complete | completed | 50 | yes | Vendor onboarding: sells "I have a bookshop", in Warri, Delta, trading as Mobinco Bookshop |
| BuyerSearch | Complete | completed | 50 | yes | Buyer search: "steering cover" registered for network vendor discovery. |
| BuyerSearch | WaitingForVendorResponses | active | 50 | yes | Buyer search: "I need brake pads". Delivered 0 vendor(s), awaiting 1 more. |

### 1.8 Delivered Requests (`request_deliveries`)

| Query | Capability | Rank | Score | Status | Revealed | Credit deducted | Delivered | Responded | Response time |
|---|---|---|---|---|---|---|---|---|---|
| I need wedding cards | Greeting Cards/Invitations | 0 | 0.154 | accepted | yes | yes | 18:45:24.683 | 18:45:43.081 | 18,398 ms |

### 1.9 Outbound Messages (`outbound_messages`) — 11, all `sent`

Hello → What do you sell → Which city/state → That's Warri right? → Lastly business name → **All set, Mobinco Bookshop** → **🎁 Grant Received** → **New Customer Request** → **🎉 You're in** → steering cover reply → **brake pads match**. All delivered on first attempt, no errors.

---

## 2. AutoZone Ventures

### 2.1 Vendor Profile (`vendors`)

| Field | Value |
|---|---|
| id | `32282e43-1085-4ac8-9c5f-349a9fa954e2` |
| user_id (WhatsApp) | `+27640812552` |
| conversation_id | `057e2358-8a30-453c-a0ed-a977d234567d` |
| business_name | AutoZone Ventures |
| city / state / country | Warri / Delta / Nigeria |
| location_confidence | 1.000 |
| latitude / longitude | (null) |
| status | active |
| declared_products | `{}` |
| declared_services | `{}` |
| brands | `{}` |
| onboarded_at | 2026-08-10 18:49:31.129 |
| conversation_summary | `automotive spare parts dealer Capabilities: Other Parts for Brake Systems, Batteries, Motorcycle Engine - Replacement Parts/Accessories, Structural Components/Assemblies Replacement Parts/Accessories, Lighting - Other, Brake Disc, Brake Pads/Lining, Motorcycle Engine, Filters/Covers (Electronic Equipment), Built-in Lighting, Mounted Lighting, Filters - Air (Automotive).` |

> Note: this vendor was onboarded via the *clarification path* — the first message was too vague, so the CDE asked "What do you sell?" and only derived capabilities after the follow-up "Auto parts".

### 2.2 Capability DNA (`vendor_capabilities`) — 34 rows

| Capability | Confidence | Inferred | Evidence count |
|---|---|---|---|
| Brake Pads/Lining | 0.414 | yes | 1 |
| Built-in Lighting | 0.414 | yes | 1 |
| Filters/Covers (Electronic Equipment) | 0.414 | yes | 1 |
| Other Parts for Brake Systems | 0.414 | yes | 1 |
| Batteries | 0.414 | yes | 1 |
| Motorcycle Engine - Replacement Parts/Accessories | 0.414 | yes | 1 |
| Structural Components/Assemblies Replacement Parts/Accessories | 0.414 | yes | 1 |
| Lighting - Other | 0.414 | yes | 1 |
| Brake Disc | 0.414 | yes | 1 |
| Motorcycle Engine | 0.414 | yes | 1 |
| Batteries (Automotive) | 0.414 | yes | 1 |
| Filters - Fluid (Automotive) | 0.414 | yes | 1 |
| Filters - Air (Automotive) | 0.414 | yes | 1 |
| Mounted Lighting | 0.414 | yes | 1 |
| Automotive Batteries | 0.333 | yes | 1 |
| Automotive Filters | 0.333 | yes | 1 |
| Lamps/Light Bulbs/Lighting | 0.333 | yes | 1 |
| Computer/Video Game Accessories | 0.333 | yes | 1 |
| Lighting - Other | 0.333 | yes | 1 |
| Structural Components/Assemblies | 0.333 | yes | 1 |
| Motorcycle Engine | 0.333 | yes | 1 |
| Batteries/Chargers | 0.333 | yes | 1 |
| Automotive Brakes | 0.333 | yes | 1 |
| Lighting | 0.278 | yes | 1 |
| Automotive Accessories and Maintenance | 0.278 | yes | 1 |
| Electrical Connection/Distribution | 0.278 | yes | 1 |
| Motorcycle Accessories and Maintenance | 0.278 | yes | 1 |
| Building Products | 0.278 | yes | 1 |
| Computers/Video Games | 0.278 | yes | 1 |
| Vehicle | 0.241 | yes | 1 |
| Computing | 0.241 | yes | 1 |
| Lighting | 0.241 | yes | 1 |
| Building Products | 0.241 | yes | 1 |
| Electrical Supplies | 0.241 | yes | 1 |

### 2.3 Capability Evidence (`capability_evidence`) — 2 rows

**Evidence #1 (vague statement, no capabilities derived)**
- source: `onboarding_statement`
- original_text: `I want to Sell`
- normalized_meaning: *The vendor's statement is too broad to determine any specific trade or product category. A clarification is necessary to proceed.*
- information_density: `very_low`
- supports: `[]`
- reasoning: *The vendor's statement is too broad to determine any specific trade or product category. A clarification is necessary to proceed.*
- observed_at: 2026-08-10 18:46:57.403

**Evidence #2 (the real statement)**
- source: `onboarding_statement`
- original_text: `Auto parts`
- normalized_meaning: `automotive spare parts dealer`
- information_density: `medium`
- supports (33 capabilities, all `positive`, strongest first):
  1. `Other Parts for Brake Systems` (id 10006388) — 0.55
  2. `Batteries` (id 10000546) — 0.55
  3. `Motorcycle Engine - Replacement Parts/Accessories` (id 10008477) — 0.55
  4. `Structural Components/Assemblies Replacement Parts/Accessories` (id 10003943) — 0.55
  5. `Lighting - Other` (id 10006896) — 0.55
  6. `Brake Disc` (id 10006385) — 0.55
  7. `Brake Pads/Lining` (id 10006384) — 0.55
  8. `Motorcycle Engine` (id 10008476) — 0.55
  9. `Filters/Covers (Electronic Equipment)` (id 10001110) — 0.55
  10. `Built-in Lighting` (id 10008402) — 0.55
  11. `Mounted Lighting` (id 10008403) — 0.55
  12. `Filters - Air (Automotive)` (id 10003022) — 0.55
  13. `Filters - Fluid (Automotive)` (id 10003762) — 0.55
  14. `Batteries (Automotive)` (id 10005232) — 0.55
  15. `Automotive Brakes` (id 77015300) — 0.4125
  16. `Batteries/Chargers` (id 78021100) — 0.4125
  17. `Motorcycle Engine` (id 77080200) — 0.4125
  18. `Structural Components/Assemblies` (id 83010700) — 0.4125
  19. `Lighting - Other` (id 14010300) — 0.4125
  20. `Computer/Video Game Accessories` (id 65010100) — 0.4125
  21. `Lamps/Light Bulbs/Lighting` (id 14010100) — 0.4125
  22. `Automotive Filters` (id 77013800) — 0.4125
  23. `Automotive Batteries` (id 77015000) — 0.4125
  24. `Automotive Accessories and Maintenance` (id 77010000) — 0.309
  25. `Electrical Connection/Distribution` (id 78020000) — 0.309
  26. `Motorcycle Accessories and Maintenance` (id 77080000) — 0.309
  27. `Building Products` (id 83010000) — 0.309
  28. `Computers/Video Games` (id 65010000) — 0.309
  29. `Vehicle` (id 77000000) — 0.232
  30. `Electrical Supplies` (id 78000000) — 0.232
  31. `Lighting` (id 14000000) — 0.232
  32. `Building Products` (id 83000000) — 0.232
  33. `Computing` (id 65000000) — 0.232
- reasoning: *The vendor mentioned 'auto parts', which clearly indicates a business dealing in automotive spare parts. I expanded this to include common items associated with this trade.*
- observed_at: 2026-08-10 18:48:31.144

### 2.4 Conversation (`conversations`)

| Field | Value |
|---|---|
| id | `057e2358-8a30-453c-a0ed-a977d234567d` |
| user_id | `+27640812552` |
| last_channel | whatsapp |
| memory_summary | (empty) |
| created_at / updated_at | 2026-08-10 18:45:11.749 / 19:26:30.823 |

### 2.5 Chat History (`history_entries`) — 16 turns

| # | Role | Content | Workflow | Timestamp |
|---|---|---|---|---|
| 1 | user | I need wedding cards | — | 18:45:11 |
| 2 | assistant | We found a match for *wedding cards*: **Mobinco Bookshop**, Warri, Delta ⭐⭐⭐⭐⭐… | BuyerSearch `304900bb-…` | 18:45:27 |
| 3 | user | Hi | — | 18:46:39 |
| 4 | assistant | Hello! Welcome to MetaMarket… buy or list? | Triage `0cc89fd1-…` | 18:46:44 |
| 5 | user | I want to Sell | — | 18:46:50 |
| 6 | assistant | What do you sell or what service do you provide? | Onboarding `b004a12d-…` | 18:46:58 |
| 7 | user | Auto parts | — | 18:48:14 |
| 8 | assistant | Which city and state is your business located in? | Onboarding | 18:48:33 |
| 9 | user | Warri | — | 18:48:47 |
| 10 | assistant | That's Warri in Delta State, right? | Onboarding | 18:48:54 |
| 11 | user | Yes | — | 18:48:59 |
| 12 | assistant | Lastly, what's your business name? | Onboarding | 18:49:06 |
| 13 | user | AutoZone Ventures | — | 18:49:26 |
| 14 | assistant | 🎁 Welcome, Grant Received! 2000 credits. Balance: 2000 | (wallet push) | 18:49:31 |
| 15 | assistant | All set, AutoZone Ventures. You're listed in Warri, Delta State… | Onboarding | 18:49:32 |
| 16 | assistant | New Customer Request — customer in Warri looking for "Brake Pads/Lining". Can you fulfill? | (fan-out) | 19:01:57 |
| 17 | user | Yes, I have it | — | 19:26:28 |

### 2.6 Wallet & Ledger (`credit_wallets` + `credit_transactions`)

**Wallet:** id `2a1ac11a-…`, user `+27640812552`, **balance 1900 credits**

| Type | Amount | Reason | Provider reference | Metadata | Created |
|---|---|---|---|---|---|
| credit | 2000 | onboarding_grant | `onboarding:32282e43-…` | `{grant: onboarding, vendorId: 32282e43-…, triggeredBy: seller.onboarded}` | 18:49:31 |
| debit | 100 | responded_to_customer_request | `response:73f097b7-…:32282e43-…` | `{product: brake pads, requestId: 73f097b7-…, deliveryId: 2bda9941-…, capabilityId: 10006384}` | 19:26:29 |

### 2.7 Workflows (`workflow_instances`) — 3

| Type | Current state | Status | Priority | Resumable | Summary |
|---|---|---|---|---|---|
| BuyerSearch | WaitingForVendorResponses | suspended | 50 | yes | Buyer search: "I need wedding cards". Delivered 0 vendor(s), awaiting 1 more. |
| Triage | Complete | completed | -100 | yes | Triage: user wants to list your business. |
| VendorOnboarding | Complete | completed | 50 | yes | Vendor onboarding: sells "Auto parts", in Warri, Delta, trading as AutoZone Ventures |

### 2.8 Delivered Requests (`request_deliveries`)

| Query | Capability | Rank | Score | Status | Revealed | Credit deducted | Delivered | Responded | Response time |
|---|---|---|---|---|---|---|---|---|---|
| I need brake pads | Brake Pads/Lining | 0 | 0.420 | accepted | yes | yes | 19:01:55.245 | 19:26:29.004 | 1,473,759 ms (~24.6 min) |

### 2.9 Outbound Messages (`outbound_messages`) — 10

- 9 × `sent` (wedding-cards match, triage hello, the 5 onboarding questions, **All set**, **Grant Received**, **New Customer Request**)
- 1 × `failed` on 1 attempt: the **🎉 You're in — profile sent to the customer** push at 19:26:29.030 with `Graph API 403: There was a problem with the access…` (delivery error; the ledger debit still applied — see 2.6).

---

## 3. Cross-Seller Notes & Anomalies

1. **Both vendors sit in Warri, Delta** and each fulfilled one customer request:
   - Mobinco → *wedding cards* (match score 0.154, responded in 18s)
   - AutoZone → *brake pads* (match score 0.420, responded in ~24.6 min)
   Each paid the 100-credit visibility fee, both wallets at **1900 credits**.
2. **Both were demoed end-to-end through the clarification path**: `I want to Sell` → CDE asked a clarifying question → real statement (`I have a bookshop` / `Auto parts`) → capability DNA derived. The `very_low`-density evidence rows (empty `supports`) are preserved as evidence of the vague first messages.
3. **Mobinco's 3 direct (non-inferred) capabilities** (Printed Books/Compositions 0.659, Exercise Books 0.630, Books Variety Packs 0.630) are its most confident — the vendor explicitly said "bookshop". AutoZone's are all inferred from the generic phrase "auto parts", so its top confidences sit lower (0.414).
4. **The mutual cross-match is visible in history**: AutoZone's first turn (buying wedding cards) matched *Mobinco Bookshop*; Mobinco's later "I need brake pads" matched *AutoZone Ventures* — each seller's DNA surfaced the other.
5. **One delivery failure**: AutoZone's "You're in" push failed with `Graph API 403` (access-token problem) — the message is parked in the outbound queue; the credit debit is unaffected (wallet events record independently of delivery).
6. **Stale workflow**: Mobinco's `BuyerSearch` "I need brake pads" remains `active`/`WaitingForVendorResponses` despite the delivery record for AutoZone showing `accepted`. The "wedding cards" BuyerSearch on AutoZone's conversation is `suspended` — both look like they need a timeout/completion pass.
