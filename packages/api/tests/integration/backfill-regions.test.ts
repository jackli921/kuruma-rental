import { backfillLocationRegions } from '@kuruma/shared/db/backfill-regions'
import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { locations, regions } from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from './setup'

// #651 Slice 1 — the one-off location->region backfill, end-to-end against Postgres
// (PR #758 review LOW #4). `backfillLocationRegions` reads EVERY region + location in
// the database (it is the global one-off, not a scoped query), so this suite cannot
// assert on global counts — concurrent integration files seed their own Kansai rows.
// Instead it seeds ONE assignable area far from the demo geography (Sapporo) plus a
// far point with nothing in radius (Okinawa), and asserts PER ROW by id. That is both
// mutation-resistant (the exact target region is checked, not "something changed") and
// isolation-safe (no other file touches Hokkaido/Okinawa).
describe('location->region backfill (#651 Slice 1)', () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const areaId = crypto.randomUUID()
  const nearId = crypto.randomUUID()
  const farId = crypto.randomUUID()
  const archivedId = crypto.randomUUID()
  const noCoordsId = crypto.randomUUID()
  const preAssignedId = crypto.randomUUID()

  // An assignable area + a pickup point ~1 km away; both ~1000 km from the Kansai
  // demo areas, so the area is the unambiguous nearest regardless of seeded data.
  const SAPPORO_AREA = { latitude: 43.0621, longitude: 141.3544 }
  const NEAR_POINT = { latitude: 43.07, longitude: 141.36 }
  // ~2200 km from Sapporo — beyond REGION_SANITY_RADIUS_KM (100), so unassignable.
  const OKINAWA_FAR = { latitude: 26.2124, longitude: 127.6809 }

  // Report from the first backfill run, captured once for the assertion cases.
  let report: Awaited<ReturnType<typeof backfillLocationRegions>>

  // `backfillLocationRegions` is typed against the production neon-http handle; the
  // integration suite injects the structurally-identical postgres-js `testDb` (the
  // same cast every Drizzle repo construction here uses).
  type BackfillDb = Parameters<typeof backfillLocationRegions>[0]
  const runBackfill = () => backfillLocationRegions(db as unknown as BackfillDb)

  const loc = (id: string, name: string, extra: Record<string, unknown>) => ({
    id,
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    name: `BF ${name} ${uniq}`,
    address: '1-1 Backfill, Test',
    status: 'ACTIVE' as const,
    regionId: null,
    ...extra,
  })

  const regionOf = async (id: string): Promise<string | null | undefined> => {
    const [row] = await db
      .select({ regionId: locations.regionId })
      .from(locations)
      .where(eq(locations.id, id))
    return row?.regionId
  }

  beforeAll(async () => {
    await db.insert(regions).values({
      id: areaId,
      parentId: null,
      nameEn: `Backfill Area ${uniq}`,
      nameJa: 'テスト地区',
      nameZh: '测试地区',
      type: 'AREA',
      assignable: true,
      status: 'ACTIVE',
      ...SAPPORO_AREA,
    })
    await db
      .insert(locations)
      .values([
        loc(nearId, 'near', { ...NEAR_POINT }),
        loc(farId, 'far', { ...OKINAWA_FAR }),
        loc(archivedId, 'archived', { ...NEAR_POINT, status: 'ARCHIVED' }),
        loc(noCoordsId, 'nocoords', { latitude: null, longitude: null }),
        loc(preAssignedId, 'preassigned', { ...NEAR_POINT, regionId: areaId }),
      ])
    report = await runBackfill()
  })

  afterAll(async () => {
    // locations FK regions, so delete the locations before the area they point at.
    await db
      .delete(locations)
      .where(inArray(locations.id, [nearId, farId, archivedId, noCoordsId, preAssignedId]))
    await db.delete(regions).where(eq(regions.id, areaId))
  })

  it('assigns a region-less ACTIVE location to its nearest assignable area', async () => {
    expect(await regionOf(nearId)).toBe(areaId)
  })

  it('reports a far-away location as unassigned and leaves its region null', async () => {
    expect(report.unassigned).toContain(farId)
    expect(await regionOf(farId)).toBeNull()
  })

  it('skips ARCHIVED locations even when a nearby area exists', async () => {
    expect(await regionOf(archivedId)).toBeNull()
  })

  it('skips locations with no coordinates', async () => {
    expect(await regionOf(noCoordsId)).toBeNull()
  })

  it('leaves an already-assigned location untouched', async () => {
    expect(await regionOf(preAssignedId)).toBe(areaId)
  })

  it('is idempotent — a second run re-reports the far row and changes no assignment', async () => {
    const second = await runBackfill()
    expect(second.unassigned).toContain(farId)
    // The row assigned on the first run is region-bearing now, so the second run
    // never reconsiders it: its region is unchanged.
    expect(await regionOf(nearId)).toBe(areaId)
    expect(await regionOf(farId)).toBeNull()
  })
})
