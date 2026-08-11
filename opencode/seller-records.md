# MetaMarket Seller Data Records — Mobinco Bookshop & AutoZone Ventures

Full database records for the two active sellers on the main `metamarket` DB (localhost:5434).

- **Snapshot taken:** 2026-08-11 ~19:00 (after latest activity at 17:10)
- **Source:** direct `psql` queries against `postgresql://metamarket:metamarket@localhost:5434/metamarket`
- **Schema:** Prisma (`prisma/schema.prisma`)

---

## ⚠️ CRITICAL — DB reset / re-onboarding note

The AutoZone Ventures record has been **re-created**. Sequence of events:

1. **2026-08-10 ~18:49** — AutoZone first onboarded as vendor `32282e43-1085-4ac8-9c5f-349a9fa954e2` in conversation `057e2358-8a30-453c-a0ed-a977d234567d` (onboarding text: *"I want to Sell" → "Auto parts"*).
2. Over **Aug 10–11** that first AutoZone accrued a full history: 34 capabilities, responded to the "brake pads" request (score 0.420, ~1.47M ms), wallet 2000→1900.
3. **2026-08-11 16:54–17:04** — that old AutoZone was **deleted and re-onboarded from scratch**: the new conversation `43f98cd3-5415-4d0a-83b8-de6b8478864a` starts at 16:54:59, and `seller.onboarded` fires at **17:04:36** under new vendor `d4a41eb5-24c0-466b-b50b-8c941a4d999e`.
4. Event tables (`marketplace_events`, `outbox_events`) **retain** the old AutoZone history (86 events for the old conversation); aggregate tables (`vendors`, `conversations`, `workflow_instances`, `credit_wallets`) only contain the new record.

Mobinco Bookshop (vendor `9a0efd77-803d-40eb-b6d7-87362d134521`) has **survived** both resets; its IDs are stable since 2026-08-10 18:41.

The two vendors are mutual buyers/sellers: each user also submits buyer requests, and the other vendor fulfills them (see cross-request section below).

---

# 1. Mobinco Bookshop

| Field | Value |
|---|---|
| business_name | Mobinco Bookshop |
| vendor id | `9a0efd77-803d-40eb-b6d7-87362d134521` |
| user id (WhatsApp) | `+2349127834513` |
| conversation id | `692b0d5c-2744-454b-9ac5-ad9a68becaaa` |
| status | active |
| city / state | Warri / Delta (Nigeria) |
| location_confidence | 1.000 |
| latitude / longitude | NULL / NULL |
| created_at | 2026-08-10 18:41:17.582 |
| updated_at | 2026-08-11 09:57:47.279 |

## 1.1 Onboarding timeline (conversation 692b0d5c)

| time (UTC) | direction | content |
|---|---|---|
| 18:41:05 | workflow | Triage started → Classify |
| 18:41:17 | workflow | Triage completed: "user wants to list your business" |
| 18:41:17 | workflow | VendorOnboarding started → AskCapability |
| 18:41:24 | evidence | statement "I want to Sell" → density `very_low`, no capabilities |
| 18:42:09 | evidence | statement "I have a bookshop" → density `medium` → archetype `bookshop` (Printed Books 0.95, Books Variety Packs 0.9, Exercise Books 0.9, Stationery chain) |
| 18:43:02 | wallet | `wallet.created` → wallet `0dcb4370-c720-4c6a-b824-bc24e2c1ad37` |
| 18:43:02 | wallet | `wallet.onboarding_credited` +2000 → balance 2000 (grant ref `onboarding:9a0efd77-...`) |
| 18:41:xx | workflow | VendorOnboarding completed: "sells 'I have a bookshop', in Warri, Delta, trading as Mobinco Bookshop. Profile created and searchable." |
| 18:44:xx | outbound | "All set, Mobinco Bookshop…" + 🎁 grant message sent |

## 1.2 Wallet (credit_wallets `0dcb4370-…`, user +2349127834513, NGN)

Current balance: **1500 credits** = 2000 onboarding grant − 5 × 100 request responses.

| time (UTC) | type | credits | reason | ref |
|---|---|---|---|---|
| 2026-08-10 18:43:02 | credit | +2000 | onboarding_grant | `onboarding:9a0efd77-...` |
| 2026-08-10 18:45:43 | debit | −100 | responded_to_customer_request (wedding cards) | `response:e053df2f...` |
| 2026-08-11 08:58:01 | debit | −100 | responded_to_customer_request (educational toys) | `response:9200cbc4...` |
| 2026-08-11 09:21:19 | debit | −100 | responded_to_customer_request (frames) | `response:4e35e0cc...` |
| 2026-08-11 09:35:05 | debit | −100 | responded_to_customer_request (photo album) | `response:7c218aaf...` |
| 2026-08-11 09:57:45 | debit | −100 | responded_to_customer_request (executive pens) | `response:1ad68646...` |

## 1.3 Capability DNA (vendor_capabilities) — 30 total (7 direct, 23 inferred)

Direct (evidence-backed), by confidence:

| capability | id | confidence | evidence_count |
|---|---|---|---|
| executive pens | 10001235 | 0.906 | 1 (accepted) |
| photo album | 10001495 | 0.906 | 1 (accepted) |
| frames | 10002246 | 0.906 | 1 (accepted) |
| educational toys | 10005159 | 0.906 | 1 (accepted) |
| Printed Books/Compositions | 10000926 | 0.658 | 1 (statement) |
| Books Variety Packs | 10004107 | 0.630 | 1 (statement) |
| Exercise Books | 10005893 | 0.630 | 1 (statement) |

Top inferred (taxonomy roll-ups of the above): Stationery/Office Machinery 0.891, Writing/Design Implements 0.844, Photography 0.844, Pictures/Mirrors/Frames 0.844, Developmental/Educational Toys 0.844, Books 0.515, plus 17 deeper ancestors (down to ~0.24).

## 1.4 Statement evidence (capability_evidence)

| source | original_text | density | supports |
|---|---|---|---|
| onboarding_statement | I want to Sell | very_low | [] (needs clarification) |
| onboarding_statement | I have a bookshop | medium | bookshop archetype: 16 capability links (Printed Books 0.95, Books Variety Packs 0.9, Exercise Books 0.9, Stationery chain 0.675…) |
| request_accepted | Accepted request for educational toys | high | 10005159 → Toys/Games chain |
| request_accepted | Accepted request for frames | high | 10002246 → Furnishings chain |
| request_accepted | Accepted request for photo album | high | 10001495 → Photography chain |
| request_accepted | Accepted request for executive pens | high | 10001235 → Writing Implements chain |

## 1.5 Behavioural evidence (evidence_records / evidence_aggregates)

Aggregate: vendor 5 delivered / 5 responded / 5 accepted; evidence_score 0.481; avg response 30.6 s (sum 153,000 ms).

| request | request_id | rank | score | responded_at | response_time_ms |
|---|---|---|---|---|---|
| wedding cards | e053df2f-4e2c-4688-89d4-793243169178 | 0 | 0.154 | 18:45:43 | 18,398 |
| educational toys | 9200cbc4-3572-4e32-ad50-4e06d061b627 | 0 | 0.141 | 08:58:01 | 31,508 |
| frames | 4e35e0cc-4f02-43d6-b113-4da6aa145edf | 0 | 0.139 | 09:21:19 | 40,309 |
| photo album | 7c218aaf-d9f0-4772-b2bf-c4f54c2c1202 | 0 | 0.137 | 09:35:05 | 24,154 |
| executive pens | 1ad68646-639c-43b8-ab3c-875276904611 | 0 | 0.201 | 09:57:45 | 39,430 |

All 5 deliveries: immediate=false, status=accepted, revealed_to_customer=true, credit_deducted=true.

## 1.6 Workflows (conversation 692b0d5c) — 9 total

| id | type | current_state | status | summary |
|---|---|---|---|---|
| dd377737-… | Triage | Complete | completed | user wants to list your business |
| f66092f7-… | VendorOnboarding | Complete | completed | sells "I have a bookshop", Warri/Delta, Mobinco Bookshop |
| 91d85060-… | BuyerSearch | Complete | completed | "steering cover" (18:50) |
| ff1d5088-… | BuyerSearch | WaitingForVendorResponses | suspended | "I need brake pads" (19:01) — delivered 0, awaiting 1 |
| 2f12040d-… | BuyerSearch | Complete | completed | "car steering cover" (08:30) |
| 68bffe4d-… | BuyerSearch | WaitingForVendorResponses | suspended | "I need wiper for my car" (08:50) |
| 20804305-… | BuyerSearch | WaitingForVendorResponses | suspended | "I need dashboard cover" (08:54) |
| 33cdcd39-… | BuyerSearch | WaitingForVendorResponses | suspended | "I need wheel cover" (09:22) |
| bfb136a4-… | BuyerSearch | WaitingForVendorResponses | **active** | "I need steering cover" (17:09) — delivered 0, awaiting 1 |

## 1.7 Outbound messages — 28 all `sent` (no failures)

---

# 2. AutoZone Ventures (current record)

| Field | Value |
|---|---|
| business_name | AutoZone Ventures |
| vendor id | `d4a41eb5-24c0-466b-b50b-8c941a4d999e` |
| user id (WhatsApp) | `+27640812552` |
| conversation id | `43f98cd3-5415-4d0a-83b8-de6b8478864a` |
| status | active |
| city / state | Warri / Delta (Nigeria) |
| location_confidence | 1.000 |
| latitude / longitude | NULL / NULL |
| created_at | 2026-08-11 17:02:36.284 |
| updated_at | 2026-08-11 17:10:31.594 |

## 2.1 Onboarding timeline (conversation 43f98cd3)

| time (UTC) | direction | content |
|---|---|---|
| 16:54:59 | user | "Hi" (cold open) |
| 16:55:05 | workflow | Triage `aaa0e684` started → Classify; question sent (buy/sell) |
| 16:55:05 | outbound | **FAILED** (connect timeout to graph.facebook.com, 2 attempts) |
| 17:01:58 | user | "Hi" again |
| 17:02:01 | outbound | re-sent buy/sell triage — sent ok |
| 17:02:15 | user | button_reply **"I want to Sell"** (`mm|aaa0e684-…|sell`) |
| 17:02:17 | workflow | Triage → Complete; VendorOnboarding `48be01eb` started → AskCapability |
| 17:02:41 | evidence | statement "I want to Sell" → density `very_low` |
| 17:02:43 | outbound | "What do you sell or what service do you provide?" |
| 17:03:05 | user | **"I sell auto parts"** |
| 17:03:38 | evidence | statement → density `medium` → archetype `auto parts dealer` (27 capability links) |
| 17:03:40 | outbound | "Which city and state is your business located in?" |
| 17:03:50 | user | "Warri" |
| 17:03:56 | outbound | "That's Warri in Delta State, right?" |
| 17:04:00 | user | "Yes" |
| 17:04:07 | outbound | "Lastly, what's your business name?" |
| 17:04:31 | user | "AutoZone Ventures" |
| 17:04:36 | events | `seller.onboarded` + `wallet.created` + onboarding grant +2000 + `workflow.completed` "sells 'I sell auto parts', Warri, Delta, trading as AutoZone Ventures. Profile created and searchable." |
| 17:04:37 | outbound | "All set, AutoZone Ventures… You're listed in Warri, Delta State…" |
| 17:04:47 | outbound | 🎁 grant message (2000 credits) |
| 17:09:45 | event | `request.delivered` for "steering cover" (rank 0, score 0.172, immediate=false) |
| 17:09:47 | outbound | "New Customer Request… 'Steering Wheel Covers'" + accept/decline buttons |
| 17:10:28 | user | button_reply **"Yes, I have it"** (`mm|vendor-response|accept_have|7baf8ab3-…`) |
| 17:10:29 | events | `wallet.debited` −100 (balance 1900), `request.accepted` (responseTime 45 s), evidence written |
| 17:10:32 | outbound | "🎉 You're in — your profile has been sent to the customer… Balance: 1900 Credits" |
| 17:10:46 | user | "Okay" |
| 17:10:50 | workflow | Triage `e015ca02` started → Classify → AwaitDetail (buying or selling?) — **active** |

## 2.2 Wallet (credit_wallets `1a6a8883-321a-4216-a426-0b14bb00154d`, user +27640812552, NGN)

Current balance: **1900 credits** = 2000 onboarding grant − 100 request response.

| time (UTC) | type | credits | reason | ref |
|---|---|---|---|---|
| 2026-08-11 17:04:36 | credit | +2000 | onboarding_grant | `onboarding:d4a41eb5-...` |
| 2026-08-11 17:10:29 | debit | −100 | responded_to_customer_request (steering cover) | `response:7baf8ab3...:d4a41eb5-...` |

## 2.3 Capability DNA (vendor_capabilities) — 30 total (1 direct, 29 inferred)

Full table (ordered by confidence; `inferred` = f means evidence-backed, t means taxonomy-inferred):

| capability_id | capability_name | log_odds | confidence | evidence_count | inferred |
|---|---|---|---|---|---|
| 10002863 | steering cover | 2.2654 | 0.9060 | 1 | f |
| 77011800 | Automotive Interior Accessories - Steering | 1.6854 | 0.8436 | 1 | t |
| 77010000 | Automotive Accessories and Maintenance | 1.6100 | 0.8334 | 2 | t |
| 77000000 | Vehicle | 0.7739 | 0.6844 | 2 | t |
| 10005130 | Cargo Management - Replacement Parts/Accessories | −0.3486 | 0.4137 | 1 | t |
| 10006384 | Brake Pads/Lining | −0.3486 | 0.4137 | 1 | t |
| 10003760 | Safety Replacement Parts/Accessories (Automotive) | −0.3486 | 0.4137 | 1 | t |
| 10005267 | Lubricating Oils/Fluids | −0.3486 | 0.4137 | 1 | t |
| 10000546 | Batteries | −0.3486 | 0.4137 | 1 | t |
| 10003011 | Wiper Blades | −0.3486 | 0.4137 | 1 | t |
| 10003022 | Filters - Air (Automotive) | −0.3486 | 0.4137 | 1 | t |
| 10005129 | Anti-theft Products Replacement Parts/Accessories | −0.3486 | 0.4137 | 1 | t |
| 10003012 | Wiper Blade Refills | −0.3486 | 0.4137 | 1 | t |
| 10003762 | Filters - Fluid (Automotive) | −0.3486 | 0.4137 | 1 | t |
| 10003142 | Wiper Arms (Automotive) | −0.3486 | 0.4137 | 1 | t |
| 10005232 | Batteries (Automotive) | −0.3486 | 0.4137 | 1 | t |
| 10003029 | Filters Other (Automotive) | −0.3486 | 0.4137 | 1 | t |
| 77010300 | Automotive Cargo Management | −0.6951 | 0.3329 | 1 | t |
| 77013600 | Automotive Wipers/Wiper Parts | −0.6951 | 0.3329 | 1 | t |
| 77013800 | Automotive Filters | −0.6951 | 0.3329 | 1 | t |
| 77013500 | Automotive Anti-theft Products | −0.6951 | 0.3329 | 1 | t |
| 77015000 | Automotive Batteries | −0.6951 | 0.3329 | 1 | t |
| 77015300 | Automotive Brakes | −0.6951 | 0.3329 | 1 | t |
| 77011300 | Automotive Safety | −0.6951 | 0.3329 | 1 | t |
| 88010100 | Lubricating Products | −0.6951 | 0.3329 | 1 | t |
| 78021100 | Batteries/Chargers | −0.6951 | 0.3329 | 1 | t |
| 78020000 | Electrical Connection/Distribution | −0.9550 | 0.2779 | 1 | t |
| 88010000 | Lubricants/Protective Compounds | −0.9550 | 0.2779 | 1 | t |
| 78000000 | Electrical Supplies | −1.1499 | 0.2405 | 1 | t |
| 88000000 | Lubricants | −1.1499 | 0.2405 | 1 | t |

Note: the single direct capability (steering cover, 0.906) was confirmed by the `request_accepted` at 17:10:29; the 27 statement-inferred capabilities all originated from the "I sell auto parts" statement at 17:03:38 (uniform log_odds −0.3486 → 0.4137, ancestors 0.33→0.24).

## 2.4 Statement evidence (capability_evidence)

| source | original_text | density | supports |
|---|---|---|---|
| onboarding_statement | I want to Sell | very_low | [] |
| onboarding_statement | I sell auto parts | medium | `auto parts dealer` archetype: 27 links (Brake Pads/Lining 0.55, Safety 0.55, Lubricating Oils 0.55, Batteries 0.55, Wiper Blades 0.55, Filters 0.55, Anti-theft 0.55, plus ancestor roll-ups 0.413–0.232) |
| request_accepted | Accepted request for steering cover | high | 10002863 → Automotive Interior Accessories – Steering chain (0.95→0.71→0.53→0.40) |

## 2.5 Behavioural evidence (evidence_records / evidence_aggregates)

Aggregate: vendor 1 delivered / 1 responded / 1 accepted; evidence_score 0.485 (confidence 0.05); response 45,000 ms.

Request: **steering cover** (`7baf8ab3-e8ab-47ff-b7b9-30226a4b822d`, placed by Mobinco user +2349127834513)
- delivery: rank 0, score 0.172, immediate=false, delivered 17:09:45, status accepted, revealed_to_customer=true, credit_deducted=true
- responded: 17:10:29, response_time_ms = 44,673
- evidence_records: 9 rows (delivered/responded/accepted × vendor/capability/product, all weight 1)

## 2.6 Workflows (conversation 43f98cd3) — 3 total

| id | type | current_state | status | summary |
|---|---|---|---|---|
| aaa0e684-c72f-4dce-95c1-d2f443014137 | Triage | Complete | completed | user wants to list your business |
| 48be01eb-7528-464c-9696-e446e022a376 | VendorOnboarding | Complete | completed | sells "I sell auto parts", Warri/Delta, AutoZone Ventures |
| e015ca02-906f-416e-8007-2eb8ee707e88 | Triage | AwaitDetail | **active** | intent unclear from "Okay"; asked buying or selling |

Transitions (`48be01eb`): AskCapability → AwaitCapability (cont.) → AwaitLocation (answer) → ConfirmState (answer) → AwaitBusinessName (clarification) → CreateProfile (answer) → Complete (answer). All trigger `continuation`/`answer`/`clarification`, none `engine_failure`.

## 2.7 Inbound messages — 9 (all text/button_reply), outbound messages — 11 (10 sent, 1 failed at 16:55:05)

Outbound flow: triage question (1 fail + 1 sent), capability ask, location ask, state confirm, business name ask, "All set", grant message, steering-cover request, "You're in", triage re-ask. All sent via WhatsApp Graph API with provider wamid.xxx IDs.

## 2.8 Marketplace events (vendor d4a41eb5) — 5

| event | request | product | notes |
|---|---|---|---|
| seller.onboarded | – | – | 10 top caps @ 0.414 |
| request.delivered | 7baf8ab3 | steering cover | immediate=false, capability 10002863 |
| vendor.notified | 7baf8ab3 | – | delivery `14aa13f9-…`, "Steering Wheel Covers" |
| vendor.credit.deducted | 7baf8ab3 | – | −100, capability 10002863 |
| request.accepted | 7baf8ab3 | steering cover | responseTime 45 |

---

# 3. Cross-request relationships

The two sellers act as buyers toward each other:

| request | by (user) | fulfilled by | credits |
|---|---|---|---|
| I need wedding cards | AutoZone (+27640812552) | Mobinco | 100 |
| I need educational toys | AutoZone | Mobinco | 100 |
| I need frames for putting certificate | AutoZone | Mobinco | 100 |
| I'm looking for photo album | AutoZone | Mobinco | 100 |
| I need executive pens | AutoZone | Mobinco | 100 |
| I need brake pads | Mobinco (+2349127834513) | AutoZone (old record) | 100 |
| I need steering cover | Mobinco | AutoZone (current) | 100 |

Open/unfulfilled requests (all `open`, workflows suspended or active):
steering cover (17:09, active), wiper, dashboard cover, wheel cover, educational toys, frames, photo album, executive pens, wedding cards, brake pads.

---

# 4. Environment state (at snapshot)

- Main DB: `metamarket` @ localhost:5434 — 2 vendors, 2 conversations, 30+30 capabilities, 252 marketplace_events, 252 outbox_events (all published), 10 customer_requests (all open), 12 workflow_instances, 28 transitions, 6 request_deliveries, 31 inbound_messages, 39 outbound_messages.
- Redis queues (`bull:media-processing`, etc.) empty; `outbound_messages` has only `sent`/`failed` rows (no pending) — the sweeper has drained everything.
- Outbound WhatsApp delivery intermittently fails with `Graph API / fetch: Connect Timeout` to `graph.facebook.com:443` (1 failed outbound in this conversation).
- Prisma Studio was running at http://localhost:5556 (may be stale).
