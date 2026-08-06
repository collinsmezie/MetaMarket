-- Approximate-nearest-neighbour index for Capability Resolver retrieval.
--
-- Prisma cannot express vector indexes, so this is hand-written. Cosine distance matches the
-- operator the resolver queries with; indexing under a different operator class would leave
-- the index silently unused and every capability lookup doing a sequential scan over
-- thousands of GPC nodes.
CREATE INDEX IF NOT EXISTS "taxonomy_nodes_embedding_hnsw"
    ON "taxonomy_nodes"
    USING hnsw ("embedding" vector_cosine_ops);
