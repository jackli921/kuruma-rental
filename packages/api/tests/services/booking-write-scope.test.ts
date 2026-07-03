// #1260 slice 2: bind operator-portal booking writes to the picked operator.
// A PLATFORM_ADMIN reads every operator's bookings (bookingReadScope -> all), so
// findById hands it any booking by raw id; without an acting-operator binding it
// could mutate a booking it only ever had a client-side "read-only preview" over.
// These tests drive the guard through the BookingService facade (the reachable
// path) plus the pure guard/mapper primitives.
//
// NOTE on scope vocabulary: legacy STAFF/ADMIN map to RENTER scope under
// bookingReadScope (unlike operatorReadScope, where they are `all`). So a legacy
// STAFF cannot even READ a foreign booking — findById 404s before the guard runs.
// The role-vs-bypass keying that matters for that pair is therefore locked at the
// PURE guard level here; the service-level threat for bookings is PLATFORM_ADMIN.

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
  InMemoryOperatorRepository,
  InMemoryUserRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryBookingEventRepository } from '../../src/repositories/in-memory/booking-event'
import type { RunInTransaction, TransactionRepos } from '../../src/repositories/types'
import { BookingService } from '../../src/services/booking'
import type { Booking, Operator } from '../../src/stores'
import {
  assertBookingWriteWithinOperator,
  assertFleetWriteWithinOperator,
  fleetWriteDenialResult,
} from '../../src/tenancy'

const OP_A = 'op-write-scope-a'
const RENTER_ID = 'renter-write-scope-1'
const LOC_ID = 'loc-write-scope-1'
const START = new Date('2027-07-01T09:00:00Z')
const END = new Date('2027-07-03T09:00:00Z')
const EFFECTIVE_END = new Date('2027-07-05T09:00:00Z')

const adminCtx: CallerContext = { userId: 'admin-1', role: 'PLATFORM_ADMIN', bypassScope: true }
const operatorCtxA: CallerContext = {
  userId: 'op-user-1',
  role: 'OPERATOR_OWNER',
  operatorId: OP_A,
  bypassScope: false,
}

// ---- pure primitives (reachable regardless of a read scope) ----

describe('assertFleetWriteWithinOperator — role keying (#1260)', () => {
  // THE mutation-resistance anchor: keyed on !isOperatorRole, NOT bypassScope.
  // #487 dropped legacy STAFF/ADMIN from SCOPE_BYPASS_ROLES, so a bypass-keyed
  // guard would return null (allow) for a bypassScope=false STAFF and leave it
  // able to write cross-tenant on any route that reads them as `all`.
  it('denies a legacy STAFF (bypassScope=false) that named no operator', () => {
    const legacyStaffCtx: CallerContext = { userId: 's', role: 'STAFF', bypassScope: false }
    expect(assertFleetWriteWithinOperator(legacyStaffCtx, OP_A, undefined)).toEqual({
      kind: 'operator-required',
    })
  })

  it('is a no-op for a tenant operator even with a stray acting id', () => {
    expect(assertFleetWriteWithinOperator(operatorCtxA, 'op-else', 'op-else-2')).toBeNull()
  })
})

// The booking guard keys on the RESOLVED read scope (bookingReadScope === 'all'),
// NOT !isOperatorRole. Bookings are private: only the bypass tier reads `all`, so
// only it can reach a foreign booking by raw id. The difference matters because
// /cancel (unlike /status) has no route gate and admits renters + legacy STAFF —
// both renter-scoped for bookings — who must never be forced to name an operator.
describe('assertBookingWriteWithinOperator — bypass keying (#1260)', () => {
  it('denies the bypass admin (all scope) that named no operator', () => {
    expect(assertBookingWriteWithinOperator(adminCtx, OP_A, undefined)).toEqual({
      kind: 'operator-required',
    })
  })

  it('denies the bypass admin acting as a non-owning operator', () => {
    expect(assertBookingWriteWithinOperator(adminCtx, OP_A, 'op-else')).toEqual({
      kind: 'not-in-scope',
    })
  })

  it('allows the bypass admin acting as the owning operator', () => {
    expect(assertBookingWriteWithinOperator(adminCtx, OP_A, OP_A)).toBeNull()
  })

  it('is a no-op for a renter self-cancelling (renter scope, not all)', () => {
    const renterCtx: CallerContext = { userId: RENTER_ID, role: 'RENTER', bypassScope: false }
    expect(assertBookingWriteWithinOperator(renterCtx, OP_A, undefined)).toBeNull()
  })

  it('is a no-op for a legacy STAFF (renter-scoped for bookings, unlike fleet)', () => {
    const legacyStaffCtx: CallerContext = { userId: 's', role: 'STAFF', bypassScope: false }
    expect(assertBookingWriteWithinOperator(legacyStaffCtx, OP_A, undefined)).toBeNull()
  })

  it('is a no-op for a tenant operator even with a stray acting id', () => {
    expect(assertBookingWriteWithinOperator(operatorCtxA, 'op-else', 'op-else-2')).toBeNull()
  })
})

describe('fleetWriteDenialResult — denial -> service result (#1260)', () => {
  it('maps operator-required to 422 carrying OPERATOR_REQUIRED', () => {
    expect(fleetWriteDenialResult({ kind: 'operator-required' }, 'Booking not found')).toEqual({
      ok: false,
      status: 422,
      error: 'operatorId is required: specify the operator to act as',
      code: 'OPERATOR_REQUIRED',
    })
  })

  it('maps not-in-scope to 404 with the caller-supplied not-found message (no oracle)', () => {
    expect(fleetWriteDenialResult({ kind: 'not-in-scope' }, 'Booking not found')).toEqual({
      ok: false,
      status: 404,
      error: 'Booking not found',
    })
  })
})

// ---- updateStatus through the facade (PLATFORM_ADMIN is the reachable threat) ----

describe('BookingService.updateStatus — operator write scope (#1260)', () => {
  it('rejects an admin who named no acting operator with 422 OPERATOR_REQUIRED', async () => {
    const { service, booking } = await setup()
    const res = await service.updateStatus(adminCtx, booking.id, 'ACTIVE')
    expect(res).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_REQUIRED' })
  })

  it('rejects an admin acting as the WRONG operator with 404 (no existence oracle)', async () => {
    const { service, booking } = await setup()
    const res = await service.updateStatus(adminCtx, booking.id, 'ACTIVE', 'op-not-owner')
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Booking not found' })
  })

  it('lets an admin acting as the OWNING operator perform the transition', async () => {
    const { service, booking } = await setup()
    const res = await service.updateStatus(adminCtx, booking.id, 'ACTIVE', OP_A)
    expect(res).toMatchObject({ ok: true })
    if (!res.ok) throw new Error('expected ok')
    expect(res.booking.status).toBe('ACTIVE')
  })

  it('ignores a stray actingOperatorId for a tenant operator (already clamped by read scope)', async () => {
    const { service, booking } = await setup()
    const res = await service.updateStatus(operatorCtxA, booking.id, 'ACTIVE', 'op-else')
    expect(res).toMatchObject({ ok: true })
  })
})

// cancel is the SIBLING lifecycle write. Unlike updateStatus it has no route gate
// and serves renters (self-cancel), so the guard must clear renters while still
// binding the bypass admin — the crux the booking guard's scope keying delivers.
const CANCEL_NOW = new Date('2027-06-01T00:00:00Z') // 30 days before START -> free tier

describe('BookingService.cancel — operator write scope (#1260)', () => {
  it('rejects a bypass admin who named no acting operator with 422 OPERATOR_REQUIRED', async () => {
    const { service, booking } = await setup()
    const res = await service.cancel(adminCtx, booking.id, null, CANCEL_NOW)
    expect(res).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_REQUIRED' })
  })

  it('rejects a bypass admin acting as the WRONG operator with 404 (no existence oracle)', async () => {
    const { service, booking } = await setup()
    const res = await service.cancel(adminCtx, booking.id, null, CANCEL_NOW, 'op-not-owner')
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Booking not found' })
  })

  it('lets a bypass admin acting as the OWNING operator cancel', async () => {
    const { service, booking } = await setup()
    const res = await service.cancel(adminCtx, booking.id, null, CANCEL_NOW, OP_A)
    expect(res).toMatchObject({ ok: true })
    if (!res.ok) throw new Error('expected ok')
    expect(res.booking.status).toBe('CANCELLED')
  })

  it('still lets a renter self-cancel their own booking without naming an operator', async () => {
    const { service, booking } = await setup()
    const renterCtx: CallerContext = { userId: RENTER_ID, role: 'RENTER', bypassScope: false }
    const res = await service.cancel(renterCtx, booking.id, null, CANCEL_NOW)
    expect(res).toMatchObject({ ok: true })
    if (!res.ok) throw new Error('expected ok')
    expect(res.booking.status).toBe('CANCELLED')
  })
})

// #1417 end-to-end repro: a tenant operator (A) manual-books a car owned by operator B.
// submitInTx/submitComboInTx now read the ANCHOR vehicle/pickup with the CALLER's own ctx,
// so operatorReadScope clamps A to its own fleet -- B's PUBLIC storefront car resolves to
// undefined for A and never enters the create path. Walk-in so no renter seeding is needed.
const OP_B = 'op-write-scope-b'

// #1417 end-to-end (both create paths), Option B (structural). The foreign row is now
// UNREACHABLE at the repo read, so create returns the very same not-found ('Vehicle not
// found' / 'Pickup location is not available') a truly-unknown id yields -- no distinguishable
// 403 to confirm existence, and no vehicle-state gate ever runs to leak B's status/class/
// shaken-expiry. Mutation check: reverting the anchor read to SYSTEM_CONTEXT makes B's car
// reachable to A again, so create no longer returns the not-found -- these tests fail.
describe('BookingCreationService.create — operator inventory clamp (#1417)', () => {
  const now = new Date('2027-07-15T00:00:00Z')
  const startAt = new Date('2027-08-01T09:00:00Z')
  const endAt = new Date('2027-08-03T09:00:00Z')

  it('refuses a SPECIFIC booking of a FOREIGN operator vehicle as an unfound vehicle (no oracle)', async () => {
    const { service, bookingRepo, bVehicleId, bLocationId } = await createHarness()

    const res = await service.create(
      operatorCtxA,
      {
        fulfillmentMode: 'SPECIFIC',
        requestedVehicleId: bVehicleId,
        pickupLocationId: bLocationId,
        dropoffLocationId: bLocationId,
        addOnIds: [],
        source: 'MANUAL',
        walkInCustomer: { name: 'Walk In', phone: '+819012345678' },
        startAt,
        endAt,
      },
      now,
    )

    // The ctx-scoped read makes B's car unreachable to A -> the same not-found a
    // truly-unknown id yields, NOT a distinguishable 403 existence oracle.
    expect(res).toMatchObject({ ok: false, status: 400, error: 'Vehicle not found' })
    const all = await bookingRepo.findAll(SYSTEM_CONTEXT)
    expect(all.filter((b) => b.operatorId === OP_B)).toEqual([])
  })

  it('refuses a CLASS_COMBO booking at a FOREIGN operator pickup as an unfound pickup', async () => {
    const { service, bookingRepo, bLocationId } = await createHarness()

    // submitComboInTx binds on pickup.operatorId (= B), so the foreign pickup is refused
    // before the class/capacity gates -- the combo twin of the SPECIFIC path.
    const res = await service.create(
      operatorCtxA,
      {
        fulfillmentMode: 'CLASS_COMBO',
        classId: 'b-class-1',
        pickupLocationId: bLocationId,
        dropoffLocationId: bLocationId,
        addOnIds: [],
        source: 'MANUAL',
        walkInCustomer: { name: 'Walk In', phone: '+819012345678' },
        startAt,
        endAt,
      },
      now,
    )

    expect(res).toMatchObject({
      ok: false,
      status: 400,
      error: 'Pickup location is not available',
    })
    const all = await bookingRepo.findAll(SYSTEM_CONTEXT)
    expect(all.filter((b) => b.operatorId === OP_B)).toEqual([])
  })
})

function makeOperator(id: string): Operator {
  return {
    id,
    slug: `slug-${id}`,
    name: `Operator ${id}`,
    preAuthHandoffUrl: null,
    createdAt: new Date('2020-01-01T00:00:00Z'),
    updatedAt: new Date('2020-01-01T00:00:00Z'),
    deactivatedAt: null,
  }
}

async function createHarness() {
  const bookingRepo = new InMemoryBookingRepository()
  const bookingEventRepo = new InMemoryBookingEventRepository()
  const vehicleRepo = new InMemoryVehicleRepository()
  const vehicleClassRepo = new InMemoryVehicleClassRepository()
  const locationRepo = new InMemoryLocationRepository()
  const userRepo = new InMemoryUserRepository()
  // repos.operatorRepo is REQUIRED (rejectIfOperatorDeactivated reads it). Seed BOTH
  // tenants active so that with the #1417 bind removed the create runs all the way to the
  // booking insert, where the repo's own #329 tenant guard throws -- proving the bind is a
  // real, reachable gate in front of that backstop, not dead code.
  const operatorRepo = new InMemoryOperatorRepository(
    new Map<string, Operator>([
      [OP_A, makeOperator(OP_A)],
      [OP_B, makeOperator(OP_B)],
    ]),
  )
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
    operatorRepo,
  )

  // Operator B's PUBLIC storefront location + a fully bookable car parked at it (class
  // set, AVAILABLE, docs valid, pickup matches) so EVERY pre-bind gate in submitInTx
  // passes and the write would otherwise land under B.
  const bLocation = await locationRepo.create({
    operatorId: OP_B,
    name: 'B Depot',
    address: '9-9-9 Foreign',
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE',
  } as Parameters<typeof locationRepo.create>[0])
  const bVehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: OP_B,
    classId: 'b-class-1',
    pickupLocationId: bLocation.id,
    name: 'B Car',
    description: null,
    seats: 4,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: 8000,
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
  })

  const repos: TransactionRepos = {
    vehicleRepo,
    maintenanceLogRepo: new InMemoryMaintenanceLogRepository(),
    bookingRepo,
    bookingEventRepo,
    locationRepo,
    operatorRepo,
    insuranceOptionRepo: new InMemoryInsuranceOptionRepository(),
    addOnRepo: new InMemoryAddOnRepository(),
    feeScheduleRepo: new InMemoryFeeScheduleRepository(),
    userRepo,
    availabilityRepo,
    classRatePlanRepo: new InMemoryClassRatePlanRepository(),
    vehicleClassRepo,
    vehicleBlockRepo: new InMemoryVehicleBlockRepository(),
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

  return { service, bookingRepo, bVehicleId: bVehicle.id, bLocationId: bLocation.id }
}

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
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
    new InMemoryOperatorRepository(),
  )
  const classRatePlanRepo = new InMemoryClassRatePlanRepository()
  const vehicleBlockRepo = new InMemoryVehicleBlockRepository()

  const booking = await bookingRepo.create(SYSTEM_CONTEXT, {
    operatorId: OP_A,
    renterId: RENTER_ID,
    classId: 'class-write-scope',
    requestedVehicleId: 'veh-write-scope',
    assignedVehicleId: 'veh-write-scope',
    pickupLocationId: LOC_ID,
    dropoffLocationId: LOC_ID,
    startAt: START,
    endAt: END,
    effectiveEndAt: EFFECTIVE_END,
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: 'WSCOPE01',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 40000,
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
    vehicleBlockRepo,
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

  return { service, booking }
}
