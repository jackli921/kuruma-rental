CREATE TABLE "maintenance_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"costJpy" integer,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_cost_non_negative" CHECK ("maintenance_logs"."costJpy" IS NULL OR "maintenance_logs"."costJpy" >= 0)
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "make" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "maintenance_logs" ADD CONSTRAINT "maintenance_logs_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;