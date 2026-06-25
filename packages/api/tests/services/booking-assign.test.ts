// T1 (#464): assignVehicle service — assign a concrete car to a CLASS_COMBO float
// (null -> car). Uses InMemory repos so no DATABASE_URL is needed.
// Guard tests (invalid status, wrong operator, sold-out, etc.) live in later tasks.

import { describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAddOnRepository,
  InMemoryAvailabilityRepository,
  InMemoryClassRatePlanRepository,
  InMemoryFeeScheduleRepository,
  InMemoryInsuranceOptionRepository,
  InMemoryLocationRepository,
  InMemoryMaintenanceLogRepository,
  InMemoryUserRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryBookingEventRepository } from '../../src/repositories/in-memory/booking-event'
import type { RunInTransaction, TransactionRepos } from '../../src/repositories/types'
import { BookingService } from '../../src/services/booking'
import type { Booking } from '../../src/stores'

const OP_A = 'op-assign-a'
const RENTER_ID = 'renter-assign-1'
const OPERATOR_USER_ID = 'op-user-assign-1'
const LOC_ID = 'loc-assign-1'
const CLASS_ACRISS = 'CDAR'

// A far-future window — no chance of overlapping with seeded demo bookings.
const START = new Date('2027-06-01T09:00:00Z')
const END = new Date('2027-06-03T09:00:00Z')
// Generous turnaround: doesn't affect the assign path (endAt used for road-legal check).
const EFFECTIVE_END = new Date('2027-06-05T09:00:00Z')
const TOTAL_PRICE = 48000 // fixed by the class rate plan — must survive unchanged

async function setup() {
  const bookingStore = new Map<string, Booking>()
  const bookingRepo = new InMemoryBookingRepository(bookingStore)
  const bookingEventRepo = new InMemoryBookingEventRepository()
  const vehicleRepo = new InMemoryVehicleRepository()
  const vehicleClassRepo = new InMemoryVehicleClassRepository()
  const locationRepo = new InMemoryLocationRepository()
  const insuranceOptionRepo = new InMemoryInsuranceOptionRepository()
  const addOnRepo = new InMemoryAddOnRepository()
  const feeScheduleRepo = new InMemoryFeeScheduleRepository()
  const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
  const userRepo = new InMemoryUserRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  const classRatePlanRepo = new InMemoryClassRatePlanRepository()

  // Seed a vehicle class with a non-null ACRISS code.
  const vehicleClass = await vehicleClassRepo.create({
    operatorId: OP_A,
    name: 'Compact',
    slug: 'compact-assign',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'SMALL',
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: CLASS_ACRISS,
    sortOrder: 1,
    status: 'ACTIVE',
  })

  // Seed an AVAILABLE vehicle in the same operator/class/location, road-legal past END.
  const car = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: OP_A,
    classId: vehicleClass.id,
    pickupLocationId: LOC_ID,
    name: 'Assign Car',
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
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: '2099-12-31',
    insuranceExpiryDate: '2099-12-31',
  })

  // Seed a CLASS_COMBO float (unassigned — operator will assign a car).
  const float = await bookingRepo.create(SYSTEM_CONTEXT, {
    operatorId: OP_A,
    renterId: RENTER_ID,
    classId: vehicleClass.id,
    requestedVehicleId: null,
    assignedVehicleId: null,
    pickupLocationId: LOC_ID,
    dropoffLocationId: LOC_ID,
    startAt: START,
    endAt: END,
    effectiveEndAt: EFFECTIVE_END,
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'CLASS_COMBO',
    bookingCode: 'ASSIGN01',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: TOTAL_PRICE,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
  })

  const repos: TransactionRepos = {
    vehicleRepo,
    maintenanceLogRepo,
    bookingRepo,
    bookingEventRepo,
    locationRepo,
    insuranceOptionRepo,
    addOnRepo,
    feeScheduleRepo,
    userRepo,
    availabilityRepo,
    classRatePlanRepo,
    vehicleClassRepo,
  }
  // Pass-through: InMemory repos are single-threaded singletons (mirrors booking.test.ts).
  const runInTransactionFn: RunInTransaction = (fn) => fn(repos)

  const service = new BookingService(
    bookingRepo,
    runInTransactionFn,
    vehicleRepo,
    userRepo,
    vehicleClassRepo,
    undefined, // postCommit
    undefined, // operatorRepo
    bookingEventRepo,
  )

  const operatorCtx: CallerContext = {
    userId: OPERATOR_USER_ID,
    role: 'OPERATOR_OWNER',
    operatorId: OP_A,
    bypassScope: false,
  }

  return { service, float, car, bookingEventRepo, operatorCtx }
}

describe('BookingService.assignVehicle — CLASS_COMBO float (null -> car)', () => {
  it('assigns a car to a float: sets assignedVehicleId, leaves price, logs VEHICLE_ASSIGNED', async () => {
    const { service, float, car, bookingEventRepo, operatorCtx } = await setup()

    const res = await service.assignVehicle(operatorCtx, float.id, car.id, null)
    expect(res).toMatchObject({ ok: true })
    if (!res.ok) throw new Error('expected ok')
    expect(res.booking.assignedVehicleId).toBe(car.id)
    expect(res.booking.totalPrice).toBe(float.totalPrice) // UNCHANGED — class-deal price
    const events = await bookingEventRepo.findByBookingId(SYSTEM_CONTEXT, float.id)
    expect(events.at(-1)).toMatchObject({
      type: 'VEHICLE_ASSIGNED',
      payload: { type: 'VEHICLE_ASSIGNED', fromVehicleId: null, toVehicleId: car.id, reason: null },
    })
  })
})
