-- CreateEnum
CREATE TYPE "EnrichmentInvocationStatus" AS ENUM ('SUCCESS', 'TEMPORARY_FAILURE', 'SCHEMA_FAILURE', 'POLICY_FAILURE');

-- CreateTable
CREATE TABLE "enrichment_resolutions" (
    "id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "run_id" TEXT,
    "context_snapshot_id" TEXT,
    "source_resolution_request_id" TEXT NOT NULL,
    "component_version" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "downstream_purpose" TEXT NOT NULL,
    "status" "EnrichmentInvocationStatus" NOT NULL,
    "enrichment_status" TEXT,
    "resolution" JSONB,
    "object_count" INTEGER NOT NULL DEFAULT 0,
    "evidence_required" BOOLEAN NOT NULL DEFAULT false,
    "prompt_execution_id" UUID,
    "model_provider" TEXT,
    "model_name" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "error" JSONB,
    "superseded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrichment_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrichment_profiles" (
    "id" UUID NOT NULL,
    "resolution_id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "source_resolution_request_id" TEXT NOT NULL,
    "semantic_object_id" UUID,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "object_id" TEXT NOT NULL,
    "canonical_form" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "market_concept_id" TEXT,
    "concept_status" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "canonical_embedding_text" TEXT NOT NULL,
    "functional_embedding_text" TEXT NOT NULL,
    "taxonomy_embedding_text" TEXT NOT NULL,
    "search_terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "semantic_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "negative_terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence_required" BOOLEAN NOT NULL DEFAULT false,
    "embedding_model" TEXT,
    "canonical_embedding" vector(1536),
    "functional_embedding" vector(1536),
    "taxonomy_embedding" vector(1536),
    "profile" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrichment_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enrichment_resolutions_request_id_key" ON "enrichment_resolutions"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrichment_resolutions_idempotency_key_key" ON "enrichment_resolutions"("idempotency_key");

-- CreateIndex
CREATE INDEX "enrichment_resolutions_conversation_id_created_at_idx" ON "enrichment_resolutions"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "enrichment_resolutions_turn_id_idx" ON "enrichment_resolutions"("turn_id");

-- CreateIndex
CREATE INDEX "enrichment_resolutions_run_id_idx" ON "enrichment_resolutions"("run_id");

-- CreateIndex
CREATE INDEX "enrichment_resolutions_source_resolution_request_id_idx" ON "enrichment_resolutions"("source_resolution_request_id");

-- CreateIndex
CREATE INDEX "enrichment_profiles_conversation_id_created_at_idx" ON "enrichment_profiles"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "enrichment_profiles_semantic_object_id_created_at_idx" ON "enrichment_profiles"("semantic_object_id", "created_at");

-- CreateIndex
CREATE INDEX "enrichment_profiles_source_resolution_request_id_idx" ON "enrichment_profiles"("source_resolution_request_id");

-- CreateIndex
CREATE INDEX "enrichment_profiles_canonical_form_idx" ON "enrichment_profiles"("canonical_form");

-- CreateIndex
CREATE INDEX "enrichment_profiles_market_concept_id_idx" ON "enrichment_profiles"("market_concept_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrichment_profiles_resolution_id_object_id_key" ON "enrichment_profiles"("resolution_id", "object_id");

-- AddForeignKey
ALTER TABLE "enrichment_profiles" ADD CONSTRAINT "enrichment_profiles_resolution_id_fkey" FOREIGN KEY ("resolution_id") REFERENCES "enrichment_resolutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HNSW indexes for the three purpose-built representations (Enrichment §11; Phase 1 convention).
CREATE INDEX IF NOT EXISTS "enrichment_profiles_canonical_embedding_hnsw"
  ON "enrichment_profiles" USING hnsw ("canonical_embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "enrichment_profiles_functional_embedding_hnsw"
  ON "enrichment_profiles" USING hnsw ("functional_embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "enrichment_profiles_taxonomy_embedding_hnsw"
  ON "enrichment_profiles" USING hnsw ("taxonomy_embedding" vector_cosine_ops);
