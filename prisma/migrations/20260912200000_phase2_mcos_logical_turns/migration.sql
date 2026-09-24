-- CreateEnum
CREATE TYPE "LogicalTurnStatus" AS ENUM ('OPEN', 'SEALED', 'ENQUEUED', 'PROCESSING', 'WAITING_USER', 'COMMITTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TurnQueueStatus" AS ENUM ('QUEUED', 'CLAIMED', 'PROCESSING', 'WAITING_USER', 'COMMITTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PendingClarificationStatus" AS ENUM ('WAITING_FOR_USER', 'ANSWER_RECEIVED', 'RESOLVED', 'EXPIRED', 'CANCELLED', 'SUPERSEDED');

-- DropIndex
DROP INDEX "service_capabilities_embedding_hnsw";

-- DropIndex
DROP INDEX "taxonomy_nodes_embedding_hnsw";

-- DropIndex
DROP INDEX "vendors_dna_embedding_hnsw";

-- DropIndex
DROP INDEX "workflow_instances_fingerprint_embedding_hnsw";

-- AlterTable
ALTER TABLE "inbound_messages" ADD COLUMN     "turn_id" UUID;

-- CreateTable
CREATE TABLE "logical_turns" (
    "turn_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "status" "LogicalTurnStatus" NOT NULL DEFAULT 'OPEN',
    "message_ids" TEXT[],
    "messages" JSONB NOT NULL,
    "assembled_text" TEXT NOT NULL DEFAULT '',
    "assembly_reason" TEXT,
    "boundary_reason" TEXT NOT NULL,
    "first_message_at" TIMESTAMP(3) NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "quiet_deadline_at" TIMESTAMP(3) NOT NULL,
    "hard_deadline_at" TIMESTAMP(3) NOT NULL,
    "sealed_at" TIMESTAMP(3),
    "processing_started_at" TIMESTAMP(3),
    "committed_at" TIMESTAMP(3),
    "assembly_version" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "run_id" TEXT,
    "context_snapshot_id" UUID,
    "correlation_id" TEXT NOT NULL,
    "supersedes_turn_id" UUID,
    "corrects_turn_id" UUID,
    "summary" JSONB,
    "error" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logical_turns_pkey" PRIMARY KEY ("turn_id")
);

-- CreateTable
CREATE TABLE "turn_queue" (
    "queue_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "TurnQueueStatus" NOT NULL DEFAULT 'QUEUED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "claimed_by" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "turn_queue_pkey" PRIMARY KEY ("queue_id")
);

-- CreateTable
CREATE TABLE "pending_clarifications" (
    "clarification_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "originating_turn_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "target_action_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_intent_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocking" BOOLEAN NOT NULL,
    "status" "PendingClarificationStatus" NOT NULL DEFAULT 'WAITING_FOR_USER',
    "asked_at" TIMESTAMP(3) NOT NULL,
    "answer_message_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answer_turn_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "expected_resolution" TEXT,
    "context_snapshot_id" UUID,
    "issue_key" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_clarifications_pkey" PRIMARY KEY ("clarification_id")
);

-- CreateTable
CREATE TABLE "turn_context_snapshots" (
    "snapshot_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turn_context_snapshots_pkey" PRIMARY KEY ("snapshot_id")
);

-- CreateIndex
CREATE INDEX "logical_turns_conversation_id_status_idx" ON "logical_turns"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "logical_turns_status_quiet_deadline_at_idx" ON "logical_turns"("status", "quiet_deadline_at");

-- CreateIndex
CREATE INDEX "logical_turns_conversation_id_first_message_at_idx" ON "logical_turns"("conversation_id", "first_message_at");

-- CreateIndex
CREATE INDEX "logical_turns_correlation_id_idx" ON "logical_turns"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "turn_queue_turn_id_key" ON "turn_queue"("turn_id");

-- CreateIndex
CREATE INDEX "turn_queue_status_created_at_idx" ON "turn_queue"("status", "created_at");

-- CreateIndex
CREATE INDEX "turn_queue_conversation_id_status_idx" ON "turn_queue"("conversation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "turn_queue_conversation_id_sequence_key" ON "turn_queue"("conversation_id", "sequence");

-- CreateIndex
CREATE INDEX "pending_clarifications_conversation_id_status_asked_at_idx" ON "pending_clarifications"("conversation_id", "status", "asked_at");

-- CreateIndex
CREATE INDEX "pending_clarifications_originating_turn_id_idx" ON "pending_clarifications"("originating_turn_id");

-- CreateIndex
CREATE INDEX "pending_clarifications_conversation_id_issue_key_asked_at_idx" ON "pending_clarifications"("conversation_id", "issue_key", "asked_at");

-- CreateIndex
CREATE UNIQUE INDEX "pending_clarifications_conversation_id_clarification_id_key" ON "pending_clarifications"("conversation_id", "clarification_id");

-- CreateIndex
CREATE INDEX "turn_context_snapshots_conversation_id_created_at_idx" ON "turn_context_snapshots"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "turn_context_snapshots_turn_id_idx" ON "turn_context_snapshots"("turn_id");

-- CreateIndex
CREATE INDEX "inbound_messages_turn_id_idx" ON "inbound_messages"("turn_id");

-- AddForeignKey
ALTER TABLE "turn_queue" ADD CONSTRAINT "turn_queue_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "logical_turns"("turn_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- MCOS v4.4 invariants that Prisma cannot express (partial unique indexes)
-- §5A.3: at most one OPEN logical turn per conversation (two concurrent first messages cannot
--        open two turns; the loser retries and appends).
-- §25A.0: UNIQUE(conversation_id) WHERE status = 'WAITING_FOR_USER'.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "logical_turns_one_open_per_conversation"
  ON "logical_turns" ("conversation_id") WHERE status = 'OPEN';
CREATE UNIQUE INDEX IF NOT EXISTS "pending_clarifications_one_active_per_conversation"
  ON "pending_clarifications" ("conversation_id") WHERE status = 'WAITING_FOR_USER';
