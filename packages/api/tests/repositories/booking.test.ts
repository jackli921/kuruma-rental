import { describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { BOOKING_CODE_CONSTRAINT, PG_ERROR } from '../../src/pg-errors'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import type { Booking } from '../../src/stores'
import { makeBooking } from '../helpers/booking'

describe('BookingRepository.countBookingsForOperator (#1120)', () => {
  const now = new Date('2026-06-27T00:00:00Z')
  const future = new Date('2026-07-01T09:00:00Z')
  const past = new Date('2026-06-01T09:00:00Z')

  it('counts non-CANCELLED as total and future CONFIRMED/ACTIVE as upcoming, scoped to the operator', async () => {
    const rows = [
      makeBooking({ operatorId: 'op-1', status: 'CONFIRMED', startAt: future }), // total + upcoming
      makeBooking({ operatorId: 'op-1', status: 'ACTIVE', startAt: future }), // total + upcoming
      makeBooking({ operatorId: 'op-1', status: 'CONFIRMED', startAt: now }), // boundary: upcoming
      makeBooking({ operatorId: 'op-1', status: 'CONFIRMED', startAt: past }), // total only (past)
      makeBooking({ operatorId: 'op-1', status: 'COMPLETED', startAt: past }), // total only (not CONFIRMED/ACTIVE)
      makeBooking({ operatorId: 'op-1', status: 'CANCELLED', startAt: future }), // excluded entirely
      makeBooking({ operatorId: 'op-2', status: 'CONFIRMED', startAt: future }), // other operator
    ]
    const repo = new InMemoryBookingRepository(new Map(rows.map((b) => [b.id, b])))

    expect(await repo.countBookingsForOperator('op-1', now)).toEqual({ total: 5, upcoming: 3 })
  })

  it('returns all-zero for an operator with no bookings', async () => {
    const repo = new InMemoryBookingRepository()
    expect(await repo.countBookingsForOperator('op-empty', now)).toEqual({ total: 0, upcoming: 0 })
  })
})

type NewBooking = Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>

function bookingData(overrides: Partial<Booking> = {}): NewBooking {
  return {
    operatorId: 'op-A',
    renterId: 'renter-X',
    classId: 'class-1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: new Date('2026-04-10T09:00:00Z'),
    endAt: new Date('2026-04-10T17:00:00Z'),
    effectiveEndAt: new Date('2026-04-12T17:00:00Z'), // +48h turnaround
    status: 'CONFIRMED',
    source: 'DIRECT',
    fulfillmentMode: 'SPECIFIC',
    bookingCode: 'AAAA2222',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 12000,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    ...overrides,
  }
}

const renterCtx = (userId: string): CallerContext => ({
  userId,
  role: 'RENTER',
  bypassScope: false,
})
const operatorCtx = (operatorId: string): CallerContext => ({
  userId: `${operatorId}-staff`,
  role: 'OPERATOR_OWNER',
  operatorId,
  bypassScope: false,
})

describe('InMemoryBookingRepository — exclusion on assignedVehicleId', () => {
  it('rejects an overlapping booking for the same assigned vehicle', async () => {
    const repo = new InMemoryBookingRepository()
    await repo.create(SYSTEM_CONTEXT, bookingData({ bookingCode: 'CODE0001' }))
    await expect(
      repo.create(
        SYSTEM_CONTEXT,
        bookingData({
          bookingCode: 'CODE0002',
          startAt: new Date('2026-04-10T12:00:00Z'),
          endAt: new Date('2026-04-10T20:00:00Z'),
        }),
      ),
    ).rejects.toMatchObject({ code: PG_ERROR.EXCLUSION_VIOLATION })
  })

  it('allows the same time window on a different assigned vehicle', async () => {
    const repo = new InMemoryBookingRepository()
    await repo.create(SYSTEM_CONTEXT, bookingData({ bookingCode: 'CODE0001' }))
    const second = await repo.create(
      SYSTEM_CONTEXT,
      bookingData({ bookingCode: 'CODE0002', assignedVehicleId: 'veh-2' }),
    )
    expect(second.assignedVehicleId).toBe('veh-2')
  })

  it('rejects a duplicate bookingCode with the bookingCode constraint', async () => {
    const repo = new InMemoryBookingRepository()
    await repo.create(SYSTEM_CONTEXT, bookingData({ bookingCode: 'DUP00001' }))
    await expect(
      repo.create(
        SYSTEM_CONTEXT,
        bookingData({ bookingCode: 'DUP00001', assignedVehicleId: 'v9' }),
      ),
    ).rejects.toMatchObject({
      code: PG_ERROR.UNIQUE_VIOLATION,
      constraint_name: BOOKING_CODE_CONSTRAINT,
    })
  })
})

describe('InMemoryBookingRepository — three-way read scope', () => {
  async function seed() {
    const repo = new InMemoryBookingRepository()
    await repo.create(
      SYSTEM_CONTEXT,
      bookingData({ operatorId: 'op-A', renterId: 'renter-X', bookingCode: 'AX000001' }),
    )
    await repo.create(
      SYSTEM_CONTEXT,
      bookingData({
        operatorId: 'op-B',
        renterId: 'renter-Y',
        assignedVehicleId: 'veh-9',
        bookingCode: 'BY000001',
      }),
    )
    return repo
  }

  it('a renter sees only their own bookings', async () => {
    const repo = await seed()
    const rows = await repo.findAll(renterCtx('renter-X'))
    expect(rows.map((b) => b.renterId)).toEqual(['renter-X'])
  })

  it('an operator sees only its tenant bookings', async () => {
    const repo = await seed()
    const rows = await repo.findAll(operatorCtx('op-B'))
    expect(rows.map((b) => b.operatorId)).toEqual(['op-B'])
  })

  it('a bypass caller sees all bookings', async () => {
    const repo = await seed()
    const rows = await repo.findAll(SYSTEM_CONTEXT)
    expect(rows).toHaveLength(2)
  })

  it('findById hides another operator booking (404, no existence leak)', async () => {
    const repo = await seed()
    const opA = await repo.findAll(operatorCtx('op-A'))
    const idOfA = opA[0]?.id ?? ''
    expect(await repo.findById(operatorCtx('op-B'), idOfA)).toBeUndefined()
    expect(await repo.findById(operatorCtx('op-A'), idOfA)).toBeDefined()
  })

  it('a renter cannot create a booking for another renter', async () => {
    const repo = new InMemoryBookingRepository()
    await expect(
      repo.create(renterCtx('renter-X'), bookingData({ renterId: 'renter-OTHER' })),
    ).rejects.toThrow(/another user/)
  })
})

describe('InMemoryBookingRepository — countActiveForLocation (#412)', () => {
  it('counts active bookings referencing the location as pickup OR dropoff, ignoring non-active', async () => {
    const repo = new InMemoryBookingRepository()
    // pickup = loc-1, CONFIRMED -> counts
    await repo.create(
      SYSTEM_CONTEXT,
      bookingData({
        bookingCode: 'LOC00001',
        assignedVehicleId: 'veh-1',
        pickupLocationId: 'loc-1',
        dropoffLocationId: 'loc-9',
      }),
    )
    // dropoff = loc-1, ACTIVE -> counts (distinct vehicle avoids the exclusion)
    await repo.create(
      SYSTEM_CONTEXT,
      bookingData({
        bookingCode: 'LOC00002',
        assignedVehicleId: 'veh-2',
        status: 'ACTIVE',
        pickupLocationId: 'loc-9',
        dropoffLocationId: 'loc-1',
      }),
    )
    // pickup = loc-1 but CANCELLED -> ignored
    await repo.create(
      SYSTEM_CONTEXT,
      bookingData({
        bookingCode: 'LOC00003',
        assignedVehicleId: 'veh-3',
        status: 'CANCELLED',
        pickupLocationId: 'loc-1',
        dropoffLocationId: 'loc-1',
      }),
    )
    // active but a different location -> ignored
    await repo.create(
      SYSTEM_CONTEXT,
      bookingData({
        bookingCode: 'LOC00004',
        assignedVehicleId: 'veh-4',
        pickupLocationId: 'loc-2',
        dropoffLocationId: 'loc-2',
      }),
    )

    expect(await repo.countActiveForLocation('loc-1')).toBe(2)
    expect(await repo.countActiveForLocation('loc-2')).toBe(1)
    expect(await repo.countActiveForLocation('loc-unknown')).toBe(0)
  })
})
