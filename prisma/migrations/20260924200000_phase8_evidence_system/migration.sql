-- CreateEnum
CREATE TYPE "EvidencePolarity" AS ENUM ('POSITIVE', 'NEGATIVE', 'NEUTRAL', 'CONTRADICTORY');

-- CreateEnum
CREATE TYPE "KnowledgeState" AS ENUM ('CANDIDATE', 'SUPPORTED', 'ESTABLISHED', 'WEAKENING', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ObservationStatus" AS ENUM ('RECORDED', 'INTERPRETED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "GraphChangeOperation" AS ENUM ('ADD', 'REINFORCE', 'DECAY', 'DEACTIVATE', 'PRUNE', 'REJECT');

-- CreateEnum
CREATE TYPE "GraphChangeDecisionStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "observations" (
    "id" UUID NOT NULL,
    "observation_id" TEXT NOT NULL,
    "observation_type" TEXT NOT NULL,
    "source_component" TEXT NOT NULL,
    "source_version" TEXT NOT NULL,
    "source_event_id" TEXT,
    "request_id" TEXT,
    "conversation_id" TEXT,
    "turn_id" TEXT,
    "run_id" TEXT,
    "workflow_id" TEXT,
    "action_id" TEXT,
    "interaction_id" TEXT,
    "actor_id" TEXT,
    "actor_role" TEXT,
    "channel" TEXT,
    "country" TEXT,
    "region" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "payload" JSONB NOT NULL,
    "raw_text" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ObservationStatus" NOT NULL DEFAULT 'RECORDED',
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "error" JSONB,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,
    "assertion_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "predicate" TEXT NOT NULL,
    "object" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "subject_label" TEXT NOT NULL,
    "object_label" TEXT NOT NULL,
    "polarity" "EvidencePolarity" NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "supports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contradicts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provenance" JSONB NOT NULL,
    "independence_key" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "country" TEXT,
    "region" TEXT,
    "source_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_assertions" (
    "id" UUID NOT NULL,
    "assertion_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "predicate" TEXT NOT NULL,
    "object" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "subject_label" TEXT NOT NULL,
    "object_label" TEXT NOT NULL,
    "country" TEXT,
    "region" TEXT,
    "knowledge_type" TEXT NOT NULL,
    "prior" DOUBLE PRECISION,
    "belief" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "direction" TEXT NOT NULL DEFAULT 'STABLE',
    "state" "KnowledgeState" NOT NULL DEFAULT 'CANDIDATE',
    "observation_count" INTEGER NOT NULL DEFAULT 0,
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "independent_source_count" INTEGER NOT NULL DEFAULT 0,
    "positive_count" INTEGER NOT NULL DEFAULT 0,
    "negative_count" INTEGER NOT NULL DEFAULT 0,
    "neutral_count" INTEGER NOT NULL DEFAULT 0,
    "contradictory_count" INTEGER NOT NULL DEFAULT 0,
    "requires_more_evidence" BOOLEAN NOT NULL DEFAULT true,
    "first_observed_at" TIMESTAMP(3),
    "last_observed_at" TIMESTAMP(3),
    "last_fused_at" TIMESTAMP(3),
    "policy_version" TEXT NOT NULL,
    "fusion" JSONB,
    "decision_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_assertions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "belief_history" (
    "id" UUID NOT NULL,
    "assertion_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "previous_score" DOUBLE PRECISION,
    "reason" TEXT NOT NULL,
    "evidence_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "policy_version" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "belief_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge" (
    "id" UUID NOT NULL,
    "knowledge_id" TEXT NOT NULL,
    "assertion_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "claim" JSONB NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL,
    "state" "KnowledgeState" NOT NULL DEFAULT 'CANDIDATE',
    "supported_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contradicted_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_validated_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_change_decisions" (
    "id" UUID NOT NULL,
    "decision_id" TEXT NOT NULL,
    "assertion_id" TEXT NOT NULL,
    "operation" "GraphChangeOperation" NOT NULL,
    "relevance_decision" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "predicate" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "belief_score" DOUBLE PRECISION NOT NULL,
    "reason_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "policy_version" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "run_id" TEXT,
    "status" "GraphChangeDecisionStatus" NOT NULL DEFAULT 'PENDING',
    "failure" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(3),

    CONSTRAINT "graph_change_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "observations_observation_id_key" ON "observations"("observation_id");

-- CreateIndex
CREATE INDEX "observations_run_id_idx" ON "observations"("run_id");

-- CreateIndex
CREATE INDEX "observations_request_id_idx" ON "observations"("request_id");

-- CreateIndex
CREATE INDEX "observations_conversation_id_observed_at_idx" ON "observations"("conversation_id", "observed_at");

-- CreateIndex
CREATE INDEX "observations_observation_type_observed_at_idx" ON "observations"("observation_type", "observed_at");

-- CreateIndex
CREATE INDEX "observations_actor_id_observed_at_idx" ON "observations"("actor_id", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_evidence_id_key" ON "evidence"("evidence_id");

-- CreateIndex
CREATE INDEX "evidence_assertion_id_observed_at_idx" ON "evidence"("assertion_id", "observed_at");

-- CreateIndex
CREATE INDEX "evidence_observation_id_idx" ON "evidence"("observation_id");

-- CreateIndex
CREATE INDEX "evidence_independence_key_idx" ON "evidence"("independence_key");

-- CreateIndex
CREATE INDEX "evidence_subject_predicate_idx" ON "evidence"("subject", "predicate");

-- CreateIndex
CREATE INDEX "evidence_predicate_object_idx" ON "evidence"("predicate", "object");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_assertions_assertion_id_key" ON "evidence_assertions"("assertion_id");

-- CreateIndex
CREATE INDEX "evidence_assertions_subject_idx" ON "evidence_assertions"("subject");

-- CreateIndex
CREATE INDEX "evidence_assertions_object_idx" ON "evidence_assertions"("object");

-- CreateIndex
CREATE INDEX "evidence_assertions_predicate_belief_idx" ON "evidence_assertions"("predicate", "belief");

-- CreateIndex
CREATE INDEX "evidence_assertions_knowledge_type_state_idx" ON "evidence_assertions"("knowledge_type", "state");

-- CreateIndex
CREATE INDEX "belief_history_assertion_id_recorded_at_idx" ON "belief_history"("assertion_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_knowledge_id_key" ON "knowledge"("knowledge_id");

-- CreateIndex
CREATE INDEX "knowledge_type_state_idx" ON "knowledge"("type", "state");

-- CreateIndex
CREATE INDEX "knowledge_assertion_id_idx" ON "knowledge"("assertion_id");

-- CreateIndex
CREATE UNIQUE INDEX "graph_change_decisions_decision_id_key" ON "graph_change_decisions"("decision_id");

-- CreateIndex
CREATE INDEX "graph_change_decisions_status_created_at_idx" ON "graph_change_decisions"("status", "created_at");

-- CreateIndex
CREATE INDEX "graph_change_decisions_assertion_id_created_at_idx" ON "graph_change_decisions"("assertion_id", "created_at");

-- CreateIndex
CREATE INDEX "graph_change_decisions_run_id_idx" ON "graph_change_decisions"("run_id");

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "observations"("observation_id") ON DELETE CASCADE ON UPDATE CASCADE;
