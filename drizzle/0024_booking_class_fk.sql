-- Issue #308: renters book vehicle classes (Compact, SUV, ...); vehicles are
-- assigned later by the owner. Thus bookings gain classId (required) and
-- vehicleId becomes nullable.
--
-- Note: This migration is hand-written because drizzle-kit's auto-generator
-- sees a stale baseline (snapshots 0021/0022 are duplicates upstream) and
-- incorrectly re-adds idempotency columns that already exist. The snapshot
-- at drizzle/meta/0024_snapshot.json *is* correct and produced by the
-- generator — only the SQL file below is authored by hand.
--
-- Steps:
--   1. Add classId as nullable so backfill can populate it.
--   2. Backfill from vehicles.classId (every pre-#308 booking has a vehicleId).
--   3. Add FK and NOT NULL once rows are populated.
--   4. Drop NOT NULL on vehicleId so future bookings can defer assignment.

ALTER TABLE "bookings" ADD COLUMN "classId" text;
--> statement-breakpoint

UPDATE "bookings"
SET "classId" = v."classId"
FROM "vehicles" v
WHERE "bookings"."vehicleId" = v."id" AND "bookings"."classId" IS NULL;
--> statement-breakpoint

-- Fail loudly if any row is unbackfillable — a vehicle with a NULL classId
-- would otherwise hit a cryptic NOT NULL violation below. Surfacing the
-- count makes the fix obvious: backfill vehicles.classId first.
DO $$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing FROM bookings WHERE "classId" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'bookings.classId backfill incomplete: % rows still NULL. Backfill vehicles.classId first.', missing;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_classId_vehicle_classes_id_fk"
  FOREIGN KEY ("classId") REFERENCES "public"."vehicle_classes"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "bookings" ALTER COLUMN "classId" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "bookings" ALTER COLUMN "vehicleId" DROP NOT NULL;
