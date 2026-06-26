// T3 (#464): guard substitute() against CLASS_COMBO bookings.
// CLASS_COMBO bookings must use assignVehicle, not substitute (which would
// corrupt the class-deal price by re-snapshotting off the new vehicle's rates).
// Uses InMemory repos — no DATABASE_URL needed.

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

const OP_A = 'op-subst-guard-a'
const RENTER_ID = 'renter-subst-guard-1'
const OPERATOR_USER_ID = 'op-user-subst-guard-1'
const LOC_ID = 'loc-subst-guard-1'
const CLASS_ACRISS = 'CDAR'

const START = new Date('2028-06-01T09:00:00Z')
const END = new Date('2028-06-03T09:00:00Z')
const EFFECTIVE_END = new Date('2028-06-05T09:00:00Z')
const TOTAL_PRICE = 48000 // fixed by class rate plan — must NOT be re-snapshotted

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

  const vehicleClass = await vehicleClassRepo.create({
    operatorId: OP_A,
    name: 'Compact',
    slug: 'compact-subst-guard',
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

  // A valid own AVAILABLE car — used to prove the COMBO guard fires FIRST
  // (before any vehicle existence / status validation would run).
  const car = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: OP_A,
    classId: vehicleClass.id,
    pickupLocationId: LOC_ID,
    name: 'Subst Guard Car',
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

  // A CLASS_COMBO float: no assigned car yet, price fixed by class rate plan.
  const combo = await bookingRepo.create(SYSTEM_CONTEXT, {
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
    bookingCode: 'SUBST-GUARD01',
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

  return { service, combo, car, operatorCtx }
}

describe('BookingService.substitute — CLASS_COMBO guard (T3 #464)', () => {
  it('rejects substituting a CLASS_COMBO booking (use assign instead)', async () => {
    const { service, combo, car, operatorCtx } = await setup()
    // car is a valid own/AVAILABLE vehicle — proves the COMBO guard fires BEFORE
    // any vehicle existence or validation check (no leakage of that path).
    const res = await service.substitute(operatorCtx, combo.id, car.id, null)
    expect(res).toMatchObject({ ok: false, status: 409, code: 'USE_ASSIGN_FOR_COMBO' })
  })
})
