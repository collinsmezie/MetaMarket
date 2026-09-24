-- CreateEnum
CREATE TYPE "GpcInvocationStatus" AS ENUM ('SUCCESS', 'TEMPORARY_FAILURE', 'SCHEMA_FAILURE', 'POLICY_FAILURE');

-- DropIndex
DROP INDEX "enrichment_profiles_canonical_embedding_hnsw";

-- DropIndex
DROP INDEX "enrichment_profiles_functional_embedding_hnsw";

-- DropIndex
DROP INDEX "enrichment_profiles_taxonomy_embedding_hnsw";

-- CreateTable
CREATE TABLE "gpc_resolutions" (
    "id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "run_id" TEXT,
    "context_snapshot_id" TEXT,
    "csre_request_id" TEXT NOT NULL,
    "enrichment_request_id" TEXT,
    "component_version" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "gpc_version" TEXT NOT NULL,
    "status" "GpcInvocationStatus" NOT NULL,
    "resolution_status" TEXT,
    "resolution" JSONB,
    "object_count" INTEGER NOT NULL DEFAULT 0,
    "mapped_count" INTEGER NOT NULL DEFAULT 0,
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "prompt_execution_id" UUID,
    "model_provider" TEXT,
    "model_name" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "error" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gpc_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gpc_mappings" (
    "id" UUID NOT NULL,
    "resolution_id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "csre_request_id" TEXT NOT NULL,
    "enrichment_request_id" TEXT,
    "semantic_object_id" UUID,
    "enrichment_profile_id" UUID,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "object_id" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "market_concept_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "gpc_code" TEXT,
    "gpc_level" TEXT,
    "gpc_title" TEXT,
    "mapping_confidence" DOUBLE PRECISION NOT NULL,
    "reason_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gpc_version" TEXT NOT NULL,
    "resolver_version" TEXT NOT NULL,
    "candidate_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mapping" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gpc_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gpc_resolutions_request_id_key" ON "gpc_resolutions"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "gpc_resolutions_idempotency_key_key" ON "gpc_resolutions"("idempotency_key");

-- CreateIndex
CREATE INDEX "gpc_resolutions_conversation_id_created_at_idx" ON "gpc_resolutions"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "gpc_resolutions_turn_id_idx" ON "gpc_resolutions"("turn_id");

-- CreateIndex
CREATE INDEX "gpc_resolutions_run_id_idx" ON "gpc_resolutions"("run_id");

-- CreateIndex
CREATE INDEX "gpc_resolutions_csre_request_id_idx" ON "gpc_resolutions"("csre_request_id");

-- CreateIndex
CREATE INDEX "gpc_mappings_conversation_id_created_at_idx" ON "gpc_mappings"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "gpc_mappings_semantic_object_id_created_at_idx" ON "gpc_mappings"("semantic_object_id", "created_at");

-- CreateIndex
CREATE INDEX "gpc_mappings_gpc_code_idx" ON "gpc_mappings"("gpc_code");

-- CreateIndex
CREATE INDEX "gpc_mappings_market_concept_id_idx" ON "gpc_mappings"("market_concept_id");

-- CreateIndex
CREATE INDEX "gpc_mappings_state_idx" ON "gpc_mappings"("state");

-- CreateIndex
CREATE UNIQUE INDEX "gpc_mappings_resolution_id_object_id_key" ON "gpc_mappings"("resolution_id", "object_id");

-- AddForeignKey
ALTER TABLE "gpc_mappings" ADD CONSTRAINT "gpc_mappings_resolution_id_fkey" FOREIGN KEY ("resolution_id") REFERENCES "gpc_resolutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

