-- CreateEnum
CREATE TYPE "CsreInvocationStatus" AS ENUM ('SUCCESS', 'TEMPORARY_FAILURE', 'SCHEMA_FAILURE', 'POLICY_FAILURE');

-- CreateTable
CREATE TABLE "semantic_resolutions" (
    "id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "run_id" TEXT,
    "context_snapshot_id" TEXT,
    "understanding_revision" INTEGER NOT NULL DEFAULT 0,
    "component_version" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "status" "CsreInvocationStatus" NOT NULL,
    "resolution_status" TEXT,
    "resolution" JSONB,
    "object_count" INTEGER NOT NULL DEFAULT 0,
    "canonical_forms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entity_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clarification_required" BOOLEAN NOT NULL DEFAULT false,
    "prompt_execution_id" UUID,
    "model_provider" TEXT,
    "model_name" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "error" JSONB,
    "superseded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "semantic_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semantic_objects" (
    "id" UUID NOT NULL,
    "resolution_id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "object_id" TEXT NOT NULL,
    "surface_form" TEXT NOT NULL,
    "canonical_form" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "phrase" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "market_concept_id" TEXT,
    "concept_status" TEXT NOT NULL,
    "semantic_confidence" DOUBLE PRECISION NOT NULL,
    "commercial_relevance" TEXT NOT NULL,
    "commercial_offering" BOOLEAN NOT NULL,
    "commercial_confidence" DOUBLE PRECISION NOT NULL,
    "ambiguity_present" BOOLEAN NOT NULL DEFAULT false,
    "object" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "semantic_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "semantic_resolutions_request_id_key" ON "semantic_resolutions"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "semantic_resolutions_idempotency_key_key" ON "semantic_resolutions"("idempotency_key");

-- CreateIndex
CREATE INDEX "semantic_resolutions_conversation_id_created_at_idx" ON "semantic_resolutions"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "semantic_resolutions_turn_id_idx" ON "semantic_resolutions"("turn_id");

-- CreateIndex
CREATE INDEX "semantic_resolutions_run_id_idx" ON "semantic_resolutions"("run_id");

-- CreateIndex
CREATE INDEX "semantic_objects_conversation_id_created_at_idx" ON "semantic_objects"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "semantic_objects_turn_id_idx" ON "semantic_objects"("turn_id");

-- CreateIndex
CREATE INDEX "semantic_objects_request_id_idx" ON "semantic_objects"("request_id");

-- CreateIndex
CREATE INDEX "semantic_objects_canonical_form_idx" ON "semantic_objects"("canonical_form");

-- CreateIndex
CREATE INDEX "semantic_objects_market_concept_id_idx" ON "semantic_objects"("market_concept_id");

-- CreateIndex
CREATE UNIQUE INDEX "semantic_objects_resolution_id_object_id_key" ON "semantic_objects"("resolution_id", "object_id");

-- AddForeignKey
ALTER TABLE "semantic_objects" ADD CONSTRAINT "semantic_objects_resolution_id_fkey" FOREIGN KEY ("resolution_id") REFERENCES "semantic_resolutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

