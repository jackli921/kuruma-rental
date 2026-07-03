import { beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/auth/context'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryCustomerRepository } from '../../src/repositories/in-memory/customer'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { CustomerService } from '../../src/services/customer'
import type { User } from '../../src/stores'

const OPERATOR = '00000000-0000-4000-8000-0000000000f1'

// #1168 — CustomerService.search() must scope "see the whole user table" to the
// PLATFORM_ADMIN tier, NOT to the coarse `bypassScope` flag, which also carries
// PARTNER. The /customers/search route already 403s PARTNER (#1116); this is the
// service-layer seal so the directory can never become a PARTNER enumeration
// vector even if a future route reaches it (defense-in-depth, mirrors #1119).
describe('CustomerService.search — privileged scope is PLATFORM_ADMIN, never PARTNER', () => {
  const RENTER_A = '00000000-0000-4000-8000-0000000000a1'
  const RENTER_B = '00000000-0000-4000-8000-0000000000b2'
  let service: CustomerService
  let bookingRepo: InMemoryBookingRepository

  beforeEach(() => {
    const users = new Map<string, User>([
      [RENTER_A, mkRenter(RENTER_A, 'Searchable Alice')],
      [RENTER_B, mkRenter(RENTER_B, 'Searchable Bob')],
    ])
    const userRepo = new InMemoryUserRepository(users)
    const customerRepo = new InMemoryCustomerRepository(users, new Map())
    bookingRepo = new InMemoryBookingRepository()
    service = new CustomerService(customerRepo, userRepo, bookingRepo)
  })

  it('PLATFORM_ADMIN still sees the full directory (regression: privileged read preserved)', async () => {
    const ctx: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
    const results = await service.search('Searchable', ctx)
    expect(results.map((u) => u.id).sort()).toEqual([RENTER_A, RENTER_B])
  })

  it('PARTNER gets nothing — bypassScope no longer unlocks the full user table', async () => {
    // PARTNER keeps bypassScope=true (its bookings are scoped per-consumer, #1119),
    // but it has no operatorId and no customer-directory use case.
    const ctx: CallerContext = { userId: 'trip', role: 'PARTNER', bypassScope: true }
    const results = await service.search('Searchable', ctx)
    expect(results).toEqual([])
  })

  it('#1260: a PLATFORM_ADMIN acting as an operator is scoped to that operator’s customers', async () => {
    // Only RENTER_A has a prior booking with OPERATOR -> only they are a customer.
    await seedCustomerBooking(bookingRepo, OPERATOR, RENTER_A)
    const ctx: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
    const results = await service.search('Searchable', ctx, OPERATOR)
    expect(results.map((u) => u.id)).toEqual([RENTER_A])
  })

  it('#1260: a PLATFORM_ADMIN acting as an operator with no customers gets nothing (not the full table)', async () => {
    const ctx: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
    const results = await service.search('Searchable', ctx, OPERATOR)
    expect(results).toEqual([])
  })
})

function mkRenter(id: string, name: string): User {
  return {
    id,
    name,
    email: `${id.slice(-2)}@test.local`,
    phone: null,
    language: 'en',
    country: null,
    role: 'RENTER',
  }
}

// A prior booking making `renterId` a customer of `operatorId` — what
// listRenterIdsForOperator (and thus the picked-operator search scope) keys on.
async function seedCustomerBooking(
  bookingRepo: InMemoryBookingRepository,
  operatorId: string,
  renterId: string,
): Promise<void> {
  await bookingRepo.create(SYSTEM_CONTEXT, {
    operatorId,
    renterId,
    classId: 'class-x',
    requestedVehicleId: 'veh-x',
    assignedVehicleId: 'veh-x',
    pickupLocationId: 'loc-x',
    dropoffLocationId: 'loc-x',
    startAt: new Date('2020-01-01T00:00:00Z'),
    endAt: new Date('2020-01-02T00:00:00Z'),
    effectiveEndAt: new Date('2020-01-04T00:00:00Z'),
    status: 'COMPLETED',
    source: 'MANUAL',
    bookingCode: 'SEEDCS01',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 10000,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
  })
}
