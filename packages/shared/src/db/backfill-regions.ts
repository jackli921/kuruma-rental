import { eq } from 'drizzle-orm'
import { planRegionBackfill } from '../lib/region-distance'
import type { getDb } from './index'
import { locations, regions } from './schema'

type Db = ReturnType<typeof getDb>

export interface RegionBackfillReport {
  /** Number of locations updated to point at their nearest assignable area. */
  assigned: number
  /** ACTIVE, coord-bearing locations with no area within radius — left null. */
  unassigned: readonly string[]
}

/**
 * One-off, idempotent backfill (#651 Slice 1): assign every ACTIVE location that
 * has coordinates but no region to its nearest assignable area. Injectable (DIP)
 * like `seed` so it runs against either the production neon-http `getDb()` or a
 * TCP postgres-js handle. The matching decision is the pure `planRegionBackfill`;
 * this function is the thin DB shell (read rows -> plan -> apply -> report).
 *
 * Idempotent: only region-less rows are considered, so a second run is a no-op.
 * Far-away locations (no area within REGION_SANITY_RADIUS_KM) are reported, never
 * mis-assigned.
 */
export async function backfillLocationRegions(db: Db): Promise<RegionBackfillReport> {
  const regionRows = await db
    .select({
      id: regions.id,
      latitude: regions.latitude,
      longitude: regions.longitude,
      assignable: regions.assignable,
      status: regions.status,
      sortOrder: regions.sortOrder,
    })
    .from(regions)

  const locationRows = await db
    .select({
      id: locations.id,
      latitude: locations.latitude,
      longitude: locations.longitude,
      regionId: locations.regionId,
      status: locations.status,
    })
    .from(locations)

  const plan = planRegionBackfill(regionRows, locationRows)
  for (const { locationId, regionId } of plan.assignments) {
    await db.update(locations).set({ regionId }).where(eq(locations.id, locationId))
  }
  return { assigned: plan.assignments.length, unassigned: plan.unassigned }
}
