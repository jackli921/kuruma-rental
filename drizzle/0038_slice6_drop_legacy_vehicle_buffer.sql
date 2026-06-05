ALTER TABLE "bookings" DROP CONSTRAINT "bookings_vehicleId_vehicles_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "vehicleId";--> statement-breakpoint
ALTER TABLE "vehicles" DROP COLUMN "bufferMinutes";