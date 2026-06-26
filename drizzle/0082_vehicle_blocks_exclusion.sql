-- Custom SQL migration file, put your code below! --

-- #1101: block-vs-block overlap guard for vehicle_blocks. Custom because EXCLUDE
-- constraints are not expressible in drizzle's table builder (same pattern as
-- bookings_no_overlap, 0037) — this object is snapshot-invisible, so it causes no
-- schema-vs-snapshot drift. Two scheduled blocks on the SAME vehicle may not have
-- overlapping [startAt, endAt) windows. Keyed on vehicleId only: a vehicle belongs
-- to exactly one operator, so operatorId is redundant in the key (mirrors the
-- bookings_no_overlap rationale, proposal §8.1). No WHERE predicate — every block
-- is active (unlike bookings, which only exclude while CONFIRMED/ACTIVE).
-- btree_gist already installed by 0006. tstzrange is half-open [start, end), so
-- back-to-back blocks ([a,b) then [b,c)) do NOT conflict — consistent with bookings.
--
-- Booking-vs-block overlap is NOT enforced here: a single EXCLUDE index cannot span
-- two tables. That guarantee lives in the service layer (availability NOT EXISTS +
-- pg_advisory_xact_lock on vehicleId in booking creation).
ALTER TABLE "vehicle_blocks" ADD CONSTRAINT "vehicle_blocks_no_overlap"
  EXCLUDE USING gist (
    "vehicleId" WITH =,
    tstzrange("startAt", "endAt") WITH &&
  );
