-- CreateTable
CREATE TABLE "customer_requests" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "customer_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "capability_id" TEXT,
    "capability_name" TEXT,
    "product" TEXT,
    "customer_city" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "fulfilled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_deliveries" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "immediate" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "revealed_to_customer" BOOLEAN NOT NULL DEFAULT false,
    "credit_deducted" BOOLEAN NOT NULL DEFAULT false,
    "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "response_time_ms" INTEGER,

    CONSTRAINT "request_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_requests_conversation_id_idx" ON "customer_requests"("conversation_id");

-- CreateIndex
CREATE INDEX "customer_requests_status_expires_at_idx" ON "customer_requests"("status", "expires_at");

-- CreateIndex
CREATE INDEX "request_deliveries_vendor_id_status_idx" ON "request_deliveries"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "request_deliveries_status_delivered_at_idx" ON "request_deliveries"("status", "delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "request_deliveries_request_id_vendor_id_key" ON "request_deliveries"("request_id", "vendor_id");

-- AddForeignKey
ALTER TABLE "request_deliveries" ADD CONSTRAINT "request_deliveries_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "customer_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
