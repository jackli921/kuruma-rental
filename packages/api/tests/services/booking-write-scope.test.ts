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
import type { Booking } from '../../src/stores'
import { assertFleetWriteWithinOperator, fleetWriteDenialResult } from '../../src/tenancy'

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
