-- One-way custody bootstrap (§13): every vehicle WITH a home base starts
-- AT_STATION at home, host = owner, with a BASELINE custody period (owner-host,
-- rate 0, openedByLegId NULL — the only rows permitted null). Vehicles WITHOUT
-- a home base stay custody-untracked (custodyState NULL) until one is assigned
-- (the Task 12 on-ramp). Idempotent via the custodyState IS NULL guard, and
-- flag-off-equivalent: physicalLocationId mirrors pickupLocationId exactly.
-- The three-way CHECK requires state + period to land in ONE statement.
WITH placed AS (
  INSERT INTO "custody_periods"
    ("id", "vehicleId", "ownerOperatorId", "hostOperatorId", "hostLocationId",
     "receivedAt", "openedByLegId", "dailyRateJpySnapshot", "handoffFeeJpySnapshot")
  SELECT gen_random_uuid(), v."id", v."operatorId", v."operatorId", v."pickupLocationId",
         now(), NULL, 0, 0
  FROM "vehicles" v
  WHERE v."pickupLocationId" IS NOT NULL AND v."custodyState" IS NULL
  RETURNING "id", "vehicleId"
)
UPDATE "vehicles" v
SET "custodyState" = 'AT_STATION',
    "physicalHostOperatorId" = v."operatorId",
    "physicalLocationId" = v."pickupLocationId",
    "openCustodyPeriodId" = p."id"
FROM placed p
WHERE p."vehicleId" = v."id";
