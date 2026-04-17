ALTER TABLE "messages" ADD COLUMN "idempotencyKey" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "idempotencyKey" text;
