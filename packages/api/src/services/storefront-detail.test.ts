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
import { StorefrontDetailService } from './storefront-detail'

const FROM = new Date('2026-08-01T10:00:00Z')
const TO = new Date('2026-08-01T14:00:00Z')

let operatorRepo: InMemoryOperatorRepository
let locationRepo: InMemoryLocationRepository
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let classRepo: InMemoryVehicleClassRepository
let service: StorefrontDetailService

beforeEach(() => {
  operatorRepo = new InMemoryOperatorRepository()
  locationRepo = new InMemoryLocationRepository()
  vehicleRepo = new InMemoryVehicleRepository()
  bookingRepo = new InMemoryBookingRepository()
  classRepo = new InMemoryVehicleClassRepository()
  const storefrontRepo = new InMemoryStorefrontRepository(locationRepo, operatorRepo)
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  service = new StorefrontDetailService(storefrontRepo, availabilityRepo, classRepo)
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
    photos: ['https://cdn/yaris.jpg'],
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'OSAKA 300 あ 12-34',
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: 'Toyota',
    model: 'Yaris',
    year: 2023,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: 800,
    shakenExpiryDate: '2027-03-31',
    insuranceExpiryDate: '2027-03-31',
    ...overrides,
  })
}

function bookOverlapping(vehicleId: string, classId: string) {
  return bookingRepo.create(SYSTEM_CONTEXT, {
    renterId: 'u1',
    classId,
    vehicleId,
    startAt: new Date('2026-08-01T09:00:00Z'),
    endAt: new Date('2026-08-01T12:00:00Z'),
    effectiveEndAt: new Date('2026-08-01T13:00:00Z'),
    status: 'CONFIRMED',
    source: 'DIRECT',
    externalId: null,
    notes: null,
    totalPrice: null,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
  })
}

async function okData(result: Awaited<ReturnType<StorefrontDetailService['getDetail']>>) {
  if (!result.ok) throw new Error(`expected ok, got ${result.status} ${result.error}`)
  return result.data
}

describe('StorefrontDetailService.getDetail (#391)', () => {
  it('returns 404 for an unknown locationId', async () => {
    const result = await service.getDetail(PUBLIC_CONTEXT, {
      locationId: 'loc_missing',
      from: FROM,
      to: TO,
    })

    expect(result).toEqual({ ok: false, error: expect.any(String), status: 404 })
  })

  it('returns 404 for an ARCHIVED location (a closed store is not browsable)', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const closed = await makeLocation({ operatorId: op.id, name: 'Closed', status: 'ARCHIVED' })

    const result = await service.getDetail(PUBLIC_CONTEXT, {
      locationId: closed.id,
      from: FROM,
      to: TO,
    })

    expect(result).toEqual({ ok: false, error: expect.any(String), status: 404 })
  })

  it('returns the storefront with an empty vehicle list (200) when the known store is full', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const only = await makeVehicle({
      operatorId: op.id,
      classId: compact.id,
      pickupLocationId: namba.id,
    })
    await bookOverlapping(only.id, compact.id)

    const data = await okData(
      await service.getDetail(PUBLIC_CONTEXT, { locationId: namba.id, from: FROM, to: TO }),
    )

    expect(data.storefront).toEqual({
      locationId: namba.id,
      name: 'Namba',
      address: '1-1 Namba, Osaka',
      operatorName: 'Best Car Rental',
      operatingHours: { openTime: '09:00', closeTime: '20:00' },
    })
    expect(data.vehicles).toEqual([])
  })

  it('lists only AVAILABLE, non-overlapping vehicles — excludes MAINTENANCE and booked', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const base = { operatorId: op.id, classId: compact.id, pickupLocationId: namba.id }
    const free = await makeVehicle(base)
    await makeVehicle({ ...base, status: 'MAINTENANCE' })
    const booked = await makeVehicle(base)
    await bookOverlapping(booked.id, compact.id)

    const data = await okData(
      await service.getDetail(PUBLIC_CONTEXT, { locationId: namba.id, from: FROM, to: TO }),
    )

    expect(data.vehicles.map((v) => v.id)).toEqual([free.id])
  })

  it('projects renter-safe fields only — no operator internals leak', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, name: 'Compact', acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    await makeVehicle({ operatorId: op.id, classId: compact.id, pickupLocationId: namba.id })

    const data = await okData(
      await service.getDetail(PUBLIC_CONTEXT, { locationId: namba.id, from: FROM, to: TO }),
    )

    const vehicle = data.vehicles[0]
    expect(vehicle).toMatchObject({
      name: 'Toyota Yaris',
      make: 'Toyota',
      acrissCode: 'CCAR',
      classLabel: 'Compact',
      dailyRateJpy: 8000,
      hourlyRateJpy: 800,
    })
    expect(vehicle).not.toHaveProperty('shakenExpiryDate')
    expect(vehicle).not.toHaveProperty('insuranceExpiryDate')
    expect(vehicle).not.toHaveProperty('bufferMinutes')
    expect(vehicle).not.toHaveProperty('licensePlate')
    expect(vehicle).not.toHaveProperty('operatorId')
  })

  it('class filter narrows the vehicle list to the requested ACRISS code', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, name: 'Compact', acrissCode: 'CCAR' })
    const van = await makeClass({ operatorId: op.id, name: 'Minivan', acrissCode: 'MVAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const yaris = await makeVehicle({
      operatorId: op.id,
      classId: compact.id,
      pickupLocationId: namba.id,
    })
    await makeVehicle({ operatorId: op.id, classId: van.id, pickupLocationId: namba.id })

    const data = await okData(
      await service.getDetail(PUBLIC_CONTEXT, {
        locationId: namba.id,
        from: FROM,
        to: TO,
        classes: ['CCAR'],
      }),
    )

    expect(data.vehicles.map((v) => v.id)).toEqual([yaris.id])
  })

  it('caps a page at the limit and resumes from the cursor without overlap', async () => {
    const op = await makeOperator('Best Car Rental', 'best')
    const compact = await makeClass({ operatorId: op.id, name: 'Compact', acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: op.id, name: 'Namba' })
    const base = { operatorId: op.id, classId: compact.id, pickupLocationId: namba.id }
    await makeVehicle({ ...base, name: 'Car A' })
    await makeVehicle({ ...base, name: 'Car B' })
    await makeVehicle({ ...base, name: 'Car C' })

    const page1 = await okData(
      await service.getDetail(PUBLIC_CONTEXT, {
        locationId: namba.id,
        from: FROM,
        to: TO,
        limit: 2,
      }),
    )
    expect(page1.vehicles.map((v) => v.name)).toEqual(['Car A', 'Car B'])
    const cursor = page1.nextCursor
    if (cursor === null) throw new Error('expected a nextCursor for page 1')

    const page2 = await okData(
      await service.getDetail(PUBLIC_CONTEXT, {
        locationId: namba.id,
        from: FROM,
        to: TO,
        limit: 2,
        cursor,
      }),
    )
    expect(page2.vehicles.map((v) => v.name)).toEqual(['Car C'])
    expect(page2.nextCursor).toBeNull()
  })
})
