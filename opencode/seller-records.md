# MetaMarket Seller Data Records — Deep Reasoning (o3-mini) Live CDE Test

Full database records for 16 distinct vendors onboarded via the CDE pipeline using OpenAI **o3-mini** deep reasoning.

- **Snapshot taken:** 2026-08-13T10:33:10.447Z
- **Pipeline:** CDE Direct Onboarding & Live WhatsApp Onboarding → BusinessUnderstanding (o3-mini) → Contextualized Retrieval → CDE Capability DNA
- **Total Vendors:** 16 (3 Item-Dense, 13 Broad/Low-Density & Live Onboarded)

---

## 1. Delta Building Materials (+2348031110001)

| Field | Value |
|---|---|
| business_name | Delta Building Materials |
| vendor_id | `b1111111-1111-4111-8111-111111111111` |
| user_id | `+2348031110001` |
| status | active |
| city / state | Warri / Delta State |
| original_input_statement | "I sell building materials, cement, roofing sheets, iron rods, and blocks" |
| scenario_category | Specific Items / Bricks (High Density) |
| conversation_summary | building materials dealer Sells: cement, roofing sheets, iron rods. |
| total_capabilities | 23 (Direct: 3, Inferred: 20) |
| created_at | 2026-08-13T09:28:22.679Z |

### 1.1 Capability DNA (`vendor_capabilities`) — 23 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Cement | `10002526` | 81.8% (0.818) | Direct / Inferred Resolved | 1.5054 |
| Cement Supply | `svc_cement_supply` | 81.8% (0.818) | Direct / Inferred Resolved | 1.5054 |
| Mortar/Cement/Plaster/Grout Additives | `10008045` | 81.8% (0.818) | Direct / Inferred Resolved | 1.5054 |
| Asphalt/Concrete/Masonry | `83010600` | 66.7% (0.667) | Taxonomy Inferred | 0.6954 |
| Brick/Block | `10002525` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Building Materials Delivery | `svc_building_materials_delivery` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Construction Materials Supply | `svc_construction_materials_supply` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Household Paints | `10003874` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Material Quantity Estimation | `svc_material_quantity_estimation` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Nails/Pins (Fixings/Fasteners) | `10003182` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Plywood/OSB/Wood Boards | `10002538` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Roofing Panels/Slabs | `10002686` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Screws | `10003181` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Building Products | `83010000` | 52.2% (0.522) | Taxonomy Inferred | 0.0879 |
| Bulk Aggregates Supply | `svc_bulk_aggregates_supply` | 51.6% (0.516) | Taxonomy Inferred | 0.0654 |
| Fixings/Fasteners Hardware | `83011900` | 43.8% (0.438) | Taxonomy Inferred | -0.2496 |
| Lumber/Wood Panel/Gypsum | `83010800` | 43.8% (0.438) | Taxonomy Inferred | -0.2496 |
| Painting | `83010400` | 43.8% (0.438) | Taxonomy Inferred | -0.2496 |
| Roofing | `83011700` | 43.8% (0.438) | Taxonomy Inferred | -0.2496 |
| Construction Procurement Consulting | `svc_construction_procurement_consulting` | 42.7% (0.427) | Taxonomy Inferred | -0.2946 |
| Building Products | `83000000` | 40.9% (0.409) | Taxonomy Inferred | -0.3677 |
| Heavy Truck Transportation | `svc_heavy_truck_transportation` | 38.4% (0.384) | Taxonomy Inferred | -0.4746 |
| On-Site Offloading Services | `svc_on_site_offloading_services` | 34.2% (0.342) | Taxonomy Inferred | -0.6546 |

---

## 2. Kano Solar & Electrical Supplies (+2348032220002)

| Field | Value |
|---|---|
| business_name | Kano Solar & Electrical Supplies |
| vendor_id | `b2222222-2222-4222-8222-222222222222` |
| user_id | `+2348032220002` |
| status | active |
| city / state | Kano / Kano State |
| original_input_statement | "I sell solar panels, inverters, electrical cables and solar batteries" |
| scenario_category | Specific Items / Bricks (High Density) |
| conversation_summary | solar energy equipment dealer Sells: solar panels, inverters, electrical cables. |
| total_capabilities | 32 (Direct: 2, Inferred: 30) |
| created_at | 2026-08-13T09:29:54.816Z |

### 2.1 Capability DNA (`vendor_capabilities`) — 32 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Inverters | `10008390` | 90.6% (0.906) | Direct / Inferred Resolved | 2.2654 |
| Solar Panels | `10008389` | 90.6% (0.906) | Direct / Inferred Resolved | 2.2654 |
| Electrical Generation | `78021200` | 82.2% (0.822) | Taxonomy Inferred | 1.5297 |
| Battery Boxes | `10005764` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Battery Storage Installation | `svc_battery_storage_installation` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Charge/Voltage Regulators | `10008391` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Connectors (Electrical) | `10005573` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Distribution Boards/Boxes | `10005583` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Electrical Generation Accessories/Fittings | `10008395` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Fuses | `10000549` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Inverter Installation | `svc_inverter_installation` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Lightning Rods/Accessories | `10005391` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Mounting Rails | `10006794` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Solar Panel Installation | `svc_solar_panel_installation` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Solar Power System Design | `svc_solar_power_system_design` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Solar Power System Installation | `svc_solar_power_system_installation` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Solar Power System Maintenance | `svc_solar_power_system_maintenance` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Solar Power System Troubleshooting | `svc_solar_power_system_troubleshooting` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Surge Suppressors/Protectors | `10005585` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Switches | `10005586` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Electrical Connection/Distribution | `78020000` | 67.1% (0.671) | Taxonomy Inferred | 0.7136 |
| Solar Energy Consultation | `svc_solar_energy_consultation` | 64.7% (0.647) | Taxonomy Inferred | 0.6054 |
| Batteries/Chargers | `78021100` | 54.9% (0.549) | Taxonomy Inferred | 0.1959 |
| Electrical Connection | `78020500` | 54.9% (0.549) | Taxonomy Inferred | 0.1959 |
| Electrical Distribution | `78020600` | 54.9% (0.549) | Taxonomy Inferred | 0.1959 |
| Fixings/Fasteners Hardware | `83011900` | 54.9% (0.549) | Taxonomy Inferred | 0.1959 |
| Weather/Natural Disaster Safety Products | `91020200` | 54.9% (0.549) | Taxonomy Inferred | 0.1959 |
| Electrical Supplies | `78000000` | 52.5% (0.525) | Taxonomy Inferred | 0.1016 |
| Building Products | `83010000` | 42.9% (0.429) | Taxonomy Inferred | -0.2867 |
| Environmental Safety/Security | `91020000` | 42.9% (0.429) | Taxonomy Inferred | -0.2867 |
| Building Products | `83000000` | 34.3% (0.343) | Taxonomy Inferred | -0.6487 |
| Safety/Security/Surveillance | `91000000` | 34.3% (0.343) | Taxonomy Inferred | -0.6487 |

---

## 3. Ikeja City Boutique (+2348033330003)

| Field | Value |
|---|---|
| business_name | Ikeja City Boutique |
| vendor_id | `b3333333-3333-4333-8333-333333333333` |
| user_id | `+2348033330003` |
| status | active |
| city / state | Ikeja / Lagos |
| original_input_statement | "I sell clothes, designer suits, dresses, shoes and fashion accessories" |
| scenario_category | Specific Items / Bricks (High Density) |
| conversation_summary | clothing and fashion accessories shop Sells: clothes, designer suits, dresses. |
| total_capabilities | 45 (Direct: 2, Inferred: 43) |
| created_at | 2026-08-13T09:31:29.543Z |

### 3.1 Capability DNA (`vendor_capabilities`) — 45 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Dresses | `10001333` | 90.6% (0.906) | Direct / Inferred Resolved | 2.2654 |
| Shoes - General Purpose | `10001077` | 90.6% (0.906) | Direct / Inferred Resolved | 2.2654 |
| Full Body Wear | `67010200` | 82.2% (0.822) | Taxonomy Inferred | 1.5297 |
| General Purpose Footwear | `63010300` | 80.6% (0.806) | Taxonomy Inferred | 1.4244 |
| Belts/Braces/Cummerbunds | `10001326` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Bras/Basques/Corsets | `10001345` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Clothing Accessories Variety Packs | `10001354` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Clothing Adornment/Floral Accessories/Badges/Buckles | `10001331` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Clothing Alterations | `svc_clothing_alterations` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Clothing Home Delivery | `svc_clothing_home_delivery` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Cuff-links | `10001086` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Garment Fitting | `svc_garment_fitting` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Hair - Accessories | `10000379` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Headwear | `10001329` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Jackets/Blazers/Cardigans/Waistcoats | `10001350` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Pants/Briefs/Undershorts | `10001347` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Personal Bags | `10001096` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Personal Styling Consultation | `svc_personal_styling_consultation` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Pocket Square/Handkerchiefs | `10001327` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Scarf/Tie/Neckwear | `10001330` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Shirts/Blouses/Polo Shirts/T-shirts | `10001352` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Skirts | `10001334` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Socks | `10001348` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Trousers/Shorts | `10001335` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Undershirts/Chemises/Camisoles | `10001349` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Wallets/Purses/Travel Document Holders | `10001103` | 69.8% (0.698) | Taxonomy Inferred | 0.8394 |
| Clothing | `67010000` | 67.1% (0.671) | Taxonomy Inferred | 0.7136 |
| Footwear | `63010000` | 65.4% (0.654) | Taxonomy Inferred | 0.6346 |
| Clothing Repair | `svc_clothing_repair` | 64.7% (0.647) | Taxonomy Inferred | 0.6054 |
| Body Measurement Taking | `svc_body_measurement_taking` | 59.2% (0.592) | Taxonomy Inferred | 0.3714 |
| Clothing Accessories | `67010100` | 54.9% (0.549) | Taxonomy Inferred | 0.1959 |
| Hair Care Products | `53141100` | 54.9% (0.549) | Taxonomy Inferred | 0.1959 |
| Jewellery | `64010100` | 54.9% (0.549) | Taxonomy Inferred | 0.1959 |
| Lower Body Wear/Bottoms | `67010300` | 54.9% (0.549) | Taxonomy Inferred | 0.1959 |
| Personal Carriers/Accessories | `64010200` | 54.9% (0.549) | Taxonomy Inferred | 0.1959 |
| Underwear | `67040100` | 54.9% (0.549) | Taxonomy Inferred | 0.1959 |
| Upper Body Wear/Tops | `67010800` | 54.9% (0.549) | Taxonomy Inferred | 0.1959 |
| Custom Tailoring | `svc_custom_tailoring` | 53.4% (0.534) | Taxonomy Inferred | 0.1374 |
| Clothing | `67000000` | 52.5% (0.525) | Taxonomy Inferred | 0.1016 |
| Footwear | `63000000` | 51.1% (0.511) | Taxonomy Inferred | 0.0423 |
| Hair Products | `53140000` | 42.9% (0.429) | Taxonomy Inferred | -0.2867 |
| Personal Accessories | `64010000` | 42.9% (0.429) | Taxonomy Inferred | -0.2867 |
| Underwear | `67040000` | 42.9% (0.429) | Taxonomy Inferred | -0.2867 |
| Beauty/Personal Care/Hygiene | `53000000` | 34.3% (0.343) | Taxonomy Inferred | -0.6487 |
| Personal Accessories | `64000000` | 34.3% (0.343) | Taxonomy Inferred | -0.6487 |

---

## 4. Enugu Sanitary & Plumbing Wares (+2348034440004)

| Field | Value |
|---|---|
| business_name | Enugu Sanitary & Plumbing Wares |
| vendor_id | `b4444444-4444-4444-8444-444444444444` |
| user_id | `+2348034440004` |
| status | active |
| city / state | Enugu / Enugu State |
| original_input_statement | "I sell plumbing materials" |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | plumbing materials dealer |
| total_capabilities | 41 (Direct: 0, Inferred: 41) |
| created_at | 2026-08-13T09:33:00.170Z |

### 4.1 Capability DNA (`vendor_capabilities`) — 41 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Basins/Sinks | `10002592` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Building Material Delivery | `svc_building_material_delivery` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Connecting Hoses - Water, Gas, Central Heating | `10004022` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Connectors - Water, Gas, Central Heating and Air Conduits | `10008009` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Faucets/Taps | `10002602` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Hose Connectors | `10003255` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Household Boilers/Furnaces/Tank Water Heaters | `10002658` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Lawn/Ground-Level Drainage Parts/Fittings | `10002663` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Pipe Cutting and Threading | `svc_pipe_cutting_and_threading` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Pipes/Tubing - Water, Gas, Central heating | `10004054` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Plumbing Supply Sales | `svc_plumbing_supply_sales` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Pumps | `10004055` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Sealants | `10003204` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Shower Arms | `10007724` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Shower Heads | `10002608` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Shower Hose | `10007725` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Submersible Pumps | `10008343` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Tankless Water Heaters | `10005479` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Tape (DIY) | `10003206` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Toilet/Bidet Kits | `10007016` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Toilets | `10002586` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Valves/Fittings - Water and Gas | `10004024` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Guttering/Drainage | `83011400` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Heating Equipment | `79010500` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Lawn/Garden Watering Equipment | `81010400` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Sanitary Ware | `79010100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Sealants/Fillers/Adhesives/Defect Agents | `83012100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Submersible Pumps | `11010200` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Water/Gas Supply/Central Heating | `79010800` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Pipe Installation | `svc_pipe_installation` | 32.6% (0.326) | Taxonomy Inferred | -0.7266 |
| Pipe Repair | `svc_pipe_repair` | 29.9% (0.299) | Taxonomy Inferred | -0.8526 |
| Building Products | `83010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Dynamic Pumps | `11010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Lawn/Garden Supplies | `81010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Plumbing/Heating/Ventilation/Air Conditioning | `79010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Metal Cutting | `svc_metal_cutting` | 27.3% (0.273) | Taxonomy Inferred | -0.9786 |
| Welding Services | `svc_welding_services` | 27.3% (0.273) | Taxonomy Inferred | -0.9786 |
| Building Products | `83000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Industrial Fluid Pumps/Systems | `11000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Lawn/Garden Supplies | `81000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Plumbing/Heating/Ventilation/Air Conditioning | `79000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |

---

## 5. Onitsha Central Pharmacy (+2348035550005)

| Field | Value |
|---|---|
| business_name | Onitsha Central Pharmacy |
| vendor_id | `b5555555-5555-4555-8555-555555555555` |
| user_id | `+2348035550005` |
| status | active |
| city / state | Onitsha / Anambra |
| original_input_statement | "I sell medical supplies" |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | medical supplies dealer |
| total_capabilities | 27 (Direct: 0, Inferred: 27) |
| created_at | 2026-08-13T09:34:14.966Z |

### 5.1 Capability DNA (`vendor_capabilities`) — 27 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Bladder/Genital/Rectal Products Other | `10000849` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Disinfectants | `10000441` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Drug Administration | `10000456` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| First Aid - Dressings/Bandages/Plaster | `10000448` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Gloves | `10005894` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Hand Sanitizers / Antiseptics | `10000885` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Home Diagnostic Monitors | `10000455` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Medical Devices | `10005844` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Sanitizers | `10006234` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Thermometers | `10000452` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Bladder/Genital/Rectal Products | `51102400` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Cleaners | `47101600` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Diagnostic Monitors | `51131500` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Diagnostic Tests | `51131600` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Drug Administration | `51101600` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| First Aid | `51101700` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Medical Devices | `51150100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Protective Wear | `67050100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Skin/Scalp Aid Products | `51103000` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Cleaning Products | `47100000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Health Treatments/Aids | `51100000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Home Diagnostics | `51130000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Medical Devices | `51150000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Protective Wear | `67050000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Cleaning/Hygiene Products | `47000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Clothing | `67000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Healthcare | `51000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |

---

## 6. Wuse Provisions Supermarket (+2348036660006)

| Field | Value |
|---|---|
| business_name | Wuse Provisions Supermarket |
| vendor_id | `b6666666-6666-4666-8666-666666666666` |
| user_id | `+2348036660006` |
| status | active |
| city / state | Wuse / Abuja |
| original_input_statement | "I sell provisions" |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | provisions store / grocery shop |
| total_capabilities | 58 (Direct: 0, Inferred: 58) |
| created_at | 2026-08-13T09:35:15.651Z |

### 6.1 Capability DNA (`vendor_capabilities`) — 58 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Biscuits/Cookies (Shelf Stable) | `10000161` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Cereal Products - Not Ready to Eat (Shelf Stable) | `10000285` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Cereal Products - Ready to Eat (Shelf Stable) | `10000284` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Cleansing/Washing/Soap - Body | `10000330` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Drinks Flavoured - Ready to Drink | `10000201` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Extracts/Salt/Meat Tenderisers (Shelf Stable) | `10000050` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Extracts/Seasonings/Flavour Enhancers (Shelf Stable) | `10006214` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Fish - Prepared/Processed (Shelf Stable) | `10000018` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Flour - Cereal/Pulse (Shelf Stable) | `10000203` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Fruit Juice Drinks - Ready to Drink (Shelf Stable) | `10000223` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Fruit Juice - Ready to Drink (Shelf Stable) | `10000220` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Grains/Cereal - Not Ready to Eat - (Shelf Stable) | `10000211` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Herbs/Spices (Shelf Stable) | `10000049` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Household Consumables Supply | `svc_household_consumables_supply` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Laundry Detergents | `10000424` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Local Delivery Service | `svc_local_delivery_service` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Milk (Shelf Stable) | `10000026` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Oils Edible - Vegetable or Plant (Shelf Stable) | `10000040` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Packaged Water - Unflavoured | `10000232` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Pasta/Noodles - Not Ready to Eat (Shelf Stable) | `10000242` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Snacks Other | `10007276` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Sugar/Sugar Substitutes (Shelf Stable) | `10000043` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Tea - Bags/Loose | `10000116` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Toilet Paper | `10000375` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Wholesale Distribution of Household Goods | `svc_wholesale_distribution_of_household_goods` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Retail Grocery Sales | `svc_retail_grocery_sales` | 35.4% (0.354) | Taxonomy Inferred | -0.6006 |
| Biscuits/Cookies | `50182100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Body Washing | `53131300` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Fish - Prepared/Processed | `50121900` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| General Personal Hygiene | `53181100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Grains/Flour | `50221000` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Herbs/Spices/Extracts | `50171500` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Laundry | `47101700` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Milk/Milk Substitutes | `50131700` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Non Alcoholic Beverages - Ready to Drink | `50202300` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Oils Edible | `50151500` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Pasta/Noodles | `50192900` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Processed Cereal Products | `50221200` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Snacks | `50192100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Sugars/Sugar Substitute Products | `50161500` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Tea and Infusions/Tisanes | `50202700` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Household Cleaning Products Sales | `svc_household_cleaning_products_sales` | 32.6% (0.326) | Taxonomy Inferred | -0.7266 |
| Kiosk Resupply Logistics | `svc_kiosk_resupply_logistics` | 29.9% (0.299) | Taxonomy Inferred | -0.8526 |
| Beverages | `50200000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Bread/Bakery Products | `50180000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Cereal/Grain/Pulse Products | `50220000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Cleaning Products | `47100000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Confectionery/Sugar Sweetening Products | `50160000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Fish and Seafood | `50120000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Milk/Butter/Cream/Yogurts/Cheese/Eggs/Substitutes | `50130000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Oils/Fats Edible | `50150000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Personal Hygiene Products | `53180000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Prepared/Preserved Foods | `50190000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Seasonings/Preservatives/Extracts | `50170000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Skin Products | `53130000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Beauty/Personal Care/Hygiene | `53000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Cleaning/Hygiene Products | `47000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Food/Beverage | `50000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |

---

## 7. Port Harcourt Frozen Foods (+2348037770007)

| Field | Value |
|---|---|
| business_name | Port Harcourt Frozen Foods |
| vendor_id | `b7777777-7777-4777-8777-777777777777` |
| user_id | `+2348037770007` |
| status | active |
| city / state | Port Harcourt / Rivers |
| original_input_statement | "I sell frozen foods" |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | frozen foods (cold-room) dealer Sells: frozen foods. |
| total_capabilities | 29 (Direct: 0, Inferred: 29) |
| created_at | 2026-08-13T09:36:56.677Z |

### 7.1 Capability DNA (`vendor_capabilities`) — 29 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Bulk Frozen Food Supply | `svc_bulk_frozen_food_supply` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Chicken - Prepared/Processed | `10005769` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Cold Chain Logistics | `svc_cold_chain_logistics` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Fish - Prepared/Processed (Frozen) | `10000017` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Fish - Unprepared/Unprocessed (Frozen) | `10000281` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Frozen Food Delivery | `svc_frozen_food_delivery` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Frozen Food Storage | `svc_frozen_food_storage` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Restaurant Food Provisioning | `svc_restaurant_food_provisioning` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Shellfish Prepared/Processed (Frozen) | `10000256` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Shellfish - Unprepared/Unprocessed (Frozen) | `10000020` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Soups - Prepared (Frozen) | `10000260` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Turkey - Unprepared/Unprocessed | `10005803` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Vegetables - Prepared/Processed (Frozen) | `10000270` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Catering Ingredient Supply | `svc_catering_ingredient_supply` | 37.2% (0.372) | Taxonomy Inferred | -0.5250 |
| Home Grocery Delivery | `svc_home_grocery_delivery` | 33.7% (0.337) | Taxonomy Inferred | -0.6762 |
| Fish - Prepared/Processed | `50121900` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Fish - Unprepared/Unprocessed | `50121500` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Meat/Poultry/Other Animals - Prepared/Processed | `50240100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Meat/Poultry/Other Animals - Unprepared/Unprocessed | `50240200` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Prepared Soups | `50191500` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Shellfish Prepared/Processed | `50122100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Shellfish Unprepared/Unprocessed | `50121700` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Vegetables - Prepared/Processed | `50102100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Office Pantry Stocking | `svc_office_pantry_stocking` | 29.9% (0.299) | Taxonomy Inferred | -0.8526 |
| Fish and Seafood | `50120000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Fruits/Vegetables/Nuts/Seeds Prepared/Processed | `50100000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Meat/Poultry/Other Animals | `50240000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Prepared/Preserved Foods | `50190000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Food/Beverage | `50000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |

---

## 8. Ibadan Tyres & Auto Parts (+2348038880008)

| Field | Value |
|---|---|
| business_name | Ibadan Tyres & Auto Parts |
| vendor_id | `b8888888-8888-4888-8888-888888888888` |
| user_id | `+2348038880008` |
| status | active |
| city / state | Ibadan / Oyo |
| original_input_statement | "I sell auto parts" |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | automotive spare-parts dealer |
| total_capabilities | 19 (Direct: 0, Inferred: 19) |
| created_at | 2026-08-13T09:37:42.131Z |

### 8.1 Capability DNA (`vendor_capabilities`) — 19 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Automotive Electrical - Replacement Parts/Accessories | `10005131` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Batteries (Automotive) | `10005232` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Brake Disc | `10006385` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Brake Pads/Lining | `10006384` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Filters - Air (Automotive) | `10003022` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Filters - Fluid (Automotive) | `10003762` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Headlights (Automotive) | `10003031` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Replacement Bulbs | `10003034` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Wiper Blades | `10003011` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Automotive Batteries | `77015000` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Automotive Brakes | `77015300` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Automotive Electrical | `77014300` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Automotive Filters | `77013800` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Automotive Lights/Bulbs | `77013900` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Automotive Wipers/Wiper Parts | `77013600` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Spark Plugs | `10003763` | 32.6% (0.326) | Taxonomy Inferred | -0.7266 |
| Automotive Accessories and Maintenance | `77010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Automotive Spark Plugs/Glow Plugs/ Injectors | `77013700` | 27.3% (0.273) | Taxonomy Inferred | -0.9786 |
| Vehicle | `77000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |

---

## 9. Benin Executive Furniture (+2348039990009)

| Field | Value |
|---|---|
| business_name | Benin Executive Furniture |
| vendor_id | `b9999999-9999-4999-8999-999999999999` |
| user_id | `+2348039990009` |
| status | active |
| city / state | Benin City / Edo State |
| original_input_statement | "I sell furniture" |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | furniture dealer / furniture shop |
| total_capabilities | 25 (Direct: 0, Inferred: 25) |
| created_at | 2026-08-13T09:40:24.090Z |

### 9.1 Capability DNA (`vendor_capabilities`) — 25 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Bed Frames (Non Powered) | `10002207` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Complete Beds (Non Powered) | `10008517` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Custom Furniture Fabrication | `svc_custom_furniture_fabrication` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Furniture Assembly | `svc_furniture_assembly` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Furniture Delivery | `svc_furniture_delivery` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Furniture Installation | `svc_furniture_installation` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Household Beds/Mattresses Other | `10002212` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Household Mattresses | `10002210` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Household/Office Chairs/Stools (Non Powered) | `10002193` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Household/Office Cupboards/Display Cabinets | `10005199` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Household/Office Desks/Workstations | `10002203` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Household/Office Shelving Units | `10002184` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Household/Office Sofas (Non Powered) | `10002195` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Household/Office Tables | `10002202` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Household/Office Wardrobes/Lockers | `10002118` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Universal Entertainment Units | `10002186` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Household Beds/Mattresses | `75010400` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Household/Office Seating | `75010200` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Household/Office Storage/Display Furniture/Screens | `75010100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Household/Office Tables/Desks | `75010300` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Custom Carpentry | `svc_custom_carpentry` | 32.6% (0.326) | Taxonomy Inferred | -0.7266 |
| Cabinet Installation | `svc_cabinet_installation` | 29.9% (0.299) | Taxonomy Inferred | -0.8526 |
| Household/Office Furniture | `75010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Furniture Repair | `svc_furniture_repair` | 27.3% (0.273) | Taxonomy Inferred | -0.9786 |
| Household/Office Furniture/Furnishings | `75000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |

---

## 10. Kaduna Agro Produce & Grains (+2348040000010)

| Field | Value |
|---|---|
| business_name | Kaduna Agro Produce & Grains |
| vendor_id | `ba111111-1111-4111-8111-111111111111` |
| user_id | `+2348040000010` |
| status | active |
| city / state | Kaduna / Kaduna |
| original_input_statement | "I sell agricultural materials" |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | agricultural inputs dealer Sells: agricultural materials. |
| total_capabilities | 32 (Direct: 0, Inferred: 32) |
| created_at | 2026-08-13T09:41:22.982Z |

### 10.1 Capability DNA (`vendor_capabilities`) — 32 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Fungicides | `10004109` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Hoes | `10003388` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Hoses | `10003254` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Insecticides/Pesticides/Rodenticides | `10000435` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Irrigation Systems | `10003264` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Lawn/Garden Hand Tools Other | `10003865` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Plant/Soil Fertilizer/Food | `10003234` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Protective Handwear | `10001395` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Protective Wear Accessories | `10003704` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Seeds - Other | `10003291` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Seed Starters | `10003405` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Shovels/Spades | `10003390` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Sprayers (Non Powered) | `10008447` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Sprayers (Powered) | `10008446` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Weed-Killer/ Herbicide | `10003227` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Lawn/Garden Equipment and Tools | `81011200` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Lawn/Garden Watering Equipment | `81010400` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Pest/Plant Control Products | `13010100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Plant Chemicals or Natural Agents/Treatments | `13010200` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Protective Wear | `67050100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Seeds | `93070100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Sprayers | `80013300` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Lawn/Garden Supplies | `81010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Pest/Plant Control Products | `13010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Protective Wear | `67050000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Seeds/Spores | `93070000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Tools/Equipment | `80010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Clothing | `67000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Horticulture Plants | `93000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Lawn/Garden Supplies | `81000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Pest/Plant Control Products | `13000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Tools/Equipment | `80000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |

---

## 11. Warri Industrial Safety Equipment (+2348041110011)

| Field | Value |
|---|---|
| business_name | Warri Industrial Safety Equipment |
| vendor_id | `bb222222-2222-4222-8222-222222222222` |
| user_id | `+2348041110011` |
| status | active |
| city / state | Warri / Delta State |
| original_input_statement | "I sell safety gear" |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | personal protective equipment (PPE) and safety gear dealer Sells: safety gear. |
| total_capabilities | 18 (Direct: 0, Inferred: 18) |
| created_at | 2026-08-13T09:42:10.609Z |

### 11.1 Capability DNA (`vendor_capabilities`) — 18 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Environmental Respiratory Protection - Non Powered | `10005106` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Fire Extinguishers - Pressurised | `10005408` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Hard Hats/Caps | `10005111` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Hearing Protection - Non Powered | `10005108` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Protective Full Body Wear | `10001394` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Protective Handwear | `10001395` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Protective Upper Body Wear | `10001398` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Safety Glasses/Goggles | `10003586` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Safety/Protective/Occupational Boots | `10001080` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Home/Business Fire Extinguishers | `91030300` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Protective Wear | `67050100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Safety/Protective Footwear | `63010500` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Footwear | `63010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Home/Business Safety/Security/Surveillance | `91030000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Protective Wear | `67050000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Clothing | `67000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Footwear | `63000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Safety/Security/Surveillance | `91000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |

---

## 12. Calabar Electrical Supplies (+2348042220012)

| Field | Value |
|---|---|
| business_name | Calabar Electrical Supplies |
| vendor_id | `bc333333-3333-4333-8333-333333333333` |
| user_id | `+2348042220012` |
| status | active |
| city / state | Calabar / Cross River |
| original_input_statement | "I sell electrical materials" |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | electrical materials dealer Sells: electrical materials. |
| total_capabilities | 28 (Direct: 0, Inferred: 28) |
| created_at | 2026-08-13T09:43:26.732Z |

### 12.1 Capability DNA (`vendor_capabilities`) — 28 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Cable Clips/Grommets/Ties | `10005651` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Cable/Wire Conduit/Ducting/Raceways | `10005647` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Circuit Breakers | `10005576` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Distribution Boards/Boxes | `10005583` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Electrical Wires | `10005541` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Extension/Power Supply Cords | `10005559` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Fuses | `10000549` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Light Bulbs/Tubes/Light-Emitting Diodes | `10000552` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Light Sockets | `10005633` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Sockets/Receptacles/Outlets | `10005567` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Switches | `10005586` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Tape (DIY) | `10003206` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Cabling/Wiring Management/Control | `78040100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Electrical Connection | `78020500` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Electrical Distribution | `78020600` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Electrical Wiring | `78040400` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| General Electrical Hardware | `78060100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Lamps/Light Bulbs/Lighting | `14010100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Lighting Control Components | `14010200` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Sealants/Fillers/Adhesives/Defect Agents | `83012100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Building Products | `83010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Electrical Cabling/Wiring | `78040000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Electrical Connection/Distribution | `78020000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| General Electrical Hardware | `78060000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Lighting | `14010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Building Products | `83000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Electrical Supplies | `78000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Lighting | `14000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |

---

## 13. Aba Leatherworks Emporium (+2348043330013)

| Field | Value |
|---|---|
| business_name | Aba Leatherworks Emporium |
| vendor_id | `bd444444-4444-4444-8444-444444444444` |
| user_id | `+2348043330013` |
| status | active |
| city / state | Aba / Abia State |
| original_input_statement | "I sell leather goods" |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | leather goods retailer Sells: leather goods. |
| total_capabilities | 28 (Direct: 1, Inferred: 27) |
| created_at | 2026-08-13T09:44:45.424Z |

### 13.1 Capability DNA (`vendor_capabilities`) — 28 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Leather Goods Repair | `svc_leather_goods_repair` | 63.0% (0.630) | Direct / Inferred Resolved | 0.5334 |
| Belts/Braces/Cummerbunds | `10001326` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Briefcases | `10001095` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Buckle Replacement | `svc_buckle_replacement` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Jackets/Blazers/Cardigans/Waistcoats | `10001350` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Key Rings | `10005756` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Leather Embossing & Monogramming | `svc_leather_embossing_monogramming` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Leather Stitching | `svc_leather_stitching` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Personal Bags | `10001096` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Rucksacks/Backpacks/Holdalls | `10001100` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Shoes - General Purpose | `10001077` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Wallets/Purses/Travel Document Holders | `10001103` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Watch Accessories/Replacement Parts | `10001104` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Leather Cleaning & Conditioning | `svc_leather_cleaning_conditioning` | 35.4% (0.354) | Taxonomy Inferred | -0.6006 |
| Clothing Accessories | `67010100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| General Purpose Footwear | `63010300` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Personal Carriers/Accessories | `64010200` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Upper Body Wear/Tops | `67010800` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Watches | `64010300` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Zipper Repair | `svc_zipper_repair` | 32.6% (0.326) | Taxonomy Inferred | -0.7266 |
| Custom Leather Crafting | `svc_custom_leather_crafting` | 29.9% (0.299) | Taxonomy Inferred | -0.8526 |
| Clothing | `67010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Footwear | `63010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Personal Accessories | `64010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Leather Color Restoration | `svc_leather_color_restoration` | 27.3% (0.273) | Taxonomy Inferred | -0.9786 |
| Clothing | `67000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Footwear | `63000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Personal Accessories | `64000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |

---

## 14. Jos Sports Center (+2348044440014)

| Field | Value |
|---|---|
| business_name | Jos Sports Center |
| vendor_id | `be555555-5555-4555-8555-555555555555` |
| user_id | `+2348044440014` |
| status | active |
| city / state | Jos / Plateau State |
| original_input_statement | "I sell sports materials" |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | sporting goods dealer |
| total_capabilities | 22 (Direct: 0, Inferred: 22) |
| created_at | 2026-08-13T09:45:39.652Z |

### 14.1 Capability DNA (`vendor_capabilities`) — 22 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Athletic Footwear - Specialist | `10001071` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Free Weights/Dumb-bells | `10001816` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Gym Accessories | `10001819` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Racquets | `10001776` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Sports Balls | `10001768` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Sports Equipment Bags/Cases/Covers | `10001892` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Sports Protective Body Padding/Guards | `10001907` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Sportswear - Upper Body Wear | `10001344` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Sportswear Variety Packs | `10001359` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Activewear | `67030100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Athletic Footwear | `63010100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Personal Fitness Sports Equipment | `71010900` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Racquet Sports Equipment | `71010300` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Sports Balls/Pucks/Shuttlecocks/Frisbees/Boomerangs | `71010200` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Sports Equipment Accessories | `71011900` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Sports Personal Protective Equipment | `71012000` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Activewear | `67030000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Footwear | `63010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Sports Equipment | `71010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Clothing | `67000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Footwear | `63000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Sports Equipment | `71000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |

---

## 15. Lagos Heavy Machinery Depot (+2348045550015)

| Field | Value |
|---|---|
| business_name | Lagos Heavy Machinery Depot |
| vendor_id | `bf666666-6666-4666-8666-666666666666` |
| user_id | `+2348045550015` |
| status | active |
| city / state | Apapa / Lagos |
| original_input_statement | "I sell industrial equipment" |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | industrial equipment supplier |
| total_capabilities | 42 (Direct: 0, Inferred: 42) |
| created_at | 2026-08-13T09:46:24.047Z |

### 15.1 Capability DNA (`vendor_capabilities`) — 42 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Air Compressors (Powered) - Stationary | `10005230` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Angle Grinders (Powered) | `10003644` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Arc Welders (Powered) | `10003651` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Bearings/Bushings | `10003170` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Drill/Drivers (Powered) | `10003653` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Equipment Diagnostics and Troubleshooting | `svc_equipment_diagnostics_and_troubleshooting` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Equipment Installation and Commissioning | `svc_equipment_installation_and_commissioning` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Equipment Repair | `svc_equipment_repair` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Generators | `10005211` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Hard Hats/Caps | `10005111` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Overhung Pumps | `10008340` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Power Generator Set | `10008394` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Preventive Maintenance | `svc_preventive_maintenance` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Protective Handwear | `10001395` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Pumps | `10004055` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Spare Parts Sourcing | `svc_spare_parts_sourcing` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Valves/Fittings - Water and Gas | `10004024` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Welding/Blow Torches (Powered) | `10003744` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Welding/Blow Torches Rods/Wire/Solder - Consumables | `10007937` | 41.4% (0.414) | Taxonomy Inferred | -0.3486 |
| Air Compressors | `80013400` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Centrifugal Pumps | `11010100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Drills | `80011100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Electrical Generation | `78021200` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Fixings/Fasteners Hardware | `83011900` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Grinders/Sharpeners/Scrapers/Sanders | `80011000` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Heat Generating/Welding Tools | `80012700` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Protective Wear | `67050100` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Water/Gas Supply/Central Heating | `79010800` | 33.3% (0.333) | Taxonomy Inferred | -0.6951 |
| Maintenance Planning | `svc_maintenance_planning` | 32.6% (0.326) | Taxonomy Inferred | -0.7266 |
| Equipment Upgrades and Retrofitting | `svc_equipment_upgrades_and_retrofitting` | 29.9% (0.299) | Taxonomy Inferred | -0.8526 |
| Building Products | `83010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Dynamic Pumps | `11010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Electrical Connection/Distribution | `78020000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Plumbing/Heating/Ventilation/Air Conditioning | `79010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Protective Wear | `67050000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Tools/Equipment | `80010000` | 27.8% (0.278) | Taxonomy Inferred | -0.9550 |
| Building Products | `83000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Clothing | `67000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Electrical Supplies | `78000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Industrial Fluid Pumps/Systems | `11000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Plumbing/Heating/Ventilation/Air Conditioning | `79000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |
| Tools/Equipment | `80000000` | 24.1% (0.241) | Taxonomy Inferred | -1.1499 |

---

## 16. Emekus and sons (+2347032887144)

| Field | Value |
|---|---|
| business_name | Emekus and sons |
| vendor_id | `992323ec-0497-4547-bdb7-c46cd31ed497` |
| user_id | `+2347032887144` |
| status | active |
| city / state | Lagos / Lagos |
| original_input_statement | "crankshafts." |
| scenario_category | Broad / Low-Density Statement |
| conversation_summary | automotive engine parts dealer Sells: crankshafts. |
| total_capabilities | 16 (Direct: 0, Inferred: 16) |
| created_at | 2026-08-13T10:24:23.173Z |

### 16.1 Capability DNA (`vendor_capabilities`) — 16 Total

| Capability Name | Capability ID | Confidence | Type | Log Odds |
|---|---|---|---|---|
| Automotive Parts Delivery | `svc_automotive_parts_delivery` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Bearings/Bushings | `10003170` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Crankshaft Inspection & Crack Testing | `svc_crankshaft_inspection_crack_testing` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Crankshaft Regrinding | `svc_crankshaft_regrinding` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Engine Parts Sourcing | `svc_engine_parts_sourcing` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Pumps | `10004055` | 56.1% (0.561) | Taxonomy Inferred | 0.2454 |
| Crankshaft Balancing | `svc_crankshaft_balancing` | 47.1% (0.471) | Taxonomy Inferred | -0.1146 |
| Fixings/Fasteners Hardware | `83011900` | 43.8% (0.438) | Taxonomy Inferred | -0.2496 |
| Water/Gas Supply/Central Heating | `79010800` | 43.8% (0.438) | Taxonomy Inferred | -0.2496 |
| Engine Block Machining | `svc_engine_block_machining` | 38.4% (0.384) | Taxonomy Inferred | -0.4746 |
| Building Products | `83010000` | 35.0% (0.350) | Taxonomy Inferred | -0.6209 |
| Plumbing/Heating/Ventilation/Air Conditioning | `79010000` | 35.0% (0.350) | Taxonomy Inferred | -0.6209 |
| Engine Bearing Replacement | `svc_engine_bearing_replacement` | 34.2% (0.342) | Taxonomy Inferred | -0.6546 |
| Engine Rebuilding | `svc_engine_rebuilding` | 34.2% (0.342) | Taxonomy Inferred | -0.6546 |
| Building Products | `83000000` | 28.9% (0.289) | Taxonomy Inferred | -0.8993 |
| Plumbing/Heating/Ventilation/Air Conditioning | `79000000` | 28.9% (0.289) | Taxonomy Inferred | -0.8993 |

---

