CREATE TABLE "class_rate_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"operatorId" text NOT NULL,
	"classId" text NOT NULL,
	"pickupLocationId" text NOT NULL,
	"dayRateJpy" integer NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"label" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_rate_plans_operator_class_location_unique" UNIQUE("operatorId","classId","pickupLocationId"),
	CONSTRAINT "class_rate_plans_day_rate_non_negative" CHECK ("class_rate_plans"."dayRateJpy" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "requestedVehicleId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "assignedVehicleId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "class_rate_plans" ADD CONSTRAINT "class_rate_plans_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_rate_plans" ADD CONSTRAINT "class_rate_plans_pickupLocationId_locations_id_fk" FOREIGN KEY ("pickupLocationId") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_rate_plans" ADD CONSTRAINT "class_rate_plans_operator_class_fk" FOREIGN KEY ("operatorId","classId") REFERENCES "public"."vehicle_classes"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_class_rate_plans_pickup_location" ON "class_rate_plans" USING btree ("pickupLocationId");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_specific_requires_requested" CHECK ("bookings"."fulfillmentMode" <> 'SPECIFIC' OR "bookings"."requestedVehicleId" IS NOT NULL);