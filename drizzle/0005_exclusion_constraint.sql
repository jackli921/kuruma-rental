CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "effectiveEndAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "vehicleId" WITH =,
    tstzrange("startAt", "effectiveEndAt") WITH &&
  ) WHERE (status IN ('CONFIRMED', 'ACTIVE'));
