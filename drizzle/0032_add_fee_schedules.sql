CREATE TYPE "public"."fee_schedule_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."fee_type" AS ENUM('OVERTIME_HOURLY', 'CLEANING_FLAT', 'NO_FUEL_FLAT');--> statement-breakpoint
CREATE TYPE "public"."fee_unit" AS ENUM('PER_HOUR', 'PER_DAY', 'PER_KM', 'FLAT');--> statement-breakpoint
CREATE TABLE "fee_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"operatorId" text NOT NULL,
	"vehicleClassId" text,
	"feeType" "fee_type" NOT NULL,
	"unit" "fee_unit" NOT NULL,
	"amountJpy" integer NOT NULL,
	"status" "fee_schedule_status" DEFAULT 'ACTIVE' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_schedules_amount_non_negative" CHECK ("fee_schedules"."amountJpy" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_operator_class_fk" FOREIGN KEY ("operatorId","vehicleClassId") REFERENCES "public"."vehicle_classes"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fee_schedules_operator_class" ON "fee_schedules" USING btree ("operatorId","vehicleClassId");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_schedules_active_class_unique" ON "fee_schedules" USING btree ("operatorId","feeType","vehicleClassId") WHERE status = 'ACTIVE' AND "vehicleClassId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_schedules_active_operatorwide_unique" ON "fee_schedules" USING btree ("operatorId","feeType") WHERE status = 'ACTIVE' AND "vehicleClassId" IS NULL;