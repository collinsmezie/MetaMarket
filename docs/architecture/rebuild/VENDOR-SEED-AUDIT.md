# Vendor seed audit — 30 vendors through the live channels

Generated 2026-09-24T17:26:36.625Z from `seed/vendors-ng-30.json` and `latest ingest log`.

## Summary

| Metric | Value |
| --- | --- |
| Vendors in seed | 30 |
| Onboarded (status active) | 1 |
| Onboarding grant received | 1 |
| Vendors with ≥1 CSRE object | 3 |
| Vendors with ≥1 GPC mapping | 1 |
| Vendors with legacy capabilities | 1 |
| Vendors with Evidence SUPPLIES beliefs | 1 |
| GraphChangeDecisions emitted | 8 |

## v01 — Okonkwo Cement Depot (Building materials & cement)

- Style: **ITEMS** · Channel: **web** · Statement: "I sell Dangote cement, BUA cement, sharp sand and 12mm iron rods in Aba"
- Expected GPC anchor: Cement/Concrete/Mortar (CLASS)
- Vendor: status `onboarding`, ?, ?, contact —; turns PROCESSING
- **Wallet**: no wallet
- **CSRE objects** (4): "Dangote cement" → cement [PRODUCT, PROPOSED, 0.950]; "BUA cement" → cement [PRODUCT, PROPOSED, 0.950]; "sharp sand" → sharp sand [MATERIAL, PROPOSED, 0.900]; "12mm iron rods" → iron rods [MATERIAL, PROPOSED, 0.900]
- **GPC mappings** (0): —
- **Capability layer (legacy CDE)** (0): —
- **Evidence observations** (5): CSRE_SEMANTIC_RESOLUTION×4, ENRICHMENT_INSIGHT×1
- **Evidence vendor beliefs** (0): —
- **Evidence phrase/taxonomy assertions** (16): sharp sand EXPRESSES sharp sand = 0.210; 12mm iron rods EXPRESSES iron rods = 0.210; Dangote cement EXPRESSES cement = 0.222; BUA cement EXPRESSES cement = 0.222; cement HAS_ALIAS Portland cement = 0.045; cement HAS_ALIAS Hydraulic cement = 0.045; cement HAS_ALIAS Dangote Portland cement = 0.045; cement HAS_ALIAS Dangote cement = 0.045
- **GraphChangeDecisions** (0): — (all —)

## v02 — Musa Electricals Alaba (Electrical materials)

- Style: **MIXED** · Channel: **web** · Statement: "We deal in electrical materials: wall sockets, switches, 2.5mm cables, circuit breakers and energy bulbs"
- Expected GPC anchor: Electrical Cables (CLASS, 78040300)
- Onboarding turns: 4 (65s, 40s, 52s, 34s) · completed: true
- Vendor: status `active`, Ojo, Lagos State, contact +08090000002; turns COMMITTED, COMMITTED, COMMITTED, COMMITTED
- **Wallet**: balance 2000, onboarding grants 1 × 2000
- **CSRE objects** (7): "wall sockets" → wall socket [PRODUCT, PROPOSED, 0.950]; "switches" → switch [PRODUCT, PROPOSED, 0.950]; "2.5mm cables" → 2.5mm cable [PRODUCT, PROPOSED, 0.950]; "circuit breakers" → circuit breaker [PRODUCT, PROPOSED, 0.950]; "energy bulbs" → energy bulb [PRODUCT, PROPOSED, 0.950]; "Musa Electricals" → Musa Electricals [ORGANIZATION, PROPOSED, 0.900]; "Alaba" → Alaba International Market [PLACE, PROPOSED, 0.850]
- **GPC mappings** (2): Musa Electricals → NOT_APPLICABLE (0.000); Alaba International Market → NOT_APPLICABLE (0.000)
- **Capability layer (legacy CDE)** (8): Switches [product] 0.866; Circuit Breakers [product] 0.866; Electrical Distribution [product] 0.724 inferred; Electrical Connection/Distribution [product] 0.572 inferred; Sockets/Receptacles/Outlets [product] 0.561 inferred; Electrical Wires [product] 0.561 inferred; Light Bulbs/Tubes/Light-Emitting Diodes [product] 0.561 inferred; Electrical Supplies [product] 0.446 inferred
- **Evidence observations** (13): CSRE_SEMANTIC_RESOLUTION×7, ENRICHMENT_INSIGHT×2, WRS_EXTERNAL_EVIDENCE×1, GPC_MAPPING×2, VENDOR_STATEMENT×1
- **Evidence vendor beliefs** (6): SUPPLIES switches = 0.476 CANDIDATE; SUPPLIES 2.5mm cables = 0.476 CANDIDATE; SUPPLIES electrical materials = 0.476 CANDIDATE; SUPPLIES wall sockets = 0.476 CANDIDATE; SUPPLIES circuit breakers = 0.476 CANDIDATE; SUPPLIES energy bulbs = 0.476 CANDIDATE
- **Evidence phrase/taxonomy assertions** (34): wall sockets EXPRESSES wall socket = 0.222; switches EXPRESSES switch = 0.222; 2.5mm cables EXPRESSES 2.5mm cable = 0.222; circuit breakers EXPRESSES circuit breaker = 0.222; energy bulbs EXPRESSES energy bulb = 0.222; wall socket HAS_ALIAS electrical outlet = 0.045; wall socket HAS_ALIAS power socket = 0.045; wall socket HAS_ALIAS plug point = 0.045
- **GraphChangeDecisions** (8): ADD×8 (all PENDING)

## v03 — Chidi Plumbing Works (Plumbing materials)

- Style: **HYBRID** · Channel: **web** · Statement: "I sell PVC pipes, taps, water closets and fittings, and I also do plumbing installation and repairs"
- Expected GPC anchor: Plumbing/Heating/Ventilation/Air Conditioning (FAMILY, 79010000)
- Vendor: status `onboarding`, ?, ?, contact —; turns PROCESSING
- **Wallet**: no wallet
- **CSRE objects** (5): "PVC pipes" → PVC pipes [PRODUCT, PROPOSED, 0.950]; "taps" → taps [PRODUCT, PROPOSED, 0.950]; "water closets" → water closets [PRODUCT, PROPOSED, 0.950]; "fittings" → plumbing fittings [PRODUCT_CATEGORY, PROPOSED, 0.900]; "plumbing installation and repairs" → plumbing installation and repairs [SERVICE, PROPOSED, 0.950]
- **GPC mappings** (0): —
- **Capability layer (legacy CDE)** (0): —
- **Evidence observations** (5): CSRE_SEMANTIC_RESOLUTION×5
- **Evidence vendor beliefs** (0): —
- **Evidence phrase/taxonomy assertions** (5): taps EXPRESSES taps = 0.222; PVC pipes EXPRESSES PVC pipes = 0.222; water closets EXPRESSES water closets = 0.222; plumbing installation and repairs EXPRESSES plumbing installation and repairs = 0.222; fittings EXPRESSES fittings = 0.210
- **GraphChangeDecisions** (0): — (all —)

## v04 — Rainbow Paints Ilorin (Paints & coatings)

- Style: **CATEGORY** · Channel: **web** · Statement: "We are a paint and coatings shop"
- Expected GPC anchor: Paints/Varnishes (CLASS)
- Vendor: status `onboarding`, ?, ?, contact —; turns PROCESSING
- **Wallet**: no wallet
- **CSRE objects** (0): —
- **GPC mappings** (0): —
- **Capability layer (legacy CDE)** (0): —
- **Evidence observations** (0): —
- **Evidence vendor beliefs** (0): —
- **Evidence phrase/taxonomy assertions** (0): —
- **GraphChangeDecisions** (0): — (all —)

## v05 — Gbenga Roofing (Roofing)

- Style: **HYBRID** · Channel: **web** · Statement: "Aluminium roofing sheets, stone-coated roofing tiles and long span, plus roof installation and leak repairs"
- Expected GPC anchor: Roofing Tiles/Slates/Shingles/Shakes (BRICK, 10002683)
- **Vendor record: NOT CREATED**

## v06 — PowerHouse Generators (Generators & power)

- Style: **HYBRID** · Channel: **whatsapp** · Statement: "I sell Elepaq and Sumec Firman generators and I repair generators of all sizes"
- Expected GPC anchor: Generators (BRICK, 10005211)
- **Vendor record: NOT CREATED**

## v07 — SunLite Solar Kano (Solar & inverters)

- Style: **ITEMS** · Channel: **web** · Statement: "I sell 550W mono solar panels, 5kVA inverters and 200Ah tubular batteries"
- Expected GPC anchor: Solar Panels (BRICK, 10008389)
- **Vendor record: NOT CREATED**

## v08 — Computer Village Phones (Mobile phones & accessories)

- Style: **VENUE** · Channel: **web** · Statement: "I have a shop in Computer Village Ikeja where I sell phones, chargers and earpieces"
- Expected GPC anchor: Mobile Phones (BRICK, 10008506)
- **Vendor record: NOT CREATED**

## v09 — ByteWorks Abuja (Computers & laptops)

- Style: **HYBRID** · Channel: **web** · Statement: "We sell UK-used laptops and desktops and we fix laptops, replace screens and install software"
- Expected GPC anchor: Computers/Laptops (CLASS)
- **Vendor record: NOT CREATED**

## v10 — Coolzone Appliances (Home appliances)

- Style: **MIXED** · Channel: **web** · Statement: "Home appliances dealer: fridges, deep freezers, air conditioners, washing machines and standing fans"
- Expected GPC anchor: Refrigerator/Freezers (BRICK, 10003695)
- **Vendor record: NOT CREATED**

## v11 — Ladipo Auto Parts (Auto spare parts)

- Style: **VENUE** · Channel: **whatsapp** · Statement: "I sell at Ladipo market — tyres, brake pads, shock absorbers and Toyota spare parts"
- Expected GPC anchor: Tyres (BRICK, 10002924)
- **Vendor record: NOT CREATED**

## v12 — Baba Tunde Mechanic Workshop (Auto repair services)

- Style: **SERVICE** · Channel: **web** · Statement: "I am a mechanic. I do engine repairs, servicing, brake work and AC repair for cars"
- Expected GPC anchor: Automotive services (SERVICE (not in GPC))
- **Vendor record: NOT CREATED**

## v13 — Amaka's Boutique (Fashion & clothing)

- Style: **CATEGORY** · Channel: **web** · Statement: "We run a ladies' boutique for clothing and fashion accessories"
- Expected GPC anchor: Clothing (FAMILY)
- **Vendor record: NOT CREATED**

## v14 — Aba Made Shoes (Footwear)

- Style: **ITEMS** · Channel: **web** · Statement: "I make and sell leather sandals, men's loafers and school shoes"
- Expected GPC anchor: Footwear (CLASS)
- **Vendor record: NOT CREATED**

## v15 — Balogun Fabrics (Textiles & fabrics)

- Style: **VENUE** · Channel: **web** · Statement: "My shop is in Balogun market, I sell ankara, lace, aso-oke and senator materials"
- Expected GPC anchor: Fabrics/Textiles (CLASS)
- **Vendor record: NOT CREATED**

## v16 — Stitches by Halima (Tailoring)

- Style: **SERVICE** · Channel: **web** · Statement: "I am a tailor and fashion designer. I sew native wears, kaftans and wedding outfits"
- Expected GPC anchor: Tailoring services (SERVICE (not in GPC))
- **Vendor record: NOT CREATED**

## v17 — Glow Beauty Store (Beauty & cosmetics)

- Style: **MIXED** · Channel: **web** · Statement: "Cosmetics and skincare: body lotions, perfumes, human hair wigs and makeup kits"
- Expected GPC anchor: Cosmetics/Fragrances (FAMILY)
- **Vendor record: NOT CREATED**

## v18 — Kings Cut Barbershop (Hair & barbing services)

- Style: **SERVICE** · Channel: **web** · Statement: "We are a barbing salon offering haircuts, beard grooming and hair dye"
- Expected GPC anchor: Personal care services (SERVICE (not in GPC))
- **Vendor record: NOT CREATED**

## v19 — Onitsha Central Pharmacy (Pharmacy & medical supplies)

- Style: **MIXED** · Channel: **whatsapp** · Statement: "Pharmacy and medical supplies — drugs, blood pressure monitors, glucose strips, surgical gloves and face masks"
- Expected GPC anchor: Pharmaceutical Drugs (FAMILY)
- **Vendor record: NOT CREATED**

## v20 — Mile 12 Foodstuff (Foodstuff & grains)

- Style: **VENUE** · Channel: **web** · Statement: "I sell foodstuff in Mile 12 market: bags of rice, beans, garri, palm oil and yam"
- Expected GPC anchor: Grains/Rice (CLASS)
- **Vendor record: NOT CREATED**

## v21 — Mama Nkechi Provisions (Provisions & FMCG)

- Style: **CATEGORY** · Channel: **web** · Statement: "I run a provisions store"
- Expected GPC anchor: Food/Beverage/Tobacco (SEGMENT)
- **Vendor record: NOT CREATED**

## v22 — Iceberg Frozen Foods (Frozen foods & poultry)

- Style: **ITEMS** · Channel: **web** · Statement: "I sell frozen chicken, turkey wings, titus fish and croaker"
- Expected GPC anchor: Poultry - Unprepared/Unprocessed (BRICK)
- **Vendor record: NOT CREATED**

## v23 — Aqua Fresh Table Water (Bottled & sachet water)

- Style: **HYBRID** · Channel: **web** · Statement: "We produce and supply sachet water and bottled water, and we deliver to shops and events"
- Expected GPC anchor: Packaged Water (BRICK, 10000232)
- **Vendor record: NOT CREATED**

## v24 — Green Harvest Agro (Agro inputs & fertiliser)

- Style: **MIXED** · Channel: **web** · Statement: "Agro inputs dealer: NPK fertiliser, urea, herbicides, knapsack sprayers and hybrid maize seed"
- Expected GPC anchor: Plant/Soil Fertilizer/Food (BRICK, 10003234)
- **Vendor record: NOT CREATED**

## v25 — Oga Carpenter Furniture (Furniture)

- Style: **HYBRID** · Channel: **whatsapp** · Statement: "I make sofas, beds, wardrobes and dining sets, and I also do furniture repairs and upholstery"
- Expected GPC anchor: Household/Office Sofas (BRICK, 10002195)
- **Vendor record: NOT CREATED**

## v26 — Scholars Bookshop (Books & stationery)

- Style: **CATEGORY** · Channel: **web** · Statement: "We are a bookshop and stationery store"
- Expected GPC anchor: Stationery/Office Machinery (SEGMENT)
- **Vendor record: NOT CREATED**

## v27 — Little Ones Baby Store (Baby products)

- Style: **ITEMS** · Channel: **web** · Statement: "I sell Pampers diapers, baby wipes, feeding bottles and baby formula"
- Expected GPC anchor: Baby Diapers (Disposable) (BRICK, 10000494)
- **Vendor record: NOT CREATED**

## v28 — Sparkle Cleaning Supplies (Cleaning & household chemicals)

- Style: **MIXED** · Channel: **web** · Statement: "Cleaning supplies: detergents, bleach, iron sponge, mops and toilet paper in bulk"
- Expected GPC anchor: Laundry Detergents (BRICK, 10000424)
- **Vendor record: NOT CREATED**

## v29 — Royal Events Rentals (Event rentals & catering services)

- Style: **SERVICE** · Channel: **web** · Statement: "We rent canopies, chairs and tables for events and we also provide catering and decoration services"
- Expected GPC anchor: Event services (SERVICE (not in GPC))
- **Vendor record: NOT CREATED**

## v30 — SafeGuard PPE Warri (Industrial safety & PPE)

- Style: **ITEMS** · Channel: **whatsapp** · Statement: "I supply safety gloves, safety boots, helmets, reflective jackets and goggles to oil companies"
- Expected GPC anchor: Gloves (BRICK, 10005894)
- **Vendor record: NOT CREATED**
