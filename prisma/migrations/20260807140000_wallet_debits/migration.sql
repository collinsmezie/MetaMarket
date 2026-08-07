-- Balance spend (Konnet Credits Recharge TDR §25.4).
--
-- A credit records money received; a debit records credits consumed and an onboarding grant
-- mints them, and in neither case did any Naira move. NULL says that; 0 would claim a payment
-- of nothing arrived.
ALTER TABLE "credit_transactions" ALTER COLUMN "amount_kobo" DROP NOT NULL;

-- Balance statements read one side of the ledger at a time.
CREATE INDEX "credit_transactions_wallet_id_type_created_at_idx"
  ON "credit_transactions" ("wallet_id", "type", "created_at");
