-- Vendors need a WhatsApp number for request fan-out that is independent of their
-- conversation identity. A vendor who onboards in the browser is identified by a session,
-- not a phone number, so addressing the fan-out to `user_id` would send a WhatsApp message
-- to "web:<sessionId>" and reach nobody.
ALTER TABLE "vendors" ADD COLUMN "contact_phone" TEXT;

-- Backfill the vendors whose identity already *is* an E.164 number, so existing WhatsApp
-- sellers keep receiving requests without re-onboarding.
UPDATE "vendors" SET "contact_phone" = "user_id" WHERE "user_id" LIKE '+%';
