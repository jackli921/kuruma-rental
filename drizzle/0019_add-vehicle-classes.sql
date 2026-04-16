CREATE TYPE "public"."vehicle_class_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "vehicle_classes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"photos" text[] DEFAULT '{}' NOT NULL,
	"seats" integer NOT NULL,
	"luggageCapacity" integer NOT NULL,
	"transmission" "transmission" NOT NULL,
	"fuelType" text,
	"dailyRateJpy" integer,
	"hourlyRateJpy" integer,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"status" "vehicle_class_status" DEFAULT 'ACTIVE' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_classes_slug_unique" UNIQUE("slug"),
	CONSTRAINT "vehicle_classes_pricing_at_least_one" CHECK ("vehicle_classes"."dailyRateJpy" IS NOT NULL OR "vehicle_classes"."hourlyRateJpy" IS NOT NULL),
	CONSTRAINT "vehicle_classes_daily_rate_non_negative" CHECK ("vehicle_classes"."dailyRateJpy" IS NULL OR "vehicle_classes"."dailyRateJpy" >= 0),
	CONSTRAINT "vehicle_classes_hourly_rate_non_negative" CHECK ("vehicle_classes"."hourlyRateJpy" IS NULL OR "vehicle_classes"."hourlyRateJpy" >= 0)
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "classId" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_classId_vehicle_classes_id_fk" FOREIGN KEY ("classId") REFERENCES "public"."vehicle_classes"("id") ON DELETE no action ON UPDATE no action;