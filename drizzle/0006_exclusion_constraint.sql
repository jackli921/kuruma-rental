-- Prevent double-booking at the DB level. See docs/plans/2026-04-07-schema-api-design.md
-- Two bookings on the same vehicle with overlapping [startAt, effectiveEndAt) ranges
-- are rejected, scoped to CONFIRMED/ACTIVE (cancelled bookings don't block new ones).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "vehicleId" WITH =,
    tstzrange("startAt", "effectiveEndAt") WITH &&
  ) WHERE (status IN ('CONFIRMED', 'ACTIVE'));
