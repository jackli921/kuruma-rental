import { locations, operators, regions, users } from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleLocationRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { db } from './setup'

// #394: locations.regionId is a client-supplied FK to the platform-global regions
// tree. Adding it means POST /locations now carries TWO client FKs (operatorId +
// regionId), so the 23503->422 mapping must disambiguate on the constraint name
// ("Invalid region" vs "Invalid operator"). Only the real DB exercises the FK, so
// this drives the full HTTP app against Postgres. Also proves the column is
// settable end-to-end (create + PATCH) and defaults to null when omitted.
describe('locations.regionId write-path (#394)', () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opId = `op_loc_region_${uniq}`
  const staffUserId = crypto.randomUUID()
  const validRegionId = crypto.randomUUID()
  let app: ReturnType<typeof createApp>
  let headers: Record<string, string>

  const body = (extra: Record<string, unknown> = {}) => ({
    operatorId: opId,
    name: `Region Loc ${uniq} ${Math.random().toString(36).slice(2, 6)}`,
    address: '1-1 Namba, Chuo-ku, Osaka',
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
    await db.insert(regions).values({
      id: validRegionId,
      parentId: null,
      nameEn: 'Osaka',
      nameJa: '大阪府',
      nameZh: '大阪府',
    })
    app = createApp({
      vehicleRepo: new DrizzleVehicleRepository(db),
      bookingRepo: new DrizzleBookingRepository(db),
      availabilityRepo: new DrizzleAvailabilityRepository(db),
      locationRepo: new DrizzleLocationRepository(db),
    })
    headers = await authHeaders({ sub: staffUserId, role: 'STAFF' })
  })

  afterAll(async () => {
    // locations FK regions, so delete locations before regions.
    await db.delete(locations).where(inArray(locations.operatorId, [opId]))
    await db.delete(regions).where(inArray(regions.id, [validRegionId]))
    await db.delete(operators).where(inArray(operators.id, [opId]))
    await db.delete(users).where(inArray(users.id, [staffUserId]))
  })

  const post = (b: unknown) =>
    app.request('/locations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    })
  const patch = (id: string, b: unknown) =>
    app.request(`/locations/${id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    })

  it('creates a location without a region — regionId defaults to null', async () => {
    const res = await post(body())
    expect(res.status).toBe(201)
    expect((await res.json()).data.regionId).toBeNull()
  })

  it('creates a location with a valid regionId', async () => {
    const res = await post(body({ regionId: validRegionId }))
    expect(res.status).toBe(201)
    expect((await res.json()).data.regionId).toBe(validRegionId)
  })

  it('maps an unknown regionId to 422 "Invalid region"', async () => {
    const res = await post(body({ regionId: crypto.randomUUID() }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid region')
  })

  it('still maps an unknown operatorId to 422 "Invalid operator" (disambiguation guard)', async () => {
    const res = await post(body({ operatorId: `op_missing_${uniq}` }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid operator')
  })

  it('PATCH sets a regionId on an existing location', async () => {
    const created = await (await post(body())).json()
    const res = await patch(created.data.id, { regionId: validRegionId })
    expect(res.status).toBe(200)
    expect((await res.json()).data.regionId).toBe(validRegionId)
  })

  it('PATCH clears a regionId when sent null', async () => {
    const created = await (await post(body({ regionId: validRegionId }))).json()
    const res = await patch(created.data.id, { regionId: null })
    expect(res.status).toBe(200)
    expect((await res.json()).data.regionId).toBeNull()
  })

  it('PATCH maps an unknown regionId to 422 "Invalid region"', async () => {
    const created = await (await post(body())).json()
    const res = await patch(created.data.id, { regionId: crypto.randomUUID() })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid region')
  })

  it('persists the assigned region to the row (DB projection)', async () => {
    const created = await (await post(body({ regionId: validRegionId }))).json()
    const [row] = await db.select().from(locations).where(eq(locations.id, created.data.id))
    expect(row?.regionId).toBe(validRegionId)
  })
})
