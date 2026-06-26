-- Codify existing prod state into the drizzle snapshot (audit M7 / #1112).
-- Migrations 0010_add-fk-indexes.sql and 0022_messaging-idempotency-unique-indexes.sql
-- already created these indexes via hand-written SQL outside the drizzle module,
-- so the schema snapshot for threads / messages / thread_participants had no
-- record of them. Backporting the inline declarations updates the snapshot;
-- IF NOT EXISTS makes the apply a no-op on every environment that has already
-- run 0010 / 0022.
CREATE INDEX IF NOT EXISTS "idx_messages_threadId" ON "messages" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_senderId" ON "messages" USING btree ("senderId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_idempotency_key" ON "messages" USING btree ("idempotencyKey") WHERE "idempotencyKey" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thread_participants_threadId" ON "thread_participants" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thread_participants_userId" ON "thread_participants" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_threads_bookingId" ON "threads" USING btree ("bookingId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "threads_idempotency_key" ON "threads" USING btree ("idempotencyKey") WHERE "idempotencyKey" is not null;
