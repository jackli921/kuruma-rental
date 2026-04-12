-- Issue #31: enforce effectiveEndAt = endAt + vehicle.bufferMinutes
-- Trigger computes the correct value on every insert/update.
-- CHECK constraint is defense-in-depth (catches direct SQL manipulation).

-- 1. Trigger function: compute effectiveEndAt from vehicle's bufferMinutes
CREATE OR REPLACE FUNCTION compute_effective_end_at() RETURNS trigger AS $$
DECLARE
  _buffer int;
BEGIN
  SELECT "bufferMinutes" INTO _buffer
    FROM vehicles
    WHERE id = NEW."vehicleId";

  IF _buffer IS NULL THEN
    RAISE EXCEPTION 'Vehicle % not found or has NULL bufferMinutes', NEW."vehicleId";
  END IF;

  NEW."effectiveEndAt" := NEW."endAt" + _buffer * interval '1 minute';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Fire on INSERT or UPDATE of endAt/vehicleId
CREATE TRIGGER bookings_set_effective_end_at
  BEFORE INSERT OR UPDATE OF "endAt", "vehicleId" ON bookings
  FOR EACH ROW EXECUTE FUNCTION compute_effective_end_at();

-- 3. CHECK: effectiveEndAt must be at or after endAt (>= allows zero-buffer vehicles)
ALTER TABLE bookings ADD CONSTRAINT effective_end_at_after_end_at
  CHECK ("effectiveEndAt" >= "endAt");
