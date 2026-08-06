-- ANN indexes for vendor-level and service-capability semantic retrieval.
--
-- Prisma cannot express vector indexes, so these are hand-written. Cosine distance matches
-- the operator the repositories query with; a different operator class would leave the index
-- unused and turn every capability lookup into a sequential scan.
CREATE INDEX IF NOT EXISTS "vendors_dna_embedding_hnsw"
    ON "vendors" USING hnsw ("dna_embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "service_capabilities_embedding_hnsw"
    ON "service_capabilities" USING hnsw ("embedding" vector_cosine_ops);
