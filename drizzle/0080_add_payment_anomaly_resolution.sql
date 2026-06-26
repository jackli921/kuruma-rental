CREATE TYPE "public"."payment_anomaly_resolution" AS ENUM('BENIGN', 'INVESTIGATED', 'REFUNDED_EXTERNALLY');--> statement-breakpoint
ALTER TABLE "payment_anomalies" ADD COLUMN "resolution" "payment_anomaly_resolution";--> statement-breakpoint
ALTER TABLE "payment_anomalies" ADD COLUMN "resolvedBy" text;--> statement-breakpoint
ALTER TABLE "payment_anomalies" ADD COLUMN "note" text;