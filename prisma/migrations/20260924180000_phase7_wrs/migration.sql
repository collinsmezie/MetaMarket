-- CreateEnum
CREATE TYPE "WrsInvocationStatus" AS ENUM ('SUCCESS', 'NO_RELIABLE_EVIDENCE', 'PROVIDER_UNAVAILABLE', 'TEMPORARY_FAILURE', 'SCHEMA_FAILURE', 'POLICY_FAILURE');

-- CreateTable
CREATE TABLE "wrs_retrievals" (
    "id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "turn_id" TEXT,
    "run_id" TEXT,
    "consumer_component" TEXT NOT NULL,
    "consumer_version" TEXT NOT NULL,
    "consumer_purpose" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "component_version" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "status" "WrsInvocationStatus" NOT NULL,
    "response_status" TEXT,
    "response" JSONB,
    "queries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_count" INTEGER NOT NULL DEFAULT 0,
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "prompt_execution_id" UUID,
    "model_provider" TEXT,
    "model_name" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "error" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wrs_retrievals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wrs_evidence" (
    "id" UUID NOT NULL,
    "retrieval_id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "consumer_component" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "supports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contradicts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relationship_target" JSONB,
    "source_id" TEXT NOT NULL,
    "source_url" TEXT,
    "source_title" TEXT,
    "source_type" TEXT NOT NULL,
    "geographic_relevance" TEXT NOT NULL,
    "temporal_relevance" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wrs_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wrs_retrievals_request_id_key" ON "wrs_retrievals"("request_id");

-- CreateIndex
CREATE INDEX "wrs_retrievals_conversation_id_created_at_idx" ON "wrs_retrievals"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "wrs_retrievals_turn_id_idx" ON "wrs_retrievals"("turn_id");

-- CreateIndex
CREATE INDEX "wrs_retrievals_consumer_component_created_at_idx" ON "wrs_retrievals"("consumer_component", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wrs_evidence_evidence_id_key" ON "wrs_evidence"("evidence_id");

-- CreateIndex
CREATE INDEX "wrs_evidence_request_id_idx" ON "wrs_evidence"("request_id");

-- CreateIndex
CREATE INDEX "wrs_evidence_source_url_idx" ON "wrs_evidence"("source_url");

-- AddForeignKey
ALTER TABLE "wrs_evidence" ADD CONSTRAINT "wrs_evidence_retrieval_id_fkey" FOREIGN KEY ("retrieval_id") REFERENCES "wrs_retrievals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
