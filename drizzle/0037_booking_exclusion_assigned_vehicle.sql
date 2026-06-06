-- Slice 6 (#392): rebind the booking exclusion constraint + effective-end trigger
-- from the legacy nullable "vehicleId" / vehicles."bufferMinutes" to the new
-- "assignedVehicleId" / location-level turnaround (proposal §2, §5.3, §9 item 20).
-- Custom because EXCLUDE constraints + triggers are not expressible in drizzle's
-- table builder. These objects are snapshot-invisible, so this migration causes
-- no schema-vs-snapshot drift. The legacy "vehicleId" / "bufferMinutes" COLUMNS
-- are dropped by the generated follow-up migration (0037), after this swap frees
-- them of their constraint/trigger dependencies.

-- 1. Drop the legacy exclusion (keyed on the nullable "vehicleId").
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_no_overlap";--> statement-breakpoint

-- 2. Drop the legacy trigger + function (read vehicles."bufferMinutes", fired on "vehicleId").
DROP TRIGGER IF EXISTS bookings_set_effective_end_at ON bookings;--> statement-breakpoint
DROP FUNCTION IF EXISTS compute_effective_end_at();--> statement-breakpoint

-- 3. Recompute "effectiveEndAt" from the booking's pickup-location turnaround
--    (locations."defaultTurnaroundMinutes" ?? 2880 = 48h). Location-only in MVP;
--    no per-vehicle override (§5.3). The buffer is a property of the pickup
--    location, not the car, so the function keys off "pickupLocationId".
CREATE OR REPLACE FUNCTION compute_effective_end_at() RETURNS trigger AS $$
DECLARE
  _turnaround int;
BEGIN
  SELECT "defaultTurnaroundMinutes" INTO _turnaround
    FROM locations
    WHERE id = NEW."pickupLocationId";

  -- ?? 2880 (48h) hard fallback if the location row is somehow absent.
  NEW."effectiveEndAt" := NEW."endAt" + COALESCE(_turnaround, 2880) * interval '1 minute';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- 4. Fire on INSERT or on UPDATE of the determinants ("endAt", "pickupLocationId").
--    Substitution changes "assignedVehicleId" only (pickup location unchanged), so
--    "effectiveEndAt" is invariant under substitution and the exclusion re-checks
--    automatically when "assignedVehicleId" changes.
CREATE TRIGGER bookings_set_effective_end_at
  BEFORE INSERT OR UPDATE OF "endAt", "pickupLocationId" ON bookings
  FOR EACH ROW EXECUTE FUNCTION compute_effective_end_at();--> statement-breakpoint

-- 5. Recreate the exclusion constraint, now keyed on "assignedVehicleId" (NOT NULL,
--    so the legacy "null operand skips exclusion" loophole is closed — every
--    CONFIRMED/ACTIVE booking atomically occupies its assigned car). A vehicle
--    belongs to exactly one operator, so operatorId is not needed in the key
--    (proposal §8.1). btree_gist already installed by 0006.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "assignedVehicleId" WITH =,
    tstzrange("startAt", "effectiveEndAt") WITH &&
  ) WHERE (status IN ('CONFIRMED', 'ACTIVE'));
