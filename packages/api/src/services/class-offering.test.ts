import type { ResultLocation } from '@kuruma/shared/types/search-result'
import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../middleware/auth'
import { InMemoryAvailabilityRepository } from '../repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../repositories/in-memory/booking'
import { InMemoryClassRatePlanRepository } from '../repositories/in-memory/class-rate-plan'
import { InMemoryLocationRepository } from '../repositories/in-memory/location'
import { InMemoryOperatorRepository } from '../repositories/in-memory/operator'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import { InMemoryVehicleBlockRepository } from '../repositories/in-memory/vehicle-block'
import { InMemoryVehicleClassRepository } from '../repositories/in-memory/vehicle-class'
import type { ClassRatePlan, Location, Operator, Vehicle, VehicleClass } from '../stores'
import { ClassOfferingService } from './class-offering'

const FROM = new Date('2026-08-01T10:00:00Z')
const TO = new Date('2026-08-01T14:00:00Z')

let operatorRepo: InMemoryOperatorRepository
let locationRepo: InMemoryLocationRepository
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let classRepo: InMemoryVehicleClassRepository
let classRatePlanRepo: InMemoryClassRatePlanRepository
let service: ClassOfferingService

beforeEach(() => {
  operatorRepo = new InMemoryOperatorRepository()
  locationRepo = new InMemoryLocationRepository()
  vehicleRepo = new InMemoryVehicleRepository()
  bookingRepo = new InMemoryBookingRepository()
  classRepo = new InMemoryVehicleClassRepository()
  classRatePlanRepo = new InMemoryClassRatePlanRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
    operatorRepo,
  )
  service = new ClassOfferingService(classRatePlanRepo, availabilityRepo)
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
    luggageSize: 'MEDIUM',
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
    latitude: 34.6627,
    longitude: 135.5012,
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
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'OSAKA 300 A 12-34',
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
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
    ...overrides,
  })
}

function makeRatePlan(overrides: Partial<Omit<ClassRatePlan, 'id' | 'createdAt' | 'updatedAt'>>) {
  return classRatePlanRepo.create({
    operatorId: 'op_a',
    classId: 'class_compact',
    pickupLocationId: 'loc_namba',
    dayRateJpy: 6000,
    isActive: true,
    label: null,
    ...overrides,
  })
}

// A CONFIRMED booking of the class overlapping [FROM, TO) — consumes one unit of
// class demand at the (operator, class, location) triple.
function makeBooking(overrides: {
  operatorId: string
  classId: string
  pickupLocationId: string
}) {
  return bookingRepo.create(SYSTEM_CONTEXT, {
    renterId: 'u1',
    requestedVehicleId: null,
    assignedVehicleId: null,
    dropoffLocationId: overrides.pickupLocationId,
    startAt: new Date('2026-08-01T09:00:00Z'),
    endAt: new Date('2026-08-01T12:00:00Z'),
    effectiveEndAt: new Date('2026-08-01T13:00:00Z'),
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'CLASS_COMBO',
    bookingCode: `bk-${crypto.randomUUID().slice(0, 8)}`,
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
    ...overrides,
  })
}

function locationMap(loc: Location, operatorName: string): Map<string, ResultLocation> {
  return new Map([
    [
      loc.id,
      {
        locationId: loc.id,
        operatorId: loc.operatorId,
        operatorName,
        name: loc.name,
        address: loc.address,
        latitude: loc.latitude,
        longitude: loc.longitude,
      },
    ],
  ])
}

describe('ClassOfferingService.findOfferings (#464)', () => {
  it('prices an active rate plan as a CLASS_COMBO with availableCount = capacity − demand', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, name: 'Compact', acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id, name: 'Namba' })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeRatePlan({
      operatorId: a.id,
      classId: klass.id,
      pickupLocationId: namba.id,
      dayRateJpy: 6000,
    })

    const offerings = await service.findOfferings({
      planFilters: { locationIds: [namba.id] },
      from: FROM,
      to: TO,
      locationById: locationMap(namba, a.name),
      classById: new Map([[klass.id, klass]]),
      requested: null,
    })

    expect(offerings).toEqual([
      expect.objectContaining({
        kind: 'CLASS_COMBO',
        classId: klass.id,
        dailyRateJpy: 6000,
        hourlyRateJpy: null,
        availableCount: 2,
      }),
    ])
  })

  it('drops availableCount by each overlapping CONFIRMED booking of the class', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, name: 'Compact', acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id, name: 'Namba' })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeRatePlan({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeBooking({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })

    const offerings = await service.findOfferings({
      planFilters: { locationIds: [namba.id] },
      from: FROM,
      to: TO,
      locationById: locationMap(namba, a.name),
      classById: new Map([[klass.id, klass]]),
      requested: null,
    })

    expect(offerings).toEqual([expect.objectContaining({ availableCount: 1 })])
  })

  it('emits no offering for a sold-out class (capacity − demand <= 0)', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, name: 'Compact', acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id, name: 'Namba' })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeRatePlan({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeBooking({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })

    const offerings = await service.findOfferings({
      planFilters: { locationIds: [namba.id] },
      from: FROM,
      to: TO,
      locationById: locationMap(namba, a.name),
      classById: new Map([[klass.id, klass]]),
      requested: null,
    })

    expect(offerings).toEqual([])
  })

  it('emits no offering when the requested ACRISS set excludes the plan class', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, name: 'Compact', acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id, name: 'Namba' })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeRatePlan({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })

    // requested = only SCAR, but plan class is CCAR — should be filtered out.
    const offerings = await service.findOfferings({
      planFilters: { locationIds: [namba.id] },
      from: FROM,
      to: TO,
      locationById: locationMap(namba, a.name),
      classById: new Map([[klass.id, klass]]),
      requested: new Set(['SCAR']),
    })

    expect(offerings).toEqual([])
  })

  it('emits no offering when the plan location is absent from locationById', async () => {
    const a = await makeOperator('A Rentals', 'a')
    const klass = await makeClass({ operatorId: a.id, name: 'Compact', acrissCode: 'CCAR' })
    const namba = await makeLocation({ operatorId: a.id, name: 'Namba' })
    await makeVehicle({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })
    await makeRatePlan({ operatorId: a.id, classId: klass.id, pickupLocationId: namba.id })

    // Pass an empty locationById — the plan's location is not in scope.
    const offerings = await service.findOfferings({
      planFilters: { locationIds: [namba.id] },
      from: FROM,
      to: TO,
      locationById: new Map(),
      classById: new Map([[klass.id, klass]]),
      requested: null,
    })

    expect(offerings).toEqual([])
  })
})
