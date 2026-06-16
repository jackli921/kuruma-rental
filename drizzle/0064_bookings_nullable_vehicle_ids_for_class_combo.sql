ALTER TABLE "bookings" ALTER COLUMN "requestedVehicleId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "assignedVehicleId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_specific_requires_requested" CHECK ("bookings"."fulfillmentMode" <> 'SPECIFIC' OR "bookings"."requestedVehicleId" IS NOT NULL);