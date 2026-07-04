import { locations, operators, regions, users } from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleLocationRepository,
  DrizzleRegionRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { db } from './setup'

// #651 Slice 2 — the operator->region loop guard, end-to-end against Postgres. An
// ACTIVE location must resolve a region so it surfaces in renter region search: the
// service validates a provided one (assignable + ACTIVE, else 422 — never a raw FK
// 500), derives the nearest assignable area from the location's coords, or refuses
// (422). The two client FKs (operatorId + regionId) must still disambiguate. The
// Drizzle findAll projection + the FK are only exercised by the real DB, so
// this drives the full HTTP app against Postgres with an explicit null geocoder
// (deterministic: addresses never resolve, so derivation hinges only on sent coords).
describe('locations region loop guard write-path (#651 Slice 2)', () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opId = `op_loc_region_${uniq}`
  const staffUserId = crypto.randomUUID()
  const nambaId = crypto.randomUUID()
  const umedaId = crypto.randomUUID()
  const prefectureId = crypto.randomUUID()
  // #1276: an assignable CITY is a valid terminal region (operator picks
  // prefecture -> city and stops). The gate is assignable + ACTIVE, not type === AREA.
  const cityId = crypto.randomUUID()
  // Mirror the demo geography so derivation reads against credible coords.
  const NAMBA = { latitude: 34.6627, longitude: 135.5012 }
  const UMEDA = { latitude: 34.7025, longitude: 135.4959 }
  let app: ReturnType<typeof createApp>
  let headers: Record<string, string>

  const body = (extra: Record<string, unknown> = {}) => ({
    operatorId: opId,
    name: `Region Loc ${uniq} ${Math.random().toString(36).slice(2, 6)}`,
    address: '1-1 Namba, Chuo-ku, Osaka',
    // Default to the seeded assignable area; derivation/rejection tests override it.
    regionId: nambaId,
    ...extra,
  })

  beforeAll(async () => {
    setupAuthEnv()
    await db.insert(operators).values({ id: opId, slug: `loc-region-${uniq}`, name: 'Region Op' })
    await db.insert(users).values({
      id: staffUserId,
      email: `loc-region-${uniq}@kuruma-test.com`,
      role: 'STAFF',
      language: 'en',
    })
    await db.insert(regions).values([
      // Two assignable AREA nodes (provided / derive / PATCH-between cases)...
      {
        id: nambaId,
        parentId: null,
        nameEn: 'Namba',
        nameJa: '難波',
        nameZh: '难波',
        type: 'AREA',
        assignable: true,
        ...NAMBA,
      },
      {
        id: umedaId,
        parentId: null,
        nameEn: 'Umeda',
        nameJa: '梅田',
        nameZh: '梅田',
        type: 'AREA',
        assignable: true,
        ...UMEDA,
      },
      // ...one navigation-only PREFECTURE (assignable defaults false, no coords)...
      {
        id: prefectureId,
        parentId: null,
        nameEn: 'Osaka',
        nameJa: '大阪府',
        nameZh: '大阪府',
        type: 'PREFECTURE',
      },
      // ...and one assignable CITY under it (#1276), with no coords: selectable as a
      // terminal region but excluded from coord-based nearest-area auto-derivation.
      {
        id: cityId,
        parentId: prefectureId,
        nameEn: 'Osaka City',
        nameJa: '大阪市',
        nameZh: '大阪市',
        type: 'CITY',
        assignable: true,
      },
    ])
    app = createApp({
      vehicleRepo: new DrizzleVehicleRepository(db),
      bookingRepo: new DrizzleBookingRepository(db),
      availabilityRepo: new DrizzleAvailabilityRepository(db),
      locationRepo: new DrizzleLocationRepository(db),
      regionRepo: new DrizzleRegionRepository(db),
      // Deterministic: addresses never geocode, so derivation depends only on coords sent.
      geocoder: { geocode: async () => ({ status: 'notFound' }) },
    })
    headers = await authHeaders({ sub: staffUserId, role: 'STAFF' })
  })

  afterAll(async () => {
    // locations FK regions, so delete locations before regions.
    await db.delete(locations).where(inArray(locations.operatorId, [opId]))
    await db.delete(regions).where(inArray(regions.id, [nambaId, umedaId, prefectureId, cityId]))
    await db.delete(operators).where(inArray(operators.id, [opId]))
    await db.delete(users).where(inArray(users.id, [staffUserId]))
  })

  const post = (b: unknown) =>
    app.request('/locations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    })
  // #1456: the caller is a legacy STAFF admin (!isOperatorRole), so a location
  // write must bind to the operator it acts as via ?operatorId= — else the guard
  // 422s before the region checks. All PATCH targets here are owned by opId.
  const patch = (id: string, b: unknown) =>
    app.request(`/locations/${id}?operatorId=${opId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    })

  it('creates a location with a provided assignable region', async () => {
    const res = await post(body())
    expect(res.status).toBe(201)
    expect((await res.json()).data.regionId).toBe(nambaId)
  })

  it('creates a location with a provided assignable CITY region (#1276)', async () => {
    const res = await post(body({ regionId: cityId }))
    expect(res.status).toBe(201)
    expect((await res.json()).data.regionId).toBe(cityId)
  })

  it('derives the nearest assignable area when an ACTIVE create omits the region', async () => {
    // No region, but coords sit on Namba -> the guard derives it through the real DB.
    const res = await post(body({ regionId: undefined, ...NAMBA }))
    expect(res.status).toBe(201)
    expect((await res.json()).data.regionId).toBe(nambaId)
  })

  it('refuses an ACTIVE create with no region and no derivable coords (422)', async () => {
    const res = await post(body({ regionId: undefined }))
    expect(res.status).toBe(422)
  })

  it('maps an unknown regionId to 422 "Invalid region" (service guard, not a raw FK)', async () => {
    const res = await post(body({ regionId: crypto.randomUUID() }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid region')
  })

  it('maps a non-assignable (navigation-only) regionId to 422 "Invalid region"', async () => {
    const res = await post(body({ regionId: prefectureId }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid region')
  })

  it('still maps an unknown operatorId to 422 "Invalid operator" (FK disambiguation holds)', async () => {
    const res = await post(body({ operatorId: `op_missing_${uniq}` }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid operator')
  })

  it('PATCH moves a location to another assignable region', async () => {
    const created = await (await post(body())).json()
    const res = await patch(created.data.id, { regionId: umedaId })
    expect(res.status).toBe(200)
    expect((await res.json()).data.regionId).toBe(umedaId)
  })

  it('PATCH clearing the region of an ACTIVE location re-derives it (never null)', async () => {
    // Coords on Namba, so clearing the region re-derives Namba rather than nulling it.
    const created = await (await post(body({ ...NAMBA }))).json()
    const res = await patch(created.data.id, { regionId: null })
    expect(res.status).toBe(200)
    expect((await res.json()).data.regionId).toBe(nambaId)
  })

  it('PATCH maps an unknown regionId to 422 "Invalid region"', async () => {
    const created = await (await post(body())).json()
    const res = await patch(created.data.id, { regionId: crypto.randomUUID() })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid region')
  })

  it('persists the assigned region to the row (DB projection)', async () => {
    const created = await (await post(body({ regionId: umedaId }))).json()
    const [row] = await db.select().from(locations).where(eq(locations.id, created.data.id))
    expect(row?.regionId).toBe(umedaId)
  })
})
