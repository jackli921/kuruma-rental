import { locations, operators, vehicles } from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { pgErrorCode } from '../../src/pg-errors'
import { DrizzleLocationRepository, DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import type { Location } from '../../src/stores'
import { DEFAULT_DAILY_RATE_JPY, db } from './setup'

// Composite FK seal (#387 slice 2): a vehicle's pickupLocationId must belong to
// the vehicle's own operator. Enforced at the DB by FK
// vehicles(operatorId, pickupLocationId) -> locations(operatorId, id). A NULL
// pickupLocationId stays allowed (MATCH SIMPLE). pickupLocationId is not yet
// wired into the vehicle repo/route/validator (slice 6), so the column is
// exercised directly via raw update — proving the seal, not the write path.

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
  bufferMinutes: 60,
  minRentalHours: null,
  maxRentalHours: null,
  advanceBookingHours: null,
  make: null,
  model: null,
  year: null,
  color: null,
  dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
  hourlyRateJpy: null,
  shakenExpiryDate: null,
  insuranceExpiryDate: null,
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
