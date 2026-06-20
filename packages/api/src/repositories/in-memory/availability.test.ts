import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../middleware/auth'
import type { Booking, Vehicle } from '../../stores'
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
    // Road-legal by default (well after TO) so the storefront-filter tests below
    // exercise filtering, not the #916 compliance gate. The gate has its own
    // describe block, which overrides these per case.
    shakenExpiryDate: '2027-01-01',
    insuranceExpiryDate: '2027-01-01',
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

  it('with { locationIds } returns only vehicles at those storefronts (#651 §1c)', async () => {
    const osaka = await makeVehicle({ pickupLocationId: 'loc_osaka' })
    const kyoto = await makeVehicle({ pickupLocationId: 'loc_kyoto' })
    await makeVehicle({ pickupLocationId: 'loc_nara' })
    await makeVehicle({ pickupLocationId: null })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, {
      locationIds: ['loc_osaka', 'loc_kyoto'],
    })

    expect(result.map((v) => v.id).sort()).toEqual([osaka.id, kyoto.id].sort())
  })

  it('with { locationIds: [] } returns no vehicles (empty region matches nothing)', async () => {
    await makeVehicle({ pickupLocationId: 'loc_osaka' })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, { locationIds: [] })

    expect(result).toEqual([])
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
      fulfillmentMode: 'SPECIFIC',
      bookingCode: `bk-${booked.id}`,
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
      disclaimerAcknowledgedAt: null,
      disclaimerTermsVersion: null,
    })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO, {
      locationId: 'loc_osaka',
    })

    expect(result.map((v) => v.id)).toEqual([free.id])
  })
})

// §5.2 (#916): the road-legal gate hides a car whose shaken OR insurance is not
// valid through the requested `to` JST date — the same clock as direct/create.
// TO is 2026-08-01T14:00Z → JST 2026-08-01, so a doc dated 2026-08-01 is valid
// THROUGH `to` (boundary allowed) and 2026-07-31 is not.
describe('InMemoryAvailabilityRepository.findAvailableVehicles — compliance gate (#916)', () => {
  it('excludes a vehicle whose shaken expires before the requested return date', async () => {
    const current = await makeVehicle({})
    await makeVehicle({ shakenExpiryDate: '2026-07-31' })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO)

    expect(result.map((v) => v.id)).toEqual([current.id])
  })

  it('excludes a vehicle with no recorded insurance date (UNKNOWN)', async () => {
    const current = await makeVehicle({})
    await makeVehicle({ insuranceExpiryDate: null })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO)

    expect(result.map((v) => v.id)).toEqual([current.id])
  })

  it('includes a vehicle whose documents are valid exactly through the return date', async () => {
    const boundary = await makeVehicle({
      shakenExpiryDate: '2026-08-01',
      insuranceExpiryDate: '2026-08-01',
    })

    const result = await availabilityRepo.findAvailableVehicles(FROM, TO)

    expect(result.map((v) => v.id)).toEqual([boundary.id])
  })
})

// #464: countClassDemand backs slice 2's inventory guard. It counts every
// BLOCKING booking of a class at a location overlapping the requested window —
// SPECIFIC bookings occupying a class car AND floating CLASS_COMBO of that class
// (both carried in bookings.classId) — so demand can be compared to totalCars.
describe('InMemoryAvailabilityRepository.countClassDemand (#464)', () => {
  type NewBooking = Parameters<InMemoryBookingRepository['create']>[1]
  let seq = 0
  function makeBooking(overrides: Partial<NewBooking> = {}): Promise<Booking> {
    seq += 1
    const base: NewBooking = {
      operatorId: 'op_a',
      renterId: 'u1',
      classId: 'class_compact',
      requestedVehicleId: 'veh_1',
      assignedVehicleId: 'veh_1',
      pickupLocationId: 'loc_osaka',
      dropoffLocationId: 'loc_osaka',
      startAt: new Date('2026-08-01T09:00:00Z'),
      endAt: new Date('2026-08-01T12:00:00Z'),
      effectiveEndAt: new Date('2026-08-01T13:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      fulfillmentMode: 'SPECIFIC',
      bookingCode: `bk-${seq}`,
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
      disclaimerAcknowledgedAt: null,
      disclaimerTermsVersion: null,
    }
    return bookingRepo.create(SYSTEM_CONTEXT, { ...base, ...overrides })
  }
  const demand = () =>
    availabilityRepo.countClassDemand('op_a', 'class_compact', 'loc_osaka', FROM, TO)

  it('counts a SPECIFIC booking of the class at the location overlapping the window', async () => {
    await makeBooking()
    expect(await demand()).toBe(1)
  })

  it('counts a floating CLASS_COMBO (no assigned car) — floats consume class capacity', async () => {
    await makeBooking({
      fulfillmentMode: 'CLASS_COMBO',
      requestedVehicleId: null,
      assignedVehicleId: null,
    })
    expect(await demand()).toBe(1)
  })

  it('sums SPECIFIC occupancy and floating combos of the same class (the invariant)', async () => {
    await makeBooking()
    await makeBooking({
      fulfillmentMode: 'CLASS_COMBO',
      requestedVehicleId: null,
      assignedVehicleId: null,
    })
    expect(await demand()).toBe(2)
  })

  it('excludes a different class', async () => {
    await makeBooking({ classId: 'class_van' })
    expect(await demand()).toBe(0)
  })

  it('excludes a different pickup location (capacity is per-store)', async () => {
    await makeBooking({ pickupLocationId: 'loc_kyoto' })
    expect(await demand()).toBe(0)
  })

  it('excludes a different operator', async () => {
    await makeBooking({ operatorId: 'op_b' })
    expect(await demand()).toBe(0)
  })

  it('excludes a booking whose window does not overlap', async () => {
    await makeBooking({
      startAt: new Date('2026-08-01T15:00:00Z'),
      endAt: new Date('2026-08-01T16:00:00Z'),
      effectiveEndAt: new Date('2026-08-01T16:00:00Z'),
    })
    expect(await demand()).toBe(0)
  })

  it('counts only CONFIRMED/ACTIVE — excludes CANCELLED and COMPLETED', async () => {
    await makeBooking({ status: 'CANCELLED' })
    await makeBooking({ status: 'COMPLETED' })
    await makeBooking({ status: 'ACTIVE' })
    expect(await demand()).toBe(1)
  })
})
