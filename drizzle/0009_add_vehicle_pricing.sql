ALTER TABLE "vehicles" ADD COLUMN "dailyRateJpy" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "hourlyRateJpy" integer;--> statement-breakpoint
-- Backfill: any pre-existing vehicle gets a placeholder daily rate of ¥8000
-- so the pricing_at_least_one CHECK constraint below can land. Issue #48
-- is a pre-launch slice; the owner is expected to review and override these
-- via the edit form after the migration applies. Without this step the
-- constraint addition fails on any DB with existing rows.
UPDATE "vehicles" SET "dailyRateJpy" = 8000 WHERE "dailyRateJpy" IS NULL AND "hourlyRateJpy" IS NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_pricing_at_least_one" CHECK ("vehicles"."dailyRateJpy" IS NOT NULL OR "vehicles"."hourlyRateJpy" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_daily_rate_non_negative" CHECK ("vehicles"."dailyRateJpy" IS NULL OR "vehicles"."dailyRateJpy" >= 0);--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_hourly_rate_non_negative" CHECK ("vehicles"."hourlyRateJpy" IS NULL OR "vehicles"."hourlyRateJpy" >= 0);