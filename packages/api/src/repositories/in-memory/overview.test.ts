import { describe, expect, it } from 'vitest'
import type { CallerContext } from '../../middleware/auth'
import type { Booking } from '../../stores'
import { InMemoryBookingRepository } from './booking'
import { InMemoryOverviewRepository } from './overview'
import { InMemoryVehicleRepository } from './vehicle'

// 14:00 JST on 2026-07-01. Its JST day is [2026-06-30T15:00Z, 2026-07-01T15:00Z).
const NOW = new Date('2026-07-01T05:00:00.000Z')

const opA: CallerContext = { userId: 'u_a', role: 'OPERATOR_OWNER', operatorId: 'op_a' }

function bookingInput(
  overrides: Partial<Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'cancellationFeeSettlement'>>,
): Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'cancellationFeeSettlement'> {
  const start = overrides.startAt ?? new Date('2026-07-01T01:00:00Z')
  const end = overrides.endAt ?? new Date('2026-07-01T09:00:00Z')
  // Distinct vehicle per booking-code by default so co-existing seeds never trip
  // the in-memory double-booking exclusion (same vehicle, overlapping window).
  const veh = `veh-${overrides.bookingCode ?? 'BK'}`
  return {
    operatorId: 'op_a',
    renterId: 'renter-1',
    classId: 'class-1',
    requestedVehicleId: veh,
    assignedVehicleId: veh,
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: start,
    endAt: end,
    effectiveEndAt: end,
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: 'BK',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 30_000,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
    ...overrides,
  }
}

function makeRepo(names: Map<string, string> = new Map([['renter-1', 'Alice']])) {
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const overviewRepo = new InMemoryOverviewRepository(vehicleRepo, bookingRepo, names)
  return { bookingRepo, overviewRepo }
}

const codes = (rows: { bookingCode: string }[]) => rows.map((r) => r.bookingCode)

describe('InMemoryOverviewRepository — today buckets (#1102)', () => {
  it('pickups = CONFIRMED with startAt in today (JST), soonest first; excludes tomorrow and non-CONFIRMED', async () => {
    const { bookingRepo, overviewRepo } = makeRepo()
    await bookingRepo.create(opA, bookingInput({ bookingCode: 'PICK-0100', status: 'CONFIRMED', startAt: new Date('2026-07-01T01:00:00Z') }))
    // 23:30 JST on 2026-07-01 — the boundary case; still today, must be included.
    await bookingRepo.create(opA, bookingInput({ bookingCode: 'PICK-2330', status: 'CONFIRMED', startAt: new Date('2026-07-01T14:30:00Z'), endAt: new Date('2026-07-01T20:00:00Z') }))
    await bookingRepo.create(opA, bookingInput({ bookingCode: 'PICK-TMRW', status: 'CONFIRMED', startAt: new Date('2026-07-02T01:00:00Z') }))
    await bookingRepo.create(opA, bookingInput({ bookingCode: 'ACTIVE-TODAY', status: 'ACTIVE', startAt: new Date('2026-07-01T02:00:00Z'), endAt: new Date('2026-07-05T00:00:00Z') }))

    const { today } = await overviewRepo.getOperatorOverview(opA, NOW)
    expect(codes(today.pickups)).toEqual(['PICK-0100', 'PICK-2330'])
  })

  it('returns = ACTIVE due later today (endAt >= now, in today JST), soonest first', async () => {
    const { bookingRepo, overviewRepo } = makeRepo()
    await bookingRepo.create(opA, bookingInput({ bookingCode: 'RET-1800', status: 'ACTIVE', startAt: new Date('2026-06-29T00:00:00Z'), endAt: new Date('2026-07-01T09:00:00Z') }))
    await bookingRepo.create(opA, bookingInput({ bookingCode: 'RET-2000', status: 'ACTIVE', startAt: new Date('2026-06-29T00:00:00Z'), endAt: new Date('2026-07-01T11:00:00Z') }))
    // CONFIRMED due today is NOT a return (only ACTIVE cars are out on rental).
    await bookingRepo.create(opA, bookingInput({ bookingCode: 'CONF-DUE', status: 'CONFIRMED', endAt: new Date('2026-07-01T10:00:00Z') }))

    const { today } = await overviewRepo.getOperatorOverview(opA, NOW)
    expect(codes(today.returns)).toEqual(['RET-1800', 'RET-2000'])
  })

  it('overdue = ACTIVE with endAt < now (any day), most-late first; keys off endAt NOT effectiveEndAt', async () => {
    const { bookingRepo, overviewRepo } = makeRepo()
    await bookingRepo.create(opA, bookingInput({ bookingCode: 'OVERDUE-OLD', status: 'ACTIVE', startAt: new Date('2026-06-25T00:00:00Z'), endAt: new Date('2026-06-28T00:00:00Z') }))
    // Contractual endAt already past, but effectiveEndAt (turnaround tail) is in the
    // future — still overdue. This is the must-fix distinction from the review.
    await bookingRepo.create(opA, bookingInput({ bookingCode: 'OVERDUE-EFF', status: 'ACTIVE', startAt: new Date('2026-06-30T00:00:00Z'), endAt: new Date('2026-07-01T04:00:00Z'), effectiveEndAt: new Date('2026-07-03T04:00:00Z') }))

    const { today } = await overviewRepo.getOperatorOverview(opA, NOW)
    // Most-late first = smallest endAt first: OLD (06-28) before EFF (07-01T04:00).
    expect(codes(today.overdue)).toEqual(['OVERDUE-OLD', 'OVERDUE-EFF'])
    // And it is NOT double-counted as a return (returns require endAt >= now).
    expect(codes(today.returns)).toEqual([])
  })

  it('excludes CANCELLED and scopes to the caller operator', async () => {
    const { bookingRepo, overviewRepo } = makeRepo()
    await bookingRepo.create(opA, bookingInput({ bookingCode: 'CANC', status: 'CANCELLED', startAt: new Date('2026-07-01T01:00:00Z') }))
    await bookingRepo.create(
      { userId: 'u_b', role: 'OPERATOR_OWNER', operatorId: 'op_b' },
      bookingInput({ operatorId: 'op_b', bookingCode: 'PICK-OPB', status: 'CONFIRMED', startAt: new Date('2026-07-01T01:00:00Z') }),
    )
    const { today } = await overviewRepo.getOperatorOverview(opA, NOW)
    expect(today.pickups).toEqual([])
  })

  it('empty buckets when the operator has no live bookings', async () => {
    const { overviewRepo } = makeRepo()
    const { today } = await overviewRepo.getOperatorOverview(opA, NOW)
    expect(today).toEqual({ pickups: [], returns: [], overdue: [] })
  })

  it('caps each bucket at 50 rows', async () => {
    const { bookingRepo, overviewRepo } = makeRepo()
    for (let i = 0; i < 55; i++) {
      // Distinct vehicle per row so the in-memory double-booking exclusion (same
      // vehicle, overlapping window) does not reject the seed.
      await bookingRepo.create(opA, bookingInput({ bookingCode: `OD-${i}`, status: 'ACTIVE', requestedVehicleId: `veh-${i}`, assignedVehicleId: `veh-${i}`, startAt: new Date('2026-06-01T00:00:00Z'), endAt: new Date(`2026-06-${String((i % 27) + 1).padStart(2, '0')}T00:00:00Z`) }))
    }
    const { today } = await overviewRepo.getOperatorOverview(opA, NOW)
    expect(today.overdue).toHaveLength(50)
  })

  it('row carries id/code/status/ISO dates, vehicleId, and the resolved renter name', async () => {
    const { bookingRepo, overviewRepo } = makeRepo()
    const created = await bookingRepo.create(opA, bookingInput({ bookingCode: 'PICK-ROW', status: 'CONFIRMED', assignedVehicleId: 'veh-9', startAt: new Date('2026-07-01T01:00:00Z'), endAt: new Date('2026-07-01T09:00:00Z') }))
    const { today } = await overviewRepo.getOperatorOverview(opA, NOW)
    expect(today.pickups[0]).toEqual({
      id: created.id,
      bookingCode: 'PICK-ROW',
      status: 'CONFIRMED',
      startAt: '2026-07-01T01:00:00.000Z',
      endAt: '2026-07-01T09:00:00.000Z',
      vehicleId: 'veh-9',
      renterName: 'Alice',
    })
  })
})
