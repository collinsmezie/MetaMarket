-- CreateEnum
CREATE TYPE "IdceInvocationStatus" AS ENUM ('SUCCESS', 'TEMPORARY_FAILURE', 'SCHEMA_FAILURE', 'POLICY_FAILURE');

-- CreateTable
CREATE TABLE "intent_resolutions" (
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
    "status" "IdceInvocationStatus" NOT NULL,
    "resolution_status" TEXT,
    "resolution" JSONB,
    "primary_intent_type" TEXT,
    "intent_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clarification_required" BOOLEAN NOT NULL DEFAULT false,
    "prompt_execution_id" UUID,
    "model_provider" TEXT,
    "model_name" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "error" JSONB,
    "superseded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intent_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intent_resolutions_request_id_key" ON "intent_resolutions"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "intent_resolutions_idempotency_key_key" ON "intent_resolutions"("idempotency_key");

-- CreateIndex
CREATE INDEX "intent_resolutions_conversation_id_created_at_idx" ON "intent_resolutions"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "intent_resolutions_turn_id_idx" ON "intent_resolutions"("turn_id");

-- CreateIndex
CREATE INDEX "intent_resolutions_run_id_idx" ON "intent_resolutions"("run_id");

