import { sql } from 'drizzle-orm'
import type { getDb } from './index'

/**
 * A seeded vehicle and the home base it must be placed at. The home is passed
 * EXPLICITLY: the seed's vehicle insert no longer writes `pickupLocationId`, so
 * the ids alone cannot reconstruct where a car belongs.
 */
export type SeedPlacement = {
  readonly vehicleId: string
  readonly homeLocationId: string
}

/**
 * Place seeded vehicles: home base + custody state land in ONE statement (§13).
 *
 * The seed inserts vehicles custody-untracked AND homeless, then calls this. Two
 * steps, not one, because:
 *   - the prod seed runs on neon-http, which has NO interactive transactions
 *     (CLAUDE.md), so a multi-statement "insert then place" cannot be atomic; and
 *   - a data-modifying CTE cannot insert a vehicle and update that same vehicle
 *     in one statement (the UPDATE reads the pre-statement snapshot).
 *
 * Ordering the steps this way makes the crash window harmless: a seed that dies
 * between them leaves an invisible homeless car, never the §8 parity bug of a
 * home-based car with no custody row (search lists it, checkout rejects it).
 *
 * The statement itself is a single implicit transaction under autocommit, so the
 * three-way CHECK and the deferred custody triggers see state + baseline period
 * together. Baseline periods are owner-hosted with `openedByLegId` NULL and zero
 * rate snapshots — the §13 bootstrap shape, identical to the 0115 backfill.
 *
 * Idempotent via the same `custodyState IS NULL` guard: re-seeding a warm branch
 * places nothing and leaves every existing period untouched.
 */
export async function placeSeededVehicles(
  db: ReturnType<typeof getDb>,
  placements: readonly SeedPlacement[],
): Promise<void> {
  if (placements.length === 0) return

  // Explicit ::text casts: a bare parameter in a VALUES list has unknown type,
  // which the join to vehicles.id would have to guess at.
  const rows = sql.join(
    placements.map((p) => sql`(${p.vehicleId}::text, ${p.homeLocationId}::text)`),
    sql`, `,
  )

  await db.execute(sql`
    WITH "input" ("vehicleId", "homeLocationId") AS (VALUES ${rows}),
    "placed" AS (
      INSERT INTO "custody_periods"
        ("id", "vehicleId", "ownerOperatorId", "hostOperatorId", "hostLocationId",
         "receivedAt", "openedByLegId", "dailyRateJpySnapshot", "handoffFeeJpySnapshot")
      SELECT gen_random_uuid(), v."id", v."operatorId", v."operatorId", i."homeLocationId",
             now(), NULL, 0, 0
      FROM "input" i
      JOIN "vehicles" v ON v."id" = i."vehicleId"
      WHERE v."custodyState" IS NULL
      RETURNING "id", "vehicleId", "hostLocationId"
    )
    UPDATE "vehicles" v
    SET "pickupLocationId" = p."hostLocationId",
        "custodyState" = 'AT_STATION',
        "physicalHostOperatorId" = v."operatorId",
        "physicalLocationId" = p."hostLocationId",
        "openCustodyPeriodId" = p."id"
    FROM "placed" p
    WHERE p."vehicleId" = v."id"
  `)
}
