
Discuss speed performance optimization


Speed & Latency Performance Optimization Strategy
To achieve sub-second interaction turns (< 800ms end-to-end) across MetaMarket, latency must be optimized across four primary architectural bottlenecks: LLM Inference, Taxonomy Resolution (CDE/CME), Database Round-Trips, and External HTTP Network I/O.

1. LLM Inference Layer Optimizations (~1,500ms – 4,000ms savings)
A. Model Tiering & Task-Specific Model Selection
Current State: Uses gpt-4o for all operations (continuity_analysis, onboarding_extraction, business_understanding).
Optimization:
Use gpt-4o-mini for high-frequency classification tasks (continuity_analysis, structured onboarding_extraction). gpt-4o-mini delivers identical accuracy for JSON schemas at ~300–600ms latency (a 3–4x speedup).
Reserve gpt-4o strictly for complex capability expansion or ambiguous business archetypes.
B. Expanded Deterministic Fast-Path Resolvers
Current State: Interactive button taps and direct state continuations bypass LLM analysis deterministically.
Optimization: Implement regex/heuristic fast-paths for common low-ambiguity user inputs (e.g. city names, standard numeric selections, single-word confirmations like "yes", "no", "warri"), bypassing LLM calls entirely for ~0ms turn overhead.
2. Taxonomy & CME Knowledge Caching (~2,000ms – 6,000ms savings)
A. Redis Cache for GS1 GPC Term Resolution
Current State: CapabilityResolver queries the LLM to map product terms (e.g. "charcoal pencils", "wedding cards", "stationery") to canonical GS1 GPC bricks.
Optimization: Implement a Redis L2 Cache for canonical taxonomy lookups:
text
Key: taxonomy:gs1:{normalized_term_hash} -> GS1 Brick Code & Name (TTL: 30 days)
Impact: Popular marketplace terms (e.g. "books", "cement", "ballpoint pens") hit Redis in < 2ms, completely eliminating the 4-second LLM taxonomy resolution bottleneck on repeat queries.
B. In-Memory Graph Indexing for Candidate Vendors
Current State: CME queries PostgreSQL for matching vendor capabilities on every search.
Optimization: Maintain an in-memory index (or Redis SET index) of active vendor IDs partitioned by city:state:capability_brick.
Impact: Reduces candidate discovery lookup time from ~80ms DB query to < 5ms memory lookup.
3. Database & System Layer Optimizations (~150ms – 300ms savings)
A. Bulk DB Query Consolidation
Current State: RequestDistributionService fetches vendor records and creates RequestDelivery rows sequentially inside loops.
Optimization: Combine vendor fetching into single bulk findMany() queries and execute RequestDelivery.createMany() in single batch operations.
B. Asynchronous Evidence Decoupling
Current State: Evidence processor events are logged inline during the turn.
Optimization: Push raw evidence events (request.delivered, request.accepted) into background BullMQ queues (EvidenceQueue).
Impact: Offloads non-critical database writes out of the synchronous WhatsApp turn lifecycle.
4. Network I/O & Channel Adapter Optimizations (~100ms – 250ms savings)
A. Persistent HTTPS Keep-Alive Connection Pools
Current State: Standard Node.js fetch creates connections per Meta Graph API call.
Optimization: Configure an HTTP/2 or undici persistent agent with Keep-Alive:
typescript
const dispatcher = new Agent({ keepAliveTimeout: 60000, keepAliveMaxTimeout: 600000 });
Impact: Eliminates TLS handshake latency (100–150ms) on outbound WhatsApp Graph API calls.
Target Latency Profile Comparison
Turn Pipeline Stage	Current Latency	Optimized Target	Optimization Mechanism
Ingestion & Continuity	~1,200ms	< 300ms	gpt-4o-mini / Deterministic Fast-Path
Semantic Taxonomy Resolution	~4,000ms	< 5ms	Redis GS1 Taxonomy Cache
CME Candidate Ranking	~200ms	< 15ms	Redis Location/Capability Index
DB Request Distribution	~150ms	< 30ms	Single-pass Bulk Query & Async Evidence Queue
WhatsApp HTTP Push	~500ms	< 200ms	Persistent HTTPS Keep-Alive Pool
TOTAL END-TO-END TURN	~6,050ms	< 550ms	90%+ Total Latency Reduction
17:25
