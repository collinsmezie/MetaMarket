-- Approximate-nearest-neighbour index for workflow discovery Layer 5 (MCOS §15).
--
-- Prisma cannot express vector indexes, so this migration is hand-written. HNSW is chosen
-- over IVFFlat because it needs no training pass and stays accurate as rows are added one
-- conversation at a time, which matches how workflow instances accumulate here.
--
-- Cosine distance matches the similarity measure used by the repository adapter; indexing
-- with a different operator class would silently disable the index.
CREATE INDEX IF NOT EXISTS "workflow_instances_fingerprint_embedding_hnsw"
    ON "workflow_instances"
    USING hnsw ("fingerprint_embedding" vector_cosine_ops);
