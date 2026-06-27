import {
  bookings,
  locations,
  operators,
  users,
  vehicleClasses,
  vehicles,
} from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PUBLIC_CONTEXT, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleLocationRepository,
  DrizzleStorefrontRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import type { Location } from '../../src/stores'
import { DEFAULT_DAILY_RATE_JPY, db } from './setup'

// Proves the slice-5 (#391) Drizzle reads against real Postgres: the storefront
// JOIN (locations ⨝ operators, ACTIVE-only, cross-operator) and the extended
// findAvailableVehicles location/class predicate over the NOT EXISTS overlap
// query. pickupLocationId has no repo write path yet (#435) so it is set via
// raw update, exactly like vehicles-pickup-location.test.ts.

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const opAId = `op_sf_a_${uniq}`
const opBId = `op_sf_b_${uniq}`

const locationRepo = new DrizzleLocationRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)
const bookingRepo = new DrizzleBookingRepository(db)
const availabilityRepo = new DrizzleAvailabilityRepository(db)
const storefrontRepo = new DrizzleStorefrontRepository(db)

const FROM = new Date('2026-08-01T10:00:00Z')
const TO = new Date('2026-08-01T14:00:00Z')

let namba: Location
let gion: Location
let closed: Location
let compactAId: string
let vanAId: string
let bClassId: string
let renterId: string
let v1Id: string // namba, compact, free
let v2Id: string // namba, compact, booked over [FROM,TO)
let v3Id: string // namba, van, free
let v4Id: string // gion (other location), free

function seedClass(operatorId: string, label: string, acrissCode: string): Promise<string> {
  // slug is GLOBALLY unique — add per-call entropy so two operators can both
  // seed a "Compact" class without colliding.
  const rand = Math.random().toString(36).slice(2, 8)
  return db
    .insert(vehicleClasses)
    .values({
      id: crypto.randomUUID(),
      operatorId,
      name: `${label} ${uniq} ${rand}`,
      slug: `class-${label.toLowerCase()}-${uniq}-${rand}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      acrissCode,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })
    .returning({ id: vehicleClasses.id })
    .then(([row]) => {
      if (!row) throw new Error('failed to seed class')
      return row.id
    })
}

function seedVehicle(operatorId: string, classId: string, name: string): Promise<string> {
  return vehicleRepo
    .create(SYSTEM_CONTEXT, {
      operatorId,
      classId,
      name,
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: null,
      status: 'AVAILABLE',
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
      // #916: road-legal so the §5.2 availability gate keeps them searchable.
      shakenExpiryDate: '2099-06-15',
      insuranceExpiryDate: '2099-01-01',
    })
    .then((v) => v.id)
}

const setPickup = (vehicleId: string, locationId: string) =>
  db.update(vehicles).set({ pickupLocationId: locationId }).where(eq(vehicles.id, vehicleId))

beforeAll(async () => {
  await db.insert(operators).values([
    { id: opAId, slug: `sf-a-${uniq}`, name: 'SF Operator A' },
    { id: opBId, slug: `sf-b-${uniq}`, name: 'SF Operator B' },
  ])
  const [renter] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `sf-renter-${uniq}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning({ id: users.id })
  renterId = renter!.id

  const base = (operatorId: string, name: string) => ({
    operatorId,
    name,
    address: '1-1 Namba, Osaka',
    operatingHours: { openTime: '09:00', closeTime: '20:00' },
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 60,
    status: 'ACTIVE' as const,
  })
  namba = await locationRepo.create(base(opAId, `Namba ${uniq}`))
  gion = await locationRepo.create(base(opBId, `Gion ${uniq}`))
  closed = await locationRepo.create(base(opAId, `Closed ${uniq}`))
  await locationRepo.archive(closed.id)

  compactAId = await seedClass(opAId, 'Compact', 'CCAR')
  vanAId = await seedClass(opAId, 'Minivan', 'MVAR')
  bClassId = await seedClass(opBId, 'Compact', 'CCAR')

  v1Id = await seedVehicle(opAId, compactAId, 'A1')
  v2Id = await seedVehicle(opAId, compactAId, 'A2')
  v3Id = await seedVehicle(opAId, vanAId, 'A3')
  v4Id = await seedVehicle(opBId, bClassId, 'B1')
  await setPickup(v1Id, namba.id)
  await setPickup(v2Id, namba.id)
  await setPickup(v3Id, namba.id)
  await setPickup(v4Id, gion.id)

  // v2 is booked across [FROM, TO): startAt 10:00, effectiveEndAt 15:00
  // (endAt 14:00 + namba turnaround 60min; the DB trigger derives this).
  await bookingRepo.create(SYSTEM_CONTEXT, {
    operatorId: opAId,
    renterId,
    classId: compactAId,
    requestedVehicleId: v2Id,
    assignedVehicleId: v2Id,
    pickupLocationId: namba.id,
    dropoffLocationId: namba.id,
    startAt: FROM,
    endAt: TO,
    effectiveEndAt: new Date('2026-08-01T15:00:00Z'),
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: `SF-${uniq}`,
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: null,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
  })
})

afterAll(async () => {
  await db.delete(bookings).where(inArray(bookings.assignedVehicleId, [v1Id, v2Id, v3Id, v4Id]))
  await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
  await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opAId, opBId]))
  await db.delete(locations).where(inArray(locations.operatorId, [opAId, opBId]))
  await db.delete(users).where(eq(users.id, renterId))
  await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
})

describe('DrizzleStorefrontRepository.findActiveStorefronts (#391)', () => {
  it('returns ACTIVE storefronts across operators with the operator name joined', async () => {
    const result = await storefrontRepo.findActiveStorefronts(PUBLIC_CONTEXT)
    const byId = new Map(result.map((s) => [s.id, s]))

    expect(byId.get(namba.id)?.operatorName).toBe('SF Operator A')
    expect(byId.get(gion.id)?.operatorName).toBe('SF Operator B')
  })

  it('excludes ARCHIVED storefronts', async () => {
    const result = await storefrontRepo.findActiveStorefronts(PUBLIC_CONTEXT)
    expect(result.map((s) => s.id)).not.toContain(closed.id)
  })

  it('narrows to a single storefront with { pickupLocationId }', async () => {
    const result = await storefrontRepo.findActiveStorefronts(PUBLIC_CONTEXT, {
      pickupLocationId: namba.id,
    })
    expect(result.map((s) => s.id)).toEqual([namba.id])
  })

  // #1206: a soft-deactivated operator (operators.deactivatedAt set) is pulled off
  // the public storefront — the INNER-join now filters isNull(deactivatedAt) — while
  // active operators stay visible; reactivation (deactivatedAt -> null) restores it.
  it('hides a deactivated operator’s storefronts and restores them on reactivation', async () => {
    await db.update(operators).set({ deactivatedAt: new Date() }).where(eq(operators.id, opAId))
    try {
      const hidden = await storefrontRepo.findActiveStorefronts(PUBLIC_CONTEXT)
      const hiddenIds = hidden.map((s) => s.id)
      expect(hiddenIds).not.toContain(namba.id)
      // The other operator (B / Gion) is untouched by A's deactivation.
      expect(hiddenIds).toContain(gion.id)
    } finally {
      await db.update(operators).set({ deactivatedAt: null }).where(eq(operators.id, opAId))
    }

    const restored = await storefrontRepo.findActiveStorefronts(PUBLIC_CONTEXT)
    expect(restored.map((s) => s.id)).toContain(namba.id)
  })
})

describe('DrizzleAvailabilityRepository.findAvailableVehicles — storefront filters (#391)', () => {
  it('with { locationId } returns only that location’s free vehicles (booked + other-location excluded)', async () => {
    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, { locationId: namba.id })
    expect(new Set(result.map((v) => v.id))).toEqual(new Set([v1Id, v3Id]))
  })

  it('with { locationId, classId } narrows to one class at the location', async () => {
    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, {
      locationId: namba.id,
      classId: compactAId,
    })
    expect(result.map((v) => v.id)).toEqual([v1Id])
  })
})
