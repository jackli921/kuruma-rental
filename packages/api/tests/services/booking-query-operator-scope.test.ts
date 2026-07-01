import { describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { BookingQueryService } from '../../src/services/booking-query'
import { bookingInput } from '../helpers/booking'

// #1230 slice 5a: a PLATFORM_ADMIN using the operator-context picker may narrow
// the bookings list to one operator by passing requestedOperatorId. The service
// runs it through narrowReadToOperator(ctx, id, bookingReadScope) first, so only
// an `all`-scope (bypass) caller's id survives — a renter/partner/tenant id drops
// to undefined and can never widen a private read (the H2 invariant, #1272).

const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const operatorA: CallerContext = { userId: 'ua', role: 'OPERATOR_OWNER', operatorId: 'op-A' }

// Two bookings, one per operator, both owned by renter r1. Distinct vehicles +
// windows so neither the in-memory exclusion guard nor bookingCode uniqueness trips.
async function seedTwoOperators(repo: InMemoryBookingRepository) {
  const a = await repo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: 'op-A',
      renterId: 'r1',
      assignedVehicleId: 'veh-A',
      requestedVehicleId: 'veh-A',
      startAt: new Date('2026-08-01T09:00:00Z'),
      endAt: new Date('2026-08-01T17:00:00Z'),
      effectiveEndAt: new Date('2026-08-01T17:00:00Z'),
    }),
  )
  const b = await repo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: 'op-B',
      renterId: 'r1',
      assignedVehicleId: 'veh-B',
      requestedVehicleId: 'veh-B',
      startAt: new Date('2026-08-02T09:00:00Z'),
      endAt: new Date('2026-08-02T17:00:00Z'),
      effectiveEndAt: new Date('2026-08-02T17:00:00Z'),
    }),
  )
  return { a, b }
}

describe('BookingQueryService — bypass-gated operator narrowing (#1230 slice 5a)', () => {
  it('narrows an all-scope admin to the requested operator', async () => {
    const repo = new InMemoryBookingRepository()
    const { a } = await seedTwoOperators(repo)
    const service = new BookingQueryService(repo)

    const { data } = await service.findAllPaginated(admin, {}, 'op-A')

    expect(data.map((x) => x.id)).toEqual([a.id])
  })

  it('drops a foreign operatorId for a tenant-scoped operator (never widens)', async () => {
    const repo = new InMemoryBookingRepository()
    const { a } = await seedTwoOperators(repo)
    const service = new BookingQueryService(repo)

    // operatorA is already clamped to op-A; a requested op-B must be dropped, so
    // they still see only their own booking — a foreign pick cannot widen.
    const { data } = await service.findAllPaginated(operatorA, {}, 'op-B')

    expect(data.map((x) => x.id)).toEqual([a.id])
  })

  it('threads the narrowing through the enriched paginated methods too', async () => {
    const repo = new InMemoryBookingRepository()
    const { a } = await seedTwoOperators(repo)
    // No userRepo: findAllWithRentersPaginated returns early after findAllPaginated,
    // so this proves the enriched wrapper forwards requestedOperatorId to the funnel.
    const service = new BookingQueryService(repo)

    const { data } = await service.findAllWithRentersPaginated(admin, {}, 'op-A')

    expect(data.map((x) => x.id)).toEqual([a.id])
  })
})
