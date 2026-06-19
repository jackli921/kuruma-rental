import { locations, operators, users, vehicles } from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { pgErrorCode } from '../../src/pg-errors'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleLocationRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import type { Location } from '../../src/stores'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { DEFAULT_DAILY_RATE_JPY, db } from './setup'

// Composite FK seal (#387 slice 2): a vehicle's pickupLocationId must belong to
// the vehicle's own operator. Enforced at the DB by FK
// vehicles(operatorId, pickupLocationId) -> locations(operatorId, id). A NULL
// pickupLocationId stays allowed (MATCH SIMPLE). This first suite exercises the
// column via raw update — proving the DB seal in isolation; the write path
// (repo/route/validator) it now flows through is covered by the #435 suites below.

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const opAId = `op_vploc_a_${uniq}`
const opBId = `op_vploc_b_${uniq}`

const vehicleInput = (operatorId: string) => ({
  operatorId,
  classId: null,
  name: 'Pickup FK Vehicle',
  description: null,
  photos: [] as string[],
  seats: 5,
  transmission: 'AUTO' as const,
  fuelType: null,
  licensePlate: null,
  status: 'AVAILABLE' as const,
  minRentalHours: null,
  maxRentalHours: null,
  advanceBookingHours: null,
  make: null,
  model: null,
  year: null,
  color: null,
  dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
  hourlyRateJpy: null,
  // #916: create requires future-dated shaken + insurance (§5.0).
  shakenExpiryDate: '2099-06-15',
  insuranceExpiryDate: '2099-01-01',
})

const locationInput = (
  operatorId: string,
  name: string,
): Omit<Location, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId,
  name,
  address: '1-1 Namba, Chuo-ku, Osaka',
  operatingHours: null,
  timezone: 'Asia/Tokyo',
  defaultTurnaroundMinutes: 2880,
  status: 'ACTIVE',
})

// Anchor to the PG foreign_key_violation code so a future unrelated error can't
// let the test pass while the cross-tenant seal silently breaks (mirrors the
// classId composite-FK suite).
const PG_FK_VIOLATION = '23503'
const violationCode = (p: Promise<unknown>): Promise<string | null> =>
  p.then(
    () => null,
    (err) => pgErrorCode(err),
  )

const setPickupLocation = (vehicleId: string, pickupLocationId: string | null): Promise<unknown> =>
  db.update(vehicles).set({ pickupLocationId }).where(eq(vehicles.id, vehicleId))

const readPickupLocation = async (vehicleId: string): Promise<string | null> => {
  const [row] = await db
    .select({ pickupLocationId: vehicles.pickupLocationId })
    .from(vehicles)
    .where(eq(vehicles.id, vehicleId))
  return row?.pickupLocationId ?? null
}

describe('vehicle pickupLocationId is sealed to the vehicle’s operator (composite FK)', () => {
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const locationRepo = new DrizzleLocationRepository(db)
  let locationA: Location
  let locationB: Location
  let vehicleAId: string

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `vploc-a-${uniq}`, name: 'VpLoc Operator A' },
      { id: opBId, slug: `vploc-b-${uniq}`, name: 'VpLoc Operator B' },
    ])
    locationA = await locationRepo.create(locationInput(opAId, 'Namba'))
    locationB = await locationRepo.create(locationInput(opBId, 'Umeda'))
    vehicleAId = (await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(opAId))).id
  })

  afterAll(async () => {
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(locations).where(inArray(locations.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('rejects a pickup location owned by another operator', async () => {
    expect(await violationCode(setPickupLocation(vehicleAId, locationB.id))).toBe(PG_FK_VIOLATION)
    expect(await readPickupLocation(vehicleAId)).toBeNull()
  })

  it('accepts the operator’s own pickup location', async () => {
    await setPickupLocation(vehicleAId, locationA.id)
    expect(await readPickupLocation(vehicleAId)).toBe(locationA.id)
  })

  it('accepts a null pickup location (unassigned vehicle)', async () => {
    await setPickupLocation(vehicleAId, null)
    expect(await readPickupLocation(vehicleAId)).toBeNull()
  })
})

// #435 wires pickupLocationId through the repo write path (the read path landed
// in #391). Before this, DrizzleVehicleRepository.create dropped the column on
// insert, so an operator could never place a car at a storefront via the API.
describe('vehicle repo create persists pickupLocationId (#435)', () => {
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const locationRepo = new DrizzleLocationRepository(db)
  const wUniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opId = `op_vplocw_${wUniq}`
  let location: Location

  beforeAll(async () => {
    await db
      .insert(operators)
      .values({ id: opId, slug: `vplocw-${wUniq}`, name: 'VpLocW Operator' })
    location = await locationRepo.create(locationInput(opId, 'Namba'))
  })

  afterAll(async () => {
    await db.delete(vehicles).where(eq(vehicles.operatorId, opId))
    await db.delete(locations).where(eq(locations.operatorId, opId))
    await db.delete(operators).where(eq(operators.id, opId))
  })

  it('persists a pickupLocationId passed to create', async () => {
    const created = await vehicleRepo.create(SYSTEM_CONTEXT, {
      ...vehicleInput(opId),
      pickupLocationId: location.id,
    })
    expect(created.pickupLocationId).toBe(location.id)
    expect(await readPickupLocation(created.id)).toBe(location.id)
  })
})

// Full HTTP path: a bypass (STAFF) caller names the operator in the body. The
// route must forward pickupLocationId through create/patch and map the
// composite-FK 23503 (a cross-tenant or missing location) to 422, distinct from
// the classId/operator FKs (#435, mirrors the #400 contract).
describe('POST/PATCH /vehicles wires pickupLocationId end-to-end (#435)', () => {
  const rUniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opId = `op_vplocr_${rUniq}`
  const foreignOpId = `op_vplocr_x_${rUniq}`
  const staffUserId = crypto.randomUUID()
  let ownLocation: Location
  let foreignLocation: Location
  let app: ReturnType<typeof createApp>
  let headers: Record<string, string>

  const vehicleBody = (extra: Record<string, unknown>) => ({
    operatorId: opId,
    name: 'Pickup Route Vehicle',
    seats: 5,
    transmission: 'AUTO' as const,
    bufferMinutes: 60,
    dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
    // #916: create requires future-dated shaken + insurance (§5.0).
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
    ...extra,
  })

  beforeAll(async () => {
    setupAuthEnv()
    await db.insert(operators).values([
      { id: opId, slug: `vplocr-${rUniq}`, name: 'VpLocR Operator' },
      { id: foreignOpId, slug: `vplocr-x-${rUniq}`, name: 'VpLocR Foreign' },
    ])
    const locationRepo = new DrizzleLocationRepository(db)
    ownLocation = await locationRepo.create(locationInput(opId, 'Namba'))
    foreignLocation = await locationRepo.create(locationInput(foreignOpId, 'Umeda'))
    await db.insert(users).values({
      id: staffUserId,
      email: `vplocr-${rUniq}@kuruma-test.com`,
      role: 'STAFF',
      language: 'en',
    })
    app = createApp({
      vehicleRepo: new DrizzleVehicleRepository(db),
      bookingRepo: new DrizzleBookingRepository(db),
      availabilityRepo: new DrizzleAvailabilityRepository(db),
      locationRepo,
    })
    headers = await authHeaders({ sub: staffUserId, role: 'STAFF' })
  })

  afterAll(async () => {
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opId, foreignOpId]))
    await db.delete(locations).where(inArray(locations.operatorId, [opId, foreignOpId]))
    await db.delete(users).where(eq(users.id, staffUserId))
    await db.delete(operators).where(inArray(operators.id, [opId, foreignOpId]))
  })

  const post = (body: unknown) =>
    app.request('/vehicles', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('POST persists the operator’s own pickupLocationId (201)', async () => {
    const res = await post(vehicleBody({ pickupLocationId: ownLocation.id }))
    expect(res.status).toBe(201)
    expect((await res.json()).data.pickupLocationId).toBe(ownLocation.id)
  })

  it('POST returns 422 "Invalid pickup location" for another operator’s location', async () => {
    const res = await post(vehicleBody({ pickupLocationId: foreignLocation.id }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('Invalid pickup location')
  })

  it('PATCH assigns a pickupLocationId to an unassigned vehicle', async () => {
    const created = await (await post(vehicleBody({}))).json()
    const res = await app.request(`/vehicles/${created.data.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pickupLocationId: ownLocation.id }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).data.pickupLocationId).toBe(ownLocation.id)
  })
})
