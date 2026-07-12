import { classRatePlans, locations, operators, users, vehicleClasses } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleClassRatePlanRepository,
  DrizzleLocationRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { db } from './setup'

// #464 Task 6: proves the class-rate-plan CRUD route stack end-to-end against
// real Postgres. Covers the full lifecycle (POST → GET → PATCH → DELETE),
// the 409 duplicate-scope guard, the 400 archived-class / archived-location
// guards, and the cross-tenant 404 isolation seal.

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function seedOperator(slug: string): Promise<string> {
  const id = `op_crp_${slug}`
  await db.insert(operators).values({ id, slug, name: `CRP Operator ${slug}` })
  return id
}

async function seedVehicleClass(
  operatorId: string,
  suffix: string,
  status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE',
): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(vehicleClasses).values({
    id,
    operatorId,
    name: `CRP Class ${suffix}`,
    slug: `crp-class-${suffix}`,
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO',
    dailyRateJpy: 5000,
    status,
  })
  return id
}

async function seedLocation(
  operatorId: string,
  suffix: string,
  status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE',
): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(locations).values({
    id,
    operatorId,
    name: `CRP Loc ${suffix}`,
    address: '1-1 Namba, Chuo-ku, Osaka',
    operatingHours: { openTime: '09:00', closeTime: '18:00' },
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status,
  })
  return id
}

describe('class-rate-plan CRUD + guards (HTTP + real Postgres, #464)', () => {
  const u = uniq()
  const staffUserId = crypto.randomUUID()
  let app: ReturnType<typeof createApp>
  let staffHeaders: Record<string, string>

  let opAId: string
  let opBId: string
  let activeClassId: string
  let archivedClassId: string
  let activeLocationId: string
  let archivedLocationId: string
  let crossTenantPlanId: string

  const operatorSlugs: string[] = []
  const classIds: string[] = []
  const locationIds: string[] = []

  beforeAll(async () => {
    setupAuthEnv()

    opAId = await seedOperator(`crpa-${u}`)
    opBId = await seedOperator(`crpb-${u}`)
    operatorSlugs.push(opAId, opBId)

    activeClassId = await seedVehicleClass(opAId, `act-${u}`, 'ACTIVE')
    archivedClassId = await seedVehicleClass(opAId, `arc-${u}`, 'ARCHIVED')
    classIds.push(activeClassId, archivedClassId)

    activeLocationId = await seedLocation(opAId, `act-${u}`, 'ACTIVE')
    archivedLocationId = await seedLocation(opAId, `arc-${u}`, 'ARCHIVED')
    locationIds.push(activeLocationId, archivedLocationId)

    // Seed a cross-tenant plan for the 404 isolation test
    const crossTenantClassId = await seedVehicleClass(opBId, `ct-${u}`, 'ACTIVE')
    const crossTenantLocationId = await seedLocation(opBId, `ct-${u}`, 'ACTIVE')
    classIds.push(crossTenantClassId)
    locationIds.push(crossTenantLocationId)
    const [ctRow] = await db
      .insert(classRatePlans)
      .values({
        operatorId: opBId,
        classId: crossTenantClassId,
        pickupLocationId: crossTenantLocationId,
        dayRateJpy: 8000,
        isActive: true,
        label: null,
      })
      .returning({ id: classRatePlans.id })
    if (!ctRow) throw new Error('Failed to seed cross-tenant rate plan')
    crossTenantPlanId = ctRow.id

    await db.insert(users).values({
      id: staffUserId,
      email: `crp-staff-${u}@kuruma-test.com`,
      role: 'STAFF',
      language: 'en',
    })

    app = createApp({
      vehicleRepo: new DrizzleVehicleRepository(db),
      bookingRepo: new DrizzleBookingRepository(db),
      availabilityRepo: new DrizzleAvailabilityRepository(db),
      vehicleClassRepo: new DrizzleVehicleClassRepository(db),
      locationRepo: new DrizzleLocationRepository(db),
      classRatePlanRepo: new DrizzleClassRatePlanRepository(db),
    })

    staffHeaders = await authHeaders({ sub: staffUserId, role: 'STAFF' })
  })

  afterAll(async () => {
    await db.delete(classRatePlans).where(inArray(classRatePlans.operatorId, operatorSlugs))
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.id, classIds))
    await db.delete(locations).where(inArray(locations.id, locationIds))
    await db.delete(users).where(inArray(users.id, [staffUserId]))
    await db.delete(operators).where(inArray(operators.id, operatorSlugs))
  })

  // -------------------------------------------------------------------------
  // Full lifecycle: POST → GET list → PATCH toggle → DELETE → GET empty
  // -------------------------------------------------------------------------

  let createdPlanId: string

  it('POST creates a rate plan (201)', async () => {
    const res = await app.request('/class-rate-plans', {
      method: 'POST',
      headers: { ...staffHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: opAId,
        classId: activeClassId,
        pickupLocationId: activeLocationId,
        dayRateJpy: 7500,
        isActive: true,
        label: 'Osaka Deal',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.operatorId).toBe(opAId)
    expect(body.data.classId).toBe(activeClassId)
    expect(body.data.pickupLocationId).toBe(activeLocationId)
    expect(body.data.dayRateJpy).toBe(7500)
    expect(body.data.isActive).toBe(true)
    expect(body.data.label).toBe('Osaka Deal')
    expect(typeof body.data.id).toBe('string')
    createdPlanId = body.data.id
  })

  it('GET list returns the created plan (1 result)', async () => {
    const res = await app.request(
      `/class-rate-plans?operatorId=${opAId}`,
      { method: 'GET', headers: staffHeaders },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    const plans: { id: string }[] = body.data
    expect(plans.some((p) => p.id === createdPlanId)).toBe(true)
  })

  it('PATCH toggles isActive to false (200)', async () => {
    const res = await app.request(`/class-rate-plans/${createdPlanId}?operatorId=${opAId}`, {
      method: 'PATCH',
      headers: { ...staffHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.isActive).toBe(false)
  })

  it('DELETE removes the plan (200)', async () => {
    const res = await app.request(`/class-rate-plans/${createdPlanId}?operatorId=${opAId}`, {
      method: 'DELETE',
      headers: staffHeaders,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe(createdPlanId)
  })

  it('GET list is empty after delete', async () => {
    const res = await app.request(
      `/class-rate-plans?operatorId=${opAId}&classId=${activeClassId}`,
      { method: 'GET', headers: staffHeaders },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // Duplicate-scope 409
  // -------------------------------------------------------------------------

  it('POST second plan for same (class, location) scope → 409', async () => {
    // Create first
    const first = await app.request('/class-rate-plans', {
      method: 'POST',
      headers: { ...staffHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: opAId,
        classId: activeClassId,
        pickupLocationId: activeLocationId,
        dayRateJpy: 6000,
      }),
    })
    expect(first.status).toBe(201)
    const firstId: string = (await first.json()).data.id

    // Attempt duplicate
    const dup = await app.request('/class-rate-plans', {
      method: 'POST',
      headers: { ...staffHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: opAId,
        classId: activeClassId,
        pickupLocationId: activeLocationId,
        dayRateJpy: 7000,
      }),
    })
    expect(dup.status).toBe(409)

    // Cleanup
    await db.delete(classRatePlans).where(inArray(classRatePlans.id, [firstId]))
  })

  // -------------------------------------------------------------------------
  // Archived class → 400 INVALID_VEHICLE_CLASS
  // -------------------------------------------------------------------------

  it('POST with archived classId → 400 INVALID_VEHICLE_CLASS', async () => {
    const res = await app.request('/class-rate-plans', {
      method: 'POST',
      headers: { ...staffHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: opAId,
        classId: archivedClassId,
        pickupLocationId: activeLocationId,
        dayRateJpy: 5000,
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_VEHICLE_CLASS')
  })

  // -------------------------------------------------------------------------
  // Archived location → 400 INVALID_LOCATION
  // -------------------------------------------------------------------------

  it('POST with archived pickupLocationId → 400 INVALID_LOCATION', async () => {
    const res = await app.request('/class-rate-plans', {
      method: 'POST',
      headers: { ...staffHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: opAId,
        classId: activeClassId,
        pickupLocationId: archivedLocationId,
        dayRateJpy: 5000,
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_LOCATION')
  })

  // -------------------------------------------------------------------------
  // Cross-tenant 404: STAFF caller can't see opB's plan via opA's scope
  // -------------------------------------------------------------------------

  it("GET by id returns 404 for another operator's plan when scoped to opA", async () => {
    // The STAFF token scoped to opA cannot reach opB's plan.
    // We scope the read via `?operatorId=opAId` so the repo applies opA's scope
    // and opB's plan is invisible.
    const opAHeaders = await authHeaders({
      sub: staffUserId,
      role: 'OPERATOR_OWNER',
      operatorId: opAId,
    })
    const res = await app.request(`/class-rate-plans/${crossTenantPlanId}`, {
      method: 'GET',
      headers: opAHeaders,
    })
    expect(res.status).toBe(404)
  })
})
