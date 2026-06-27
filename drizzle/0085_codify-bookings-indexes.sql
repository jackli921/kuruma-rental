-- Codify three hand-SQL bookings indexes:
--   idx_bookings_renterId        from 0010_add-fk-indexes.sql
--   idx_bookings_status          from 0014_add-bookings-status-index.sql
--   bookings_idempotency_key     from 0012_idempotency-unique-index.sql
-- All three already exist in prod, so IF NOT EXISTS — this migration only
-- brings the drizzle snapshot into agreement with the live DB. See #1173 / #1150.
CREATE INDEX IF NOT EXISTS "idx_bookings_renterId" ON "bookings" USING btree ("renterId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bookings_status" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_idempotency_key" ON "bookings" USING btree ("idempotencyKey") WHERE "idempotencyKey" is not null;
