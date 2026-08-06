-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'Nigeria',
    "location_confidence" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'onboarding',
    "conversation_summary" TEXT NOT NULL DEFAULT '',
    "declared_products" TEXT[],
    "declared_services" TEXT[],
    "brands" TEXT[],
    "dna_embedding" vector(1536),
    "onboarded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_capabilities" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "capability_domain" TEXT NOT NULL,
    "capability_id" TEXT NOT NULL,
    "capability_name" TEXT NOT NULL,
    "log_odds" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence_count" INTEGER NOT NULL DEFAULT 0,
    "inferred" BOOLEAN NOT NULL DEFAULT true,
    "last_observed_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capability_evidence" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "original_text" TEXT NOT NULL,
    "normalized_meaning" TEXT NOT NULL,
    "information_density" TEXT NOT NULL,
    "supports" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL DEFAULT '',
    "conversation_id" UUID,
    "workflow_id" UUID,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capability_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_capabilities" (
    "id" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "aliases" TEXT[],
    "embedding" vector(1536),
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendors_user_id_key" ON "vendors"("user_id");

-- CreateIndex
CREATE INDEX "vendors_status_idx" ON "vendors"("status");

-- CreateIndex
CREATE INDEX "vendors_city_state_idx" ON "vendors"("city", "state");

-- CreateIndex
CREATE INDEX "vendor_capabilities_capability_domain_capability_id_confide_idx" ON "vendor_capabilities"("capability_domain", "capability_id", "confidence");

-- CreateIndex
CREATE INDEX "vendor_capabilities_capability_id_confidence_idx" ON "vendor_capabilities"("capability_id", "confidence");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_capabilities_vendor_id_capability_domain_capability__key" ON "vendor_capabilities"("vendor_id", "capability_domain", "capability_id");

-- CreateIndex
CREATE INDEX "capability_evidence_vendor_id_observed_at_idx" ON "capability_evidence"("vendor_id", "observed_at");

-- CreateIndex
CREATE INDEX "capability_evidence_source_idx" ON "capability_evidence"("source");

-- AddForeignKey
ALTER TABLE "vendor_capabilities" ADD CONSTRAINT "vendor_capabilities_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_evidence" ADD CONSTRAINT "capability_evidence_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
