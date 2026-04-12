-- Issue #31: enforce effectiveEndAt = endAt + vehicle.bufferMinutes
-- Trigger computes the correct value on every insert/update.
-- CHECK constraint is defense-in-depth (catches direct SQL manipulation).

-- 1. Trigger function: compute effectiveEndAt from vehicle's bufferMinutes
CREATE OR REPLACE FUNCTION compute_effective_end_at() RETURNS trigger AS $$
BEGIN
  NEW."effectiveEndAt" := NEW."endAt" + (
    SELECT COALESCE("bufferMinutes", 60) * interval '1 minute'
    FROM vehicles
    WHERE id = NEW."vehicleId"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Fire on INSERT or UPDATE of endAt/vehicleId
CREATE TRIGGER bookings_set_effective_end_at
  BEFORE INSERT OR UPDATE OF "endAt", "vehicleId" ON bookings
  FOR EACH ROW EXECUTE FUNCTION compute_effective_end_at();

-- 3. CHECK: effectiveEndAt must always be after endAt
ALTER TABLE bookings ADD CONSTRAINT effective_end_at_after_end_at
  CHECK ("effectiveEndAt" > "endAt");
