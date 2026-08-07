-- CreateTable
CREATE TABLE "credit_wallets" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "balance_credits" INTEGER NOT NULL DEFAULT 0,
    "provider_customer_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_accounts" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'paystack',
    "provider_account_id" TEXT,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "provider_reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtual_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'credit',
    "amount_credits" INTEGER NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "provider_reference" TEXT,
    "event_id" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_notifications" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'paystack',
    "event_type" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "amount_kobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" TEXT NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "payment_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_wallets_user_id_key" ON "credit_wallets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_account_number_key" ON "virtual_accounts"("account_number");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_provider_reference_key" ON "virtual_accounts"("provider_reference");

-- CreateIndex
CREATE INDEX "virtual_accounts_wallet_id_status_idx" ON "virtual_accounts"("wallet_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "credit_transactions_provider_reference_key" ON "credit_transactions"("provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "credit_transactions_event_id_key" ON "credit_transactions"("event_id");

-- CreateIndex
CREATE INDEX "credit_transactions_wallet_id_created_at_idx" ON "credit_transactions"("wallet_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_notifications_event_id_key" ON "payment_notifications"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_notifications_provider_reference_key" ON "payment_notifications"("provider_reference");

-- CreateIndex
CREATE INDEX "payment_notifications_status_received_at_idx" ON "payment_notifications"("status", "received_at");

-- AddForeignKey
ALTER TABLE "virtual_accounts" ADD CONSTRAINT "virtual_accounts_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "credit_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "credit_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
