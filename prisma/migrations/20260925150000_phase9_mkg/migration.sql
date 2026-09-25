-- CreateEnum
CREATE TYPE "MkgLifecycleState" AS ENUM ('CANDIDATE', 'ACTIVE', 'REINFORCED', 'WEAKENING', 'INACTIVE', 'PRUNED', 'REJECTED');

-- CreateTable
CREATE TABLE "mkg_nodes" (
    "id" TEXT NOT NULL,
    "node_type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mkg_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkg_edges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" TEXT NOT NULL,
    "predicate" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "belief_score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "prior_score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "lifecycle_state" "MkgLifecycleState" NOT NULL DEFAULT 'ACTIVE',
    "evidence_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decision_id" TEXT,
    "policy_version" TEXT NOT NULL DEFAULT '1.0',
    "locality" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mkg_edges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mkg_nodes_node_type_status_idx" ON "mkg_nodes"("node_type", "status");

-- CreateIndex
CREATE INDEX "mkg_nodes_label_idx" ON "mkg_nodes"("label");

-- CreateIndex
CREATE UNIQUE INDEX "mkg_edges_idempotency_key_key" ON "mkg_edges"("idempotency_key");

-- CreateIndex
CREATE INDEX "mkg_edges_subject_id_predicate_belief_score_idx" ON "mkg_edges"("subject_id", "predicate", "belief_score");

-- CreateIndex
CREATE INDEX "mkg_edges_object_id_predicate_belief_score_idx" ON "mkg_edges"("object_id", "predicate", "belief_score");

-- CreateIndex
CREATE INDEX "mkg_edges_predicate_lifecycle_state_idx" ON "mkg_edges"("predicate", "lifecycle_state");

-- CreateIndex
CREATE INDEX "mkg_edges_decision_id_idx" ON "mkg_edges"("decision_id");

-- CreateIndex
CREATE UNIQUE INDEX "mkg_edges_subject_id_predicate_object_id_key" ON "mkg_edges"("subject_id", "predicate", "object_id");

-- AddForeignKey
ALTER TABLE "mkg_edges" ADD CONSTRAINT "mkg_edges_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "mkg_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkg_edges" ADD CONSTRAINT "mkg_edges_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "mkg_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
