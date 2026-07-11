ALTER TABLE "bookings" DROP CONSTRAINT "bookings_pickupLocationId_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_dropoffLocationId_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_operator_pickup_location_fk" FOREIGN KEY ("operatorId","pickupLocationId") REFERENCES "public"."locations"("operatorId","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_operator_dropoff_location_fk" FOREIGN KEY ("operatorId","dropoffLocationId") REFERENCES "public"."locations"("operatorId","id") ON DELETE no action ON UPDATE no action;