-- Issue #308: renters book vehicle classes (Compact, SUV, ...); vehicles are
-- assigned later by the owner. Thus bookings gain classId (required) and
-- vehicleId becomes nullable.
--
-- Self-healing: greenfield environments (MVP prod, fresh dev DBs, CI) may
-- have vehicles with NULL classId because they were seeded before the class
-- abstraction existed. The migration seeds an "Uncategorized" class and
-- assigns stray vehicles to it so the bookings backfill downstream has a
-- non-NULL source for every row. Owners rename/split the default via the
-- /manage/classes UI after first deploy.
--
-- Note: This migration is hand-written because drizzle-kit's auto-generator
-- sees a stale baseline (snapshots 0021/0022 are duplicates upstream) and
-- incorrectly re-adds idempotency columns that already exist. The snapshot
-- at drizzle/meta/0024_snapshot.json *is* correct and produced by the
-- generator — only the SQL file below is authored by hand.
--
-- Steps:
--   1. Ensure a default vehicle class exists if any vehicle is unclassified.
--   2. Backfill vehicles.classId for any stragglers.
--   3. Add bookings.classId as nullable, backfill from vehicles, enforce FK.
--   4. Drop NOT NULL on bookings.vehicleId so future bookings can defer assignment.

-- Step 1: seed the default class only when vehicles lack classes.
-- Idempotent — fixed ID 'cls_uncategorized_default' means replays are no-ops.
-- Pricing placeholders (8000 daily / 1200 hourly) match the precedent from
-- 0009_add_vehicle_pricing: owner-reviewable defaults that satisfy the
-- vehicle_classes_pricing_at_least_one CHECK. Owner overrides via the UI.
INSERT INTO "vehicle_classes" (
  "id", "name", "slug", "seats", "luggageCapacity",
  "transmission", "sortOrder", "status",
  "dailyRateJpy", "hourlyRateJpy"
)
SELECT
  'cls_uncategorized_default', 'Uncategorized', 'uncategorized', 4, 2,
  'AUTO'::transmission, 0, 'ACTIVE'::vehicle_class_status,
  8000, 1200
WHERE EXISTS (SELECT 1 FROM "vehicles" WHERE "classId" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "vehicle_classes" WHERE "id" = 'cls_uncategorized_default');
--> statement-breakpoint

-- Step 2: backfill any vehicles missing a classId.
UPDATE "vehicles"
SET "classId" = 'cls_uncategorized_default'
WHERE "classId" IS NULL;
--> statement-breakpoint

-- Step 3a: add bookings.classId as nullable.
ALTER TABLE "bookings" ADD COLUMN "classId" text;
--> statement-breakpoint

-- Step 3b: backfill from vehicles.classId (guaranteed non-NULL after step 2).
UPDATE "bookings"
SET "classId" = v."classId"
FROM "vehicles" v
WHERE "bookings"."vehicleId" = v."id" AND "bookings"."classId" IS NULL;
--> statement-breakpoint

-- Step 3c: fail loudly if any row is still unbackfillable. After steps 1+2
-- this should never trigger in greenfield, but the guard stays as insurance
-- for environments that somehow end up with orphan bookings.
DO $$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing FROM bookings WHERE "classId" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'bookings.classId backfill incomplete: % rows still NULL. Backfill vehicles.classId first.', missing;
  END IF;
END $$;
--> statement-breakpoint

-- Step 3d: lock in the FK and NOT NULL now that every row has a value.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_classId_vehicle_classes_id_fk"
  FOREIGN KEY ("classId") REFERENCES "public"."vehicle_classes"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "bookings" ALTER COLUMN "classId" SET NOT NULL;
--> statement-breakpoint

-- Step 4: vehicles are assigned later, so bookings.vehicleId is now optional.
ALTER TABLE "bookings" ALTER COLUMN "vehicleId" DROP NOT NULL;
