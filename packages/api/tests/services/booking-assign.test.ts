// T1+T2 (#464): assignVehicle service — assign a concrete car to a CLASS_COMBO float
// (null -> car). Uses InMemory repos so no DATABASE_URL is needed.
// T2 adds mutation-resistant guard tests for every rejection branch.

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

describe('BookingService.assignVehicle — guard branches (T2)', () => {
  // Guard 1: booking is a SPECIFIC (not CLASS_COMBO) → NOT_A_COMBO
  it('rejects a SPECIFIC booking with 409 NOT_A_COMBO', async () => {
    const { service, car, bookingRepo, vehicleClassRepo, operatorCtx } = await setupFull()
    const vehicleClass = (await vehicleClassRepo.findAll(SYSTEM_CONTEXT, {})).at(0)!
    const specific = await bookingRepo.create(
      SYSTEM_CONTEXT,
      specificBookingFields(vehicleClass.id, car.id),
    )
    const res = await service.assignVehicle(operatorCtx, specific.id, car.id, null)
    expect(res).toMatchObject({ ok: false, status: 409, code: 'NOT_A_COMBO' })
  })

  // Guard 2a: CANCELLED float → INVALID_STATUS
  it('rejects a CANCELLED float with 409 INVALID_STATUS', async () => {
    const { service, float, car, bookingRepo, operatorCtx } = await setupFull()
    await bookingRepo.cancel(SYSTEM_CONTEXT, float.id, {
      from: 'CONFIRMED',
      fee: 0,
      cancelledAt: new Date(),
      settlement: 'ADVISORY',
    })
    const res = await service.assignVehicle(operatorCtx, float.id, car.id, null)
    expect(res).toMatchObject({ ok: false, status: 409, code: 'INVALID_STATUS' })
  })

  // Guard 2b: COMPLETED float → INVALID_STATUS
  it('rejects a COMPLETED float with 409 INVALID_STATUS', async () => {
    const { service, float, car, bookingRepo, operatorCtx } = await setupFull()
    // Advance CONFIRMED → ACTIVE → COMPLETED via updateStatus
    await bookingRepo.updateStatus(SYSTEM_CONTEXT, float.id, { from: 'CONFIRMED', to: 'ACTIVE' })
    await bookingRepo.updateStatus(SYSTEM_CONTEXT, float.id, { from: 'ACTIVE', to: 'COMPLETED' })
    const res = await service.assignVehicle(operatorCtx, float.id, car.id, null)
    expect(res).toMatchObject({ ok: false, status: 409, code: 'INVALID_STATUS' })
  })

  // Guard 3: unknown vehicleId → 404, generic error, no code
  it('returns 404 with generic "Vehicle not found" for an unknown vehicleId', async () => {
    const { service, float, operatorCtx } = await setupFull()
    const res = await service.assignVehicle(operatorCtx, float.id, 'no-such-vehicle', null)
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Vehicle not found' })
    expect((res as { code?: unknown }).code).toBeUndefined()
  })

  // Guard 4: vehicle owned by a DIFFERENT operator → SAME 404 as unknown (IDOR guard)
  it('returns the SAME 404 for a foreign-operator vehicle as for an unknown vehicle (no existence leak)', async () => {
    const { service, float, vehicleRepo, vehicleClassRepo, operatorCtx } = await setupFull()
    // Create a vehicle class + vehicle for a different operator.
    const foreignClass = await vehicleClassRepo.create({
      operatorId: 'op-other',
      name: 'Foreign Compact',
      slug: 'foreign-compact',
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      luggageSize: 'SMALL',
      transmission: 'AUTO',
      fuelType: null,
      acrissCode: CLASS_ACRISS,
      sortOrder: 2,
      status: 'ACTIVE',
    })
    const foreignCar = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: 'op-other',
      classId: foreignClass.id,
      pickupLocationId: LOC_ID,
      name: 'Foreign Car',
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
    const unknownRes = await service.assignVehicle(operatorCtx, float.id, 'no-such-vehicle', null)
    const foreignRes = await service.assignVehicle(operatorCtx, float.id, foreignCar.id, null)
    // Both must be indistinguishable: same status AND same error message.
    expect(foreignRes.ok).toBe(false)
    expect(unknownRes.ok).toBe(false)
    if (foreignRes.ok || unknownRes.ok) throw new Error('expected both to fail')
    expect(foreignRes.status).toBe(unknownRes.status)
    expect(foreignRes.error).toBe(unknownRes.error)
  })

  // Guard 5: own vehicle but status !== 'AVAILABLE' → 400
  it('rejects a MAINTENANCE vehicle with 400', async () => {
    const { service, float, vehicleRepo, vehicleClassRepo, operatorCtx } = await setupFull()
    const vehicleClass = (await vehicleClassRepo.findAll(SYSTEM_CONTEXT, {})).find(
      (vc) => vc.operatorId === OP_A,
    )!
    const maintenanceCar = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: OP_A,
      classId: vehicleClass.id,
      pickupLocationId: LOC_ID,
      name: 'Maintenance Car',
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: null,
      status: 'MAINTENANCE',
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
    const res = await service.assignVehicle(operatorCtx, float.id, maintenanceCar.id, null)
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  // Guard 6: own vehicle at a DIFFERENT pickup location → 400
  it('rejects an own vehicle at a different pickup location with 400', async () => {
    const { service, float, vehicleRepo, vehicleClassRepo, operatorCtx } = await setupFull()
    const vehicleClass = (await vehicleClassRepo.findAll(SYSTEM_CONTEXT, {})).find(
      (vc) => vc.operatorId === OP_A,
    )!
    const wrongLocCar = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: OP_A,
      classId: vehicleClass.id,
      pickupLocationId: 'loc-different',
      name: 'Wrong Location Car',
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
    const res = await service.assignVehicle(operatorCtx, float.id, wrongLocCar.id, null)
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  // Guard 7: own vehicle of a DIFFERENT ACRISS class → 400
  it('rejects an own vehicle of a different ACRISS class with 400', async () => {
    const { service, float, vehicleRepo, vehicleClassRepo, operatorCtx } = await setupFull()
    const differentClass = await vehicleClassRepo.create({
      operatorId: OP_A,
      name: 'Premium',
      slug: 'premium-assign',
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 3,
      luggageSize: 'LARGE',
      transmission: 'AUTO',
      fuelType: null,
      acrissCode: 'PDAR', // different from CLASS_ACRISS='CDAR'
      sortOrder: 3,
      status: 'ACTIVE',
    })
    const wrongClassCar = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: OP_A,
      classId: differentClass.id,
      pickupLocationId: LOC_ID,
      name: 'Wrong Class Car',
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
    const res = await service.assignVehicle(operatorCtx, float.id, wrongClassCar.id, null)
    expect(res).toMatchObject({ ok: false, status: 400 })
  })

  // Guard 8: own vehicle whose shaken expires BEFORE booking's endAt → 400 VEHICLE_DOCS_EXPIRE_BEFORE_RETURN
  it('rejects a car with expired shaken before endAt with 400 VEHICLE_DOCS_EXPIRE_BEFORE_RETURN', async () => {
    const { service, float, vehicleRepo, vehicleClassRepo, operatorCtx } = await setupFull()
    const vehicleClass = (await vehicleClassRepo.findAll(SYSTEM_CONTEXT, {})).find(
      (vc) => vc.operatorId === OP_A,
    )!
    // shakenExpiryDate is before END (2027-06-03) — expires mid-booking
    const expiredDocsCar = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: OP_A,
      classId: vehicleClass.id,
      pickupLocationId: LOC_ID,
      name: 'Expired Shaken Car',
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
      shakenExpiryDate: '2027-06-01', // expires BEFORE END 2027-06-03
      insuranceExpiryDate: '2099-12-31',
    })
    const res = await service.assignVehicle(operatorCtx, float.id, expiredDocsCar.id, null)
    expect(res).toMatchObject({ ok: false, status: 400, code: 'VEHICLE_DOCS_EXPIRE_BEFORE_RETURN' })
  })
})

// ---- helpers for guard tests ----

// Returns all mutable repos (not just service) for fixture injection.
async function setupFull() {
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
    slug: 'compact-assign-g',
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
    bookingCode: 'ASSIGN02',
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
    undefined,
    undefined,
    bookingEventRepo,
  )

  const operatorCtx: CallerContext = {
    userId: OPERATOR_USER_ID,
    role: 'OPERATOR_OWNER',
    operatorId: OP_A,
    bypassScope: false,
  }

  return {
    service,
    float,
    car,
    bookingRepo,
    vehicleRepo,
    vehicleClassRepo,
    bookingEventRepo,
    operatorCtx,
  }
}

// Fields for a SPECIFIC booking (requestedVehicleId is the car, fulfillmentMode='SPECIFIC').
function specificBookingFields(classId: string, vehicleId: string) {
  return {
    operatorId: OP_A,
    renterId: RENTER_ID,
    classId,
    requestedVehicleId: vehicleId,
    assignedVehicleId: vehicleId,
    pickupLocationId: LOC_ID,
    dropoffLocationId: LOC_ID,
    startAt: START,
    endAt: END,
    effectiveEndAt: EFFECTIVE_END,
    status: 'CONFIRMED' as const,
    source: 'DIRECT' as const,
    fulfillmentMode: 'SPECIFIC' as const,
    bookingCode: 'SPECIFIC01',
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
  }
}
