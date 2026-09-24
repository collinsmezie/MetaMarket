-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('ACTIVE', 'WAITING_USER', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "TraceStepStatus" AS ENUM ('STARTED', 'SUCCESS', 'PARTIAL', 'BLOCKED', 'ERROR', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PromptExecutionStatus" AS ENUM ('SUCCESS', 'SCHEMA_FAILURE', 'PROVIDER_FAILURE', 'POLICY_FAILURE');

-- CreateEnum
CREATE TYPE "EventConsumptionStatus" AS ENUM ('CONSUMED', 'FAILED');

-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN     "aggregate_id" TEXT,
ADD COLUMN     "aggregate_type" TEXT,
ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "claimed_by" TEXT,
ADD COLUMN     "consumed_at" TIMESTAMP(3),
ADD COLUMN     "consumption_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "correlation_id" TEXT,
ADD COLUMN     "event_version" TEXT NOT NULL DEFAULT '1.0',
ADD COLUMN     "run_id" TEXT,
ADD COLUMN     "turn_id" TEXT;

-- CreateTable
CREATE TABLE "orchestration_runs" (
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "turn_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "message_ids" TEXT[],
    "status" "RunStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "final_response" JSONB,
    "error" JSONB,

    CONSTRAINT "orchestration_runs_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "trace_steps" (
    "id" UUID NOT NULL,
    "run_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "parent_request_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "turn_id" TEXT,
    "component" TEXT NOT NULL,
    "component_version" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "schema_version" TEXT,
    "status" "TraceStepStatus" NOT NULL DEFAULT 'STARTED',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "input_summary" JSONB,
    "decision" JSONB,
    "output_summary" JSONB,
    "persisted_record_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prompt_execution_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "trace_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_executions" (
    "id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "parent_request_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "turn_id" TEXT,
    "run_id" TEXT,
    "component" TEXT NOT NULL,
    "component_version" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "schema_id" TEXT,
    "schema_version" TEXT,
    "model_provider" TEXT,
    "model_name" TEXT,
    "input_hash" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "raw_output" TEXT,
    "status" "PromptExecutionStatus" NOT NULL,
    "validation_errors" JSONB NOT NULL DEFAULT '[]',
    "repair_attempts" INTEGER NOT NULL DEFAULT 0,
    "provider_attempts" INTEGER NOT NULL DEFAULT 0,
    "failed_providers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "latency_ms" INTEGER NOT NULL,
    "usage" JSONB,
    "decision_summary" JSONB,
    "shared_invocation" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_consumptions" (
    "event_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "status" "EventConsumptionStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_consumptions_pkey" PRIMARY KEY ("event_id","consumer")
);

-- CreateIndex
CREATE INDEX "orchestration_runs_conversation_id_started_at_idx" ON "orchestration_runs"("conversation_id", "started_at");

-- CreateIndex
CREATE INDEX "orchestration_runs_turn_id_idx" ON "orchestration_runs"("turn_id");

-- CreateIndex
CREATE INDEX "orchestration_runs_correlation_id_idx" ON "orchestration_runs"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "trace_steps_request_id_key" ON "trace_steps"("request_id");

-- CreateIndex
CREATE INDEX "trace_steps_run_id_sequence_idx" ON "trace_steps"("run_id", "sequence");

-- CreateIndex
CREATE INDEX "trace_steps_correlation_id_idx" ON "trace_steps"("correlation_id");

-- CreateIndex
CREATE INDEX "trace_steps_component_started_at_idx" ON "trace_steps"("component", "started_at");

-- CreateIndex
CREATE INDEX "prompt_executions_run_id_created_at_idx" ON "prompt_executions"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "prompt_executions_conversation_id_created_at_idx" ON "prompt_executions"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "prompt_executions_component_prompt_id_created_at_idx" ON "prompt_executions"("component", "prompt_id", "created_at");

-- CreateIndex
CREATE INDEX "prompt_executions_correlation_id_idx" ON "prompt_executions"("correlation_id");

-- CreateIndex
CREATE INDEX "event_consumptions_status_created_at_idx" ON "event_consumptions"("status", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_consumed_at_claimed_at_occurred_at_idx" ON "outbox_events"("consumed_at", "claimed_at", "occurred_at");

-- CreateIndex
CREATE INDEX "outbox_events_correlation_id_idx" ON "outbox_events"("correlation_id");

-- AddForeignKey
ALTER TABLE "trace_steps" ADD CONSTRAINT "trace_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "orchestration_runs"("run_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- Recreate the pgvector HNSW indexes that later migrations dropped and never restored
-- (Gap Analysis §5.1). Without them every semantic lookup is a sequential scan.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "taxonomy_nodes_embedding_hnsw"
  ON "taxonomy_nodes" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "workflow_instances_fingerprint_embedding_hnsw"
  ON "workflow_instances" USING hnsw ("fingerprint_embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "vendors_dna_embedding_hnsw"
  ON "vendors" USING hnsw ("dna_embedding" vector_cosine_ops);
CREATE INDEX IF NOT EXISTS "service_capabilities_embedding_hnsw"
  ON "service_capabilities" USING hnsw ("embedding" vector_cosine_ops);
