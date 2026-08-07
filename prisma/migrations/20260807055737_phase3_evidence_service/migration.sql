-- DropIndex
DROP INDEX "service_capabilities_embedding_hnsw";

-- DropIndex
DROP INDEX "vendors_dna_embedding_hnsw";

-- CreateTable
CREATE TABLE "marketplace_events" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "producer" TEXT NOT NULL,
    "vendor_id" UUID,
    "customer_id" TEXT,
    "request_id" UUID,
    "conversation_id" UUID,
    "product" TEXT,
    "capability" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "marketplace_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_records" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "polarity" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "response_time_ms" INTEGER,
    "rating" INTEGER,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_aggregates" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "responded" INTEGER NOT NULL DEFAULT 0,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "no_response" INTEGER NOT NULL DEFAULT 0,
    "selected" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "cancelled" INTEGER NOT NULL DEFAULT 0,
    "response_time_sum_ms" BIGINT NOT NULL DEFAULT 0,
    "response_time_count" INTEGER NOT NULL DEFAULT 0,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "evidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "first_observed_at" TIMESTAMP(3) NOT NULL,
    "last_observed_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_events_event_id_key" ON "marketplace_events"("event_id");

-- CreateIndex
CREATE INDEX "marketplace_events_vendor_id_occurred_at_idx" ON "marketplace_events"("vendor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "marketplace_events_event_type_occurred_at_idx" ON "marketplace_events"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "marketplace_events_processed_at_idx" ON "marketplace_events"("processed_at");

-- CreateIndex
CREATE INDEX "evidence_records_vendor_id_subject_type_subject_idx" ON "evidence_records"("vendor_id", "subject_type", "subject");

-- CreateIndex
CREATE INDEX "evidence_records_event_id_idx" ON "evidence_records"("event_id");

-- CreateIndex
CREATE INDEX "evidence_aggregates_subject_type_subject_evidence_score_idx" ON "evidence_aggregates"("subject_type", "subject", "evidence_score");

-- CreateIndex
CREATE INDEX "evidence_aggregates_vendor_id_evidence_score_idx" ON "evidence_aggregates"("vendor_id", "evidence_score");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_aggregates_vendor_id_subject_type_subject_key" ON "evidence_aggregates"("vendor_id", "subject_type", "subject");
