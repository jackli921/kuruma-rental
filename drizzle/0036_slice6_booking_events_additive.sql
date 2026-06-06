CREATE TYPE "public"."booking_event_type" AS ENUM('BOOKING_CREATED', 'VEHICLE_SUBSTITUTED', 'BOOKING_CANCELLED', 'STATUS_CHANGED');--> statement-breakpoint
CREATE TABLE "booking_events" (
	"id" text PRIMARY KEY NOT NULL,
	"bookingId" text NOT NULL,
	"type" "booking_event_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"actorId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_classId_vehicle_classes_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "operatorId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "requestedVehicleId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "assignedVehicleId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pickupLocationId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "dropoffLocationId" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "bookingCode" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "insuranceOptionId" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "insuranceSnapshot" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "feeSnapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_bookingId_bookings_id_fk" FOREIGN KEY ("bookingId") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actorId_users_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_booking_events_bookingId" ON "booking_events" USING btree ("bookingId","createdAt");--> statement-breakpoint
CREATE INDEX "idx_booking_events_actorId" ON "booking_events" USING btree ("actorId");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_operatorId_operators_id_fk" FOREIGN KEY ("operatorId") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_pickupLocationId_locations_id_fk" FOREIGN KEY ("pickupLocationId") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_dropoffLocationId_locations_id_fk" FOREIGN KEY ("dropoffLocationId") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_operator_class_fk" FOREIGN KEY ("operatorId","classId") REFERENCES "public"."vehicle_classes"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_operatorId_id_unique" UNIQUE("operatorId","id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_operator_requested_vehicle_fk" FOREIGN KEY ("operatorId","requestedVehicleId") REFERENCES "public"."vehicles"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_operator_assigned_vehicle_fk" FOREIGN KEY ("operatorId","assignedVehicleId") REFERENCES "public"."vehicles"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_operator_insurance_fk" FOREIGN KEY ("operatorId","insuranceOptionId") REFERENCES "public"."insurance_options"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bookings_operatorId" ON "bookings" USING btree ("operatorId");--> statement-breakpoint
CREATE INDEX "idx_bookings_requestedVehicleId" ON "bookings" USING btree ("requestedVehicleId");--> statement-breakpoint
CREATE INDEX "idx_bookings_assignedVehicleId" ON "bookings" USING btree ("assignedVehicleId");--> statement-breakpoint
CREATE INDEX "idx_bookings_pickupLocationId" ON "bookings" USING btree ("pickupLocationId");--> statement-breakpoint
CREATE INDEX "idx_bookings_dropoffLocationId" ON "bookings" USING btree ("dropoffLocationId");--> statement-breakpoint
CREATE INDEX "idx_bookings_insuranceOptionId" ON "bookings" USING btree ("insuranceOptionId");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_bookingCode_unique" UNIQUE("bookingCode");