-- Durable outbound message queue.
--
-- The last mile had no write-ahead log: a reply composed during a turn existed only in memory,
-- so an unreachable Graph API meant the user got silence and nothing survived to retry.
CREATE TABLE "outbound_messages" (
  "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
  "channel"             TEXT         NOT NULL,
  "address"             TEXT         NOT NULL,
  "conversation_id"     UUID         NOT NULL,
  "response"            JSONB        NOT NULL,
  "status"              TEXT         NOT NULL DEFAULT 'pending',
  "attempts"            INTEGER      NOT NULL DEFAULT 0,
  "last_error"          TEXT,
  "provider_message_id" TEXT,
  "next_attempt_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at"             TIMESTAMP(3),

  CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- The sweep claim: due work, oldest first.
CREATE INDEX "outbound_messages_status_next_attempt_at_idx"
  ON "outbound_messages" ("status", "next_attempt_at");

-- Ordering guard: is anything still owed to this conversation?
CREATE INDEX "outbound_messages_conversation_id_status_created_at_idx"
  ON "outbound_messages" ("conversation_id", "status", "created_at");
