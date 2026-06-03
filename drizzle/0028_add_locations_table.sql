CREATE TYPE "public"."location_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"operatorId" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"operatingHours" jsonb,
	"timezone" text DEFAULT 'Asia/Tokyo' NOT NULL,
	"defaultTurnaroundMinutes" integer DEFAULT 2880 NOT NULL,
	"status" "location_status" DEFAULT 'ACTIVE' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_operatorId_name_unique" UNIQUE("operatorId","name"),
	CONSTRAINT "locations_operatorId_id_unique" UNIQUE("operatorId","id"),
	CONSTRAINT "locations_turnaround_non_negative" CHECK ("locations"."defaultTurnaroundMinutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_locations_operatorId" ON "locations" USING btree ("operatorId");