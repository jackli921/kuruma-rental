ALTER TABLE "threads" ADD COLUMN "operatorId" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "operatorUnreadCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_threads_operatorId" ON "threads" USING btree ("operatorId");--> statement-breakpoint
-- Backfill: existing threads inherit their booking's operator (#1205). Data-only,
-- no schema change, so the drizzle snapshot/journal stay in sync (db:verify green).
UPDATE "threads" t SET "operatorId" = b."operatorId" FROM "bookings" b WHERE t."bookingId" = b."id" AND t."operatorId" IS NULL;