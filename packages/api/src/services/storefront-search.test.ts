import { beforeEach, describe, expect, it } from 'vitest'
import { PUBLIC_CONTEXT, SYSTEM_CONTEXT } from '../middleware/auth'
import { InMemoryAvailabilityRepository } from '../repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryLocationRepository } from '../repositories/in-memory/location'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryStorefrontRepository } from '../repositories/in-memory/storefront'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import { InMemoryVehicleClassRepository } from '../repositories/in-memory/vehicle-class'
import type { Location, Operator, Vehicle, VehicleClass } from '../stores'
import { StorefrontSearchService } from './storefront-search'

const FROM = new Date('2026-08-01T10:00:00Z')
const TO = new Date('2026-08-01T14:00:00Z')

let operatorRepo: InMemoryOperatorRepository
let locationRepo: InMemoryLocationRepository
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let classRepo: InMemoryVehicleClassRepository
let service: StorefrontSearchService

beforeEach(() => {
  operatorRepo = new InMemoryOperatorRepository()
  locationRepo = new InMemoryLocationRepository()
  vehicleRepo = new InMemoryVehicleRepository()
  bookingRepo = new InMemoryBookingRepository()
  classRepo = new InMemoryVehicleClassRepository()
  const storefrontRepo = new InMemoryStorefrontRepository(locationRepo, operatorRepo)
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  service = new StorefrontSearchService(storefrontRepo, availabilityRepo, classRepo)
})

function makeOperator(name: string, slug: string): Promise<Operator> {
  return operatorRepo.create({ name, slug, preAuthHandoffUrl: null })
}

function makeClass(overrides: Partial<Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'>>) {
  return classRepo.create({
    operatorId: 'op_a',
    name: 'Compact',
    slug: `compact-${crypto.randomUUID().slice(0, 8)}`,
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: 'CCAR',
    sortOrder: 0,
    status: 'ACTIVE',
    ...overrides,
  })
}

function makeLocation(overrides: Partial<Omit<Location, 'id' | 'createdAt' | 'updatedAt'>>) {
  return locationRepo.create({
    operatorId: 'op_a',
    name: 'Namba',
    address: '1-1 Namba, Osaka',
    operatingHours: { openTime: '09:00', closeTime: '20:00' },
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 60,
    status: 'ACTIVE',
    ...overrides,
  })
}

function makeVehicle(overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>>) {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: 'op_a',
    classId: 'class_compact',
    pickupLocationId: 'loc_namba',
    name: 'Toyota Yaris',
    description: null,
    photos: [],
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: 'Toyota',
    model: 'Yaris',
    year: 2023,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    ...overrides,
  })
}

function bookOverlapping(vehicleId: string, classId: string) {
  return bookingRepo.create(SYSTEM_CONTEXT, {
    operatorId: 'op_a',
    renterId: 'u1',
    classId,
    requestedVehicleId: vehicleId,
    assignedVehicleId: vehicleId,
    pickupLocationId: 'loc_namba',
    dropoffLocationId: 'loc_namba',
    startAt: new Date('2026-08-01T09:00:00Z'),
    endAt: new Date('2026-08-01T12:00:00Z'),
    effectiveEndAt: new Date('2026-08-01T13:00:00Z'),
    status: 'CONFIRMED',
    source: 'DIRECT',
    bookingCode: `bk-${vehicleId}`,
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: null,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
  })
}

async function ok(result: Awaited<ReturnType<StorefrontSearchService['search']>>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.data
}

describe('StorefrontSearchService.search (#391)', () => {
  it('classSummaries counts only available vehicles — an overlapping booking drops the count by one', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, name: 'Compact', acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const opts = { operatorId: op.id, classId: compact.id, pickupLocationId: namba.id }
    await makeVehicle(opts)
    await makeVehicle(opts)
    const booked = await makeVehicle(opts)

    const before = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))
    const beforeSummary = before.storefronts[0]?.classSummaries.find((s) => s.acrissCode === 'CCAR')
    expect(beforeSummary).toEqual({ acrissCode: 'CCAR', label: 'Compact', availableCount: 3 })

    await bookOverlapping(booked.id, compact.id)

    const after = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))
    const afterSummary = after.storefronts[0]?.classSummaries.find((s) => s.acrissCode === 'CCAR')
    expect(afterSummary?.availableCount).toBe(2)
  })

  it('fromDailyPriceJpy is the minimum dailyRateJpy across available vehicles', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const base = { operatorId: op.id, classId: compact.id, pickupLocationId: namba.id }
    await makeVehicle({ ...base, dailyRateJpy: 8000 })
    await makeVehicle({ ...base, dailyRateJpy: 4500 })
    await makeVehicle({ ...base, dailyRateJpy: 6000 })

    const data = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))

    expect(data.storefronts[0]?.fromDailyPriceJpy).toBe(4500)
    expect(data.storefronts[0]?.fromHourlyPriceJpy).toBeNull()
  })

  it('a store with only hourly-priced vehicles returns null daily price and the exact min hourly', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const base = { operatorId: op.id, classId: compact.id, pickupLocationId: namba.id }
    await makeVehicle({ ...base, dailyRateJpy: null, hourlyRateJpy: 1000 })
    await makeVehicle({ ...base, dailyRateJpy: null, hourlyRateJpy: 800 })

    const data = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))

    expect(data.storefronts[0]?.fromDailyPriceJpy).toBeNull()
    expect(data.storefronts[0]?.fromHourlyPriceJpy).toBe(800)
  })

  it('omits a store with zero available vehicles in the date range', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const umeda = await makeLocation({ operatorId: op.id, name: 'Umeda' })
    await makeVehicle({ operatorId: op.id, classId: compact.id, pickupLocationId: namba.id })
    const full = await makeVehicle({
      operatorId: op.id,
      classId: compact.id,
      pickupLocationId: umeda.id,
    })
    await bookOverlapping(full.id, compact.id)

    const data = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))

    expect(data.storefronts.map((s) => s.locationId)).toEqual([namba.id])
  })

  it('class filter trims classSummaries to the requested ACRISS codes', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, name: 'Compact', acrissCode: 'CCAR' })
    const van = await makeClass({ operatorId: op.id, name: 'Minivan', acrissCode: 'MVAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    await makeVehicle({ operatorId: op.id, classId: compact.id, pickupLocationId: namba.id })
    await makeVehicle({ operatorId: op.id, classId: compact.id, pickupLocationId: namba.id })
    await makeVehicle({ operatorId: op.id, classId: van.id, pickupLocationId: namba.id })

    const data = await ok(
      await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, classes: ['CCAR'] }),
    )

    expect(data.storefronts[0]?.classSummaries).toEqual([
      { acrissCode: 'CCAR', label: 'Compact', availableCount: 2 },
    ])
  })

  it('returns storefronts from every operator (cross-operator marketplace)', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const b = await makeOperator('B Rentals', 'b')
    const classA = await makeClass({ operatorId: a.id, acrissCode: 'CCAR' })
    const classB = await makeClass({ operatorId: b.id, acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id, name: 'Namba' })
    const gion = await makeLocation({ operatorId: b.id, name: 'Gion' })
    await makeVehicle({ operatorId: a.id, classId: classA.id, pickupLocationId: namba.id })
    await makeVehicle({ operatorId: b.id, classId: classB.id, pickupLocationId: gion.id })

    const data = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO }))

    expect(new Set(data.storefronts.map((s) => s.operatorId))).toEqual(new Set([a.id, b.id]))
  })

  it('caps a page at the limit and resumes from the cursor without overlap', async () => {
    const stores: string[] = []
    for (const [name, slug] of [
      ['A Rentals', 'a'],
      ['B Rentals', 'b'],
      ['C Rentals', 'c'],
    ] as const) {
      const op = await makeOperator(name, slug)
      const klass = await makeClass({ operatorId: op.id, acrissCode: 'CCAR' })
      const loc = await makeLocation({ operatorId: op.id, name })
      await makeVehicle({ operatorId: op.id, classId: klass.id, pickupLocationId: loc.id })
      stores.push(loc.id)
    }

    const page1 = await ok(await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, limit: 2 }))
    expect(page1.storefronts.map((s) => s.operatorName)).toEqual(['A Rentals', 'B Rentals'])
    const cursor = page1.nextCursor
    if (cursor === null) throw new Error('expected a nextCursor for page 1')

    const page2 = await ok(
      await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, limit: 2, cursor }),
    )
    expect(page2.storefronts.map((s) => s.operatorName)).toEqual(['C Rentals'])
    expect(page2.nextCursor).toBeNull()
  })

  it('rejects a malformed cursor with a 400 instead of throwing (public-input guard)', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    await makeVehicle({ operatorId: op.id, classId: compact.id, pickupLocationId: namba.id })

    // '%%%' is not valid base64 -> atob() throws; the service must not let that
    // surface as a 500 on a public endpoint.
    const result = await service.search(PUBLIC_CONTEXT, { from: FROM, to: TO, cursor: '%%%' })

    if (result.ok) throw new Error('expected a failure result for a malformed cursor')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/cursor/i)
  })
})
