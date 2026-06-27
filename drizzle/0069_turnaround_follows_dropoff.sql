-- #1023 (one-way rentals design §6 / maintainability finding F1): "effectiveEndAt"
-- must follow the DROPOFF location's turnaround, not the pickup's. A one-way rental
-- is returned and cleaned at the dropoff, so the car's next-bookable window is the
-- dropoff's buffer. 0037 keyed compute_effective_end_at() off "pickupLocationId" —
-- correct only while every booking was same-location (pickup == dropoff), where the
-- value is identical. This is latent until one-way bookings exist; same-location
-- bookings are unchanged. Custom because triggers/functions are not expressible in
-- drizzle's table builder and are snapshot-invisible (no schema-vs-snapshot drift).

-- 1. Recompute "effectiveEndAt" from the DROPOFF location's turnaround.
--    locations."defaultTurnaroundMinutes" is NOT NULL DEFAULT 2880, so COALESCE only
--    guards an (FK-protected, effectively impossible) missing dropoff row — kept byte
--    for byte in step with the service mirror in booking-creation.ts.
CREATE OR REPLACE FUNCTION compute_effective_end_at() RETURNS trigger AS $$
DECLARE
  _turnaround int;
BEGIN
  SELECT "defaultTurnaroundMinutes" INTO _turnaround
    FROM locations
    WHERE id = NEW."dropoffLocationId";

  -- ?? 2880 (48h) hard fallback if the dropoff location row is somehow absent.
  NEW."effectiveEndAt" := NEW."endAt" + COALESCE(_turnaround, 2880) * interval '1 minute';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- 2. "effectiveEndAt" now depends on ("endAt", "dropoffLocationId"); "pickupLocationId"
--    is no longer a determinant. Recreate the trigger over the new determinant set
--    (CREATE OR REPLACE FUNCTION alone can't change the trigger's UPDATE OF columns).
--    Substitution still touches only "assignedVehicleId", so "effectiveEndAt" stays
--    invariant under substitution and the exclusion re-checks automatically.
DROP TRIGGER IF EXISTS bookings_set_effective_end_at ON bookings;--> statement-breakpoint
CREATE TRIGGER bookings_set_effective_end_at
  BEFORE INSERT OR UPDATE OF "endAt", "dropoffLocationId" ON bookings
  FOR EACH ROW EXECUTE FUNCTION compute_effective_end_at();
