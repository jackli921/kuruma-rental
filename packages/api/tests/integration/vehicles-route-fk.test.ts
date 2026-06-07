import { locations, operators, users, vehicleClasses, vehicles } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import type { VehicleClass } from '../../src/stores'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { db, seedLocation } from './setup'

// #400: the composite FK vehicles(operatorId,classId) -> vehicle_classes(operatorId,id)
// (#395) rejects a cross-tenant classId at the DB with 23503. The vehicles route
// must map that to 422 rather than surfacing a raw 500. In-memory repos cannot
// exercise the DB-only FK, so this drives the full HTTP app against real Postgres.
// #412 part 3 extends the same contract to the third composite FK,
// vehicles(operatorId,pickupLocationId) -> locations (#387/#435).
describe('POST/PATCH /vehicles maps a cross-operator classId to 422 (#400)', () => {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_route_a_${uniq}`
  const opBId = `op_route_b_${uniq}`
  const staffUserId = crypto.randomUUID()
  let classA: VehicleClass
  let classB: VehicleClass
  let locationA: { id: string }
  let locationB: { id: string }
  let app: ReturnType<typeof createApp>
  let headers: Record<string, string>

  const makeClass = (operatorId: string, suffix: string): Promise<VehicleClass> =>
    new DrizzleVehicleClassRepository(db).create({
      operatorId,
      name: `Route FK Class ${suffix}`,
      slug: `route-fk-${suffix}-${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })

  // A non-operator (STAFF) caller names the target operator explicitly via the
  // body, so resolution is unambiguous; the classId is what the DB FK rejects.
  const vehicleBody = (operatorId: string, classId: string, pickupLocationId?: string) => ({
    operatorId,
    classId,
    name: 'Route FK Vehicle',
    seats: 5,
    transmission: 'AUTO' as const,
    licensePlate: null,
    dailyRateJpy: 8000,
    ...(pickupLocationId ? { pickupLocationId } : {}),
  })

  beforeAll(async () => {
    setupAuthEnv()
    await db.insert(operators).values([
      { id: opAId, slug: `route-a-${uniq}`, name: 'Route Operator A' },
      { id: opBId, slug: `route-b-${uniq}`, name: 'Route Operator B' },
    ])
    classA = await makeClass(opAId, 'a')
    classB = await makeClass(opBId, 'b')
    locationA = await seedLocation('route-fk-a', 2880, opAId)
    locationB = await seedLocation('route-fk-b', 2880, opBId)
    await db.insert(users).values({
      id: staffUserId,
      email: `route-fk-${uniq}@kuruma-test.com`,
      role: 'STAFF',
      language: 'en',
    })
    app = createApp({
      vehicleRepo: new DrizzleVehicleRepository(db),
      bookingRepo: new DrizzleBookingRepository(db),
      availabilityRepo: new DrizzleAvailabilityRepository(db),
      vehicleClassRepo: new DrizzleVehicleClassRepository(db),
    })
    headers = await authHeaders({ sub: staffUserId, role: 'STAFF' })
  })

  afterAll(async () => {
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opAId, opBId]))
    await db.delete(locations).where(inArray(locations.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
    await db.delete(users).where(inArray(users.id, [staffUserId]))
  })

  const post = (body: unknown) =>
    app.request('/vehicles', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('POST returns 422 for a classId owned by another operator', async () => {
    const res = await post(vehicleBody(opAId, classB.id))
    expect(res.status).toBe(422)
  })

  it('POST returns 201 for the operator’s own class', async () => {
    const res = await post(vehicleBody(opAId, classA.id))
    expect(res.status).toBe(201)
    expect((await res.json()).data.operatorId).toBe(opAId)
  })

  it('PATCH returns 422 when reassigning to another operator’s class', async () => {
    const created = await (await post(vehicleBody(opAId, classA.id))).json()
    const res = await app.request(`/vehicles/${created.data.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId: classB.id }),
    })
    expect(res.status).toBe(422)
  })

  // The single-column vehicles.operatorId -> operators FK is distinct from the
  // composite classId FK. classId: null leaves the composite FK unconstrained
  // (MATCH SIMPLE), so an unknown operatorId trips operators FK alone — and must
  // report "Invalid operator", not the misleading "Invalid vehicle class".
  it('POST returns 422 "Invalid operator" for a non-existent operatorId', async () => {
    const res = await post({
      operatorId: `op_missing_${uniq}`,
      classId: null,
      name: 'Route FK Vehicle',
      seats: 5,
      transmission: 'AUTO' as const,
      licensePlate: null,
      dailyRateJpy: 8000,
    })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid operator')
  })

  // #412 part 3: vehicles(operatorId, pickupLocationId) -> locations is a third
  // composite FK. A cross-tenant pickupLocationId trips it with 23503; the route
  // must report "Invalid pickup location" — not the misleading class/operator copy.
  it('POST returns 422 "Invalid pickup location" for a cross-operator pickupLocationId', async () => {
    const res = await post(vehicleBody(opAId, classA.id, locationB.id))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid pickup location')
  })

  it('POST returns 201 for the operator’s own pickup location', async () => {
    const res = await post(vehicleBody(opAId, classA.id, locationA.id))
    expect(res.status).toBe(201)
    expect((await res.json()).data.pickupLocationId).toBe(locationA.id)
  })

  it('PATCH returns 422 "Invalid pickup location" when reassigning to another operator’s location', async () => {
    const created = await (await post(vehicleBody(opAId, classA.id, locationA.id))).json()
    const res = await app.request(`/vehicles/${created.data.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickupLocationId: locationB.id }),
    })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid pickup location')
  })
})
