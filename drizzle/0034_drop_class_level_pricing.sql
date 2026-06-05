ALTER TABLE "vehicle_classes" DROP CONSTRAINT "vehicle_classes_pricing_at_least_one";--> statement-breakpoint
ALTER TABLE "vehicle_classes" DROP CONSTRAINT "vehicle_classes_daily_rate_non_negative";--> statement-breakpoint
ALTER TABLE "vehicle_classes" DROP CONSTRAINT "vehicle_classes_hourly_rate_non_negative";--> statement-breakpoint
ALTER TABLE "vehicle_classes" DROP COLUMN "dailyRateJpy";--> statement-breakpoint
ALTER TABLE "vehicle_classes" DROP COLUMN "hourlyRateJpy";