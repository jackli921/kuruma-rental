ALTER TABLE "class_rate_plans" DROP CONSTRAINT "class_rate_plans_pickupLocationId_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "class_rate_plans" ADD CONSTRAINT "class_rate_plans_operator_location_fk" FOREIGN KEY ("operatorId","pickupLocationId") REFERENCES "public"."locations"("operatorId","id") ON DELETE no action ON UPDATE no action;