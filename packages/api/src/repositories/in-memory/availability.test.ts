import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../middleware/auth'
import type { Vehicle } from '../../stores'
import { InMemoryAvailabilityRepository } from './availability'
import { InMemoryBookingRepository } from './booking'
import { InMemoryVehicleRepository } from './vehicle'

const FROM = new Date('2026-08-01T10:00:00Z')
const TO = new Date('2026-08-01T14:00:00Z')

let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let availabilityRepo: InMemoryAvailabilityRepository

beforeEach(() => {
  vehicleRepo = new InMemoryVehicleRepository()
  bookingRepo = new InMemoryBookingRepository()
  availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
})

function makeVehicle(
  overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<Vehicle> {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: 'op_a',
    classId: 'class_compact',
    pickupLocationId: 'loc_osaka',
    name: 'Test Car',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    ...overrides,
  })
}

describe('InMemoryAvailabilityRepository.findAvailableVehicles — storefront filters (#391)', () => {
  it('with { locationId } returns only vehicles at that storefront', async () => {
    const osaka = await makeVehicle({ pickupLocationId: 'loc_osaka' })
    await makeVehicle({ pickupLocationId: 'loc_kyoto' })
    await makeVehicle({ pickupLocationId: null })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, {
      locationId: 'loc_osaka',
    })

    expect(result.map((v) => v.id)).toEqual([osaka.id])
  })

  it('with { classId } narrows to that ACRISS class within the location', async () => {
    const compact = await makeVehicle({ classId: 'class_compact', pickupLocationId: 'loc_osaka' })
    await makeVehicle({ classId: 'class_van', pickupLocationId: 'loc_osaka' })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, {
      locationId: 'loc_osaka',
      classId: 'class_compact',
    })

    expect(result.map((v) => v.id)).toEqual([compact.id])
  })

  it('with { operatorId } returns only that operator’s vehicles', async () => {
    const opA = await makeVehicle({ operatorId: 'op_a', pickupLocationId: 'loc_osaka' })
    await makeVehicle({ operatorId: 'op_b', pickupLocationId: 'loc_kyoto' })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, { operatorId: 'op_a' })

    expect(result.map((v) => v.id)).toEqual([opA.id])
  })

  it('with no filter returns every available vehicle (backward compatible)', async () => {
    await makeVehicle({ pickupLocationId: 'loc_osaka' })
    await makeVehicle({ pickupLocationId: 'loc_kyoto' })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO)

    expect(result).toHaveLength(2)
  })

  it('composes the location filter with overlap exclusion', async () => {
    const booked = await makeVehicle({ pickupLocationId: 'loc_osaka' })
    const free = await makeVehicle({ pickupLocationId: 'loc_osaka' })
    await bookingRepo.create(SYSTEM_CONTEXT, {
      operatorId: 'op_a',
      renterId: 'u1',
      classId: 'class_compact',
      requestedVehicleId: booked.id,
      assignedVehicleId: booked.id,
      pickupLocationId: 'loc_osaka',
      dropoffLocationId: 'loc_osaka',
      startAt: new Date('2026-08-01T09:00:00Z'),
      endAt: new Date('2026-08-01T12:00:00Z'),
      effectiveEndAt: new Date('2026-08-01T13:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      bookingCode: `bk-${booked.id}`,
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

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, {
      locationId: 'loc_osaka',
    })

    expect(result.map((v) => v.id)).toEqual([free.id])
  })
})
