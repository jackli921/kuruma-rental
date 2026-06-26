import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import { ForbiddenError, type UserRole } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { createAdminBookingRoutes } from '../../src/routes/admin-bookings'
import { AdminBookingService } from '../../src/services/admin-booking'
import type { Booking, Operator, User } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'

const OP_A = '00000000-0000-4000-8000-00000000a001'
const OP_B = '00000000-0000-4000-8000-00000000b001'
const RENTER_1 = '00000000-0000-4000-8000-0000000000r1'
const RENTER_2 = '00000000-0000-4000-8000-0000000000r2'

function operator(id: string, name: string, slug: string): Operator {
  return { id, name, slug, preAuthHandoffUrl: null, createdAt: new Date(), updatedAt: new Date() }
}

function renter(id: string, name: string, email: string): User {
  return {
    id,
    name,
    email,
    phone: null,
    language: 'en',
    country: null,
    role: 'RENTER',
  }
}

function fullBooking(overrides: Partial<Booking>): Booking {
  const base = bookingInput(overrides)
  return {
    ...base,
    id: crypto.randomUUID(),
    cancellationFeeSettlement: 'ADVISORY',
    createdAt: overrides.createdAt ?? new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  }
}

function seeded() {
  const operators = new Map<string, Operator>([
    [OP_A, operator(OP_A, 'Best Car Rental', 'best-car')],
    [OP_B, operator(OP_B, 'Aoki Rentals', 'aoki')],
  ])
  const users = new Map<string, User>([
    [RENTER_1, renter(RENTER_1, 'Alice Tan', 'alice@example.com')],
    [RENTER_2, renter(RENTER_2, 'Bob Lee', 'bob@example.com')],
  ])
  const bookings = new Map<string, Booking>()
  for (const b of [
    fullBooking({
      operatorId: OP_A,
      renterId: RENTER_1,
      bookingCode: 'ALPHA001',
      assignedVehicleId: 'veh-a1',
      requestedVehicleId: 'veh-a1',
      createdAt: new Date('2026-05-01T00:00:00Z'),
    }),
    fullBooking({
      operatorId: OP_B,
      renterId: RENTER_2,
      bookingCode: 'BETA0002',
      status: 'COMPLETED',
      assignedVehicleId: 'veh-b1',
      requestedVehicleId: 'veh-b1',
      createdAt: new Date('2026-05-02T00:00:00Z'),
    }),
    fullBooking({
      operatorId: OP_A,
      renterId: RENTER_2,
      bookingCode: 'ALPHA003',
      assignedVehicleId: 'veh-a2',
      requestedVehicleId: 'veh-a2',
      createdAt: new Date('2026-05-03T00:00:00Z'),
    }),
  ]) {
    bookings.set(b.id, b)
  }
  return {
    bookingRepo: new InMemoryBookingRepository(bookings),
    operatorRepo: new InMemoryOperatorRepository(operators),
    userRepo: new InMemoryUserRepository(users),
  }
}

function makeService() {
  const { bookingRepo, operatorRepo, userRepo } = seeded()
  return new AdminBookingService(bookingRepo, operatorRepo, userRepo)
}

function mount(role: UserRole, operatorId?: string) {
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', createAdminBookingRoutes(makeService()))
  return app
}

describe('GET /admin/bookings — auth', () => {
  it('401 when unauthenticated', async () => {
    const app = new Hono()
    app.route('/', createAdminBookingRoutes(makeService()))
    expect((await app.request('/admin/bookings')).status).toBe(401)
  })

  it.each(['RENTER', 'PARTNER', 'STAFF', 'ADMIN'] as const)(
    '403 for %s (not a platform admin — PARTNER excluded #1119, legacy STAFF/ADMIN revoked #487)',
    async (role) => {
      expect((await mount(role).request('/admin/bookings')).status).toBe(403)
    },
  )

  it.each(['OPERATOR_OWNER', 'OPERATOR_STAFF'] as const)(
    '403 for %s (a tenant must never reach cross-operator oversight)',
    async (role) => {
      expect((await mount(role, OP_A).request('/admin/bookings')).status).toBe(403)
    },
  )

  it('200 for PLATFORM_ADMIN', async () => {
    expect((await mount('PLATFORM_ADMIN').request('/admin/bookings')).status).toBe(200)
  })
})

describe('AdminBookingService — defence-in-depth seal (service re-asserts the gate)', () => {
  it.each(['OPERATOR_OWNER', 'OPERATOR_STAFF', 'RENTER', 'PARTNER', 'STAFF', 'ADMIN'] as const)(
    'throws ForbiddenError for %s even if the route gate were bypassed',
    async (role) => {
      await expect(makeService().list({ userId: `${role}-user`, role }, {})).rejects.toThrow(
        ForbiddenError,
      )
    },
  )
})

describe('GET /admin/bookings — admin DTO carries operator + customer identity', () => {
  it('every row exposes operatorId, operatorName, and the renter identity', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/bookings')
    const { data } = await res.json()
    expect(data.bookings).toHaveLength(3)

    // Newest first (createdAt DESC): ALPHA003, BETA0002, ALPHA001.
    expect(data.bookings.map((b: { bookingCode: string }) => b.bookingCode)).toEqual([
      'ALPHA003',
      'BETA0002',
      'ALPHA001',
    ])

    const alpha001 = data.bookings.find(
      (b: { bookingCode: string }) => b.bookingCode === 'ALPHA001',
    )
    expect(alpha001).toMatchObject({
      operatorId: OP_A,
      operatorName: 'Best Car Rental',
      renterId: RENTER_1,
      renterName: 'Alice Tan',
      renterEmail: 'alice@example.com',
      status: 'CONFIRMED',
    })
  })
})

describe('GET /admin/bookings — filters', () => {
  it('filter by operator returns only that operator rows', async () => {
    const res = await mount('PLATFORM_ADMIN').request(`/admin/bookings?operatorId=${OP_A}`)
    const { data } = await res.json()
    expect(data.bookings.map((b: { bookingCode: string }) => b.bookingCode)).toEqual([
      'ALPHA003',
      'ALPHA001',
    ])
    expect(data.bookings.every((b: { operatorId: string }) => b.operatorId === OP_A)).toBe(true)
  })

  it('bookingCode search is a case-insensitive substring match', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/bookings?bookingCode=beta')
    const { data } = await res.json()
    expect(data.bookings).toHaveLength(1)
    expect(data.bookings[0].bookingCode).toBe('BETA0002')
  })

  it('customer search resolves name/email to renter rows', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/bookings?customer=bob@example.com')
    const { data } = await res.json()
    // Bob (RENTER_2) booked BETA0002 and ALPHA003.
    expect(data.bookings.map((b: { bookingCode: string }) => b.bookingCode).sort()).toEqual([
      'ALPHA003',
      'BETA0002',
    ])
  })

  it('customer search with no match returns an empty page (never an unfiltered list)', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/bookings?customer=nobody')
    const { data } = await res.json()
    expect(data.bookings).toEqual([])
    expect(data.nextCursor).toBeNull()
  })

  it('filter by status returns only matching rows', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/bookings?status=COMPLETED')
    const { data } = await res.json()
    expect(data.bookings.map((b: { bookingCode: string }) => b.bookingCode)).toEqual(['BETA0002'])
  })

  it('400 for an unknown status value', async () => {
    const res = await mount('PLATFORM_ADMIN').request('/admin/bookings?status=BOGUS')
    expect(res.status).toBe(400)
  })

  it('paginates with limit + cursor (newest first, stable)', async () => {
    // ONE app instance across both requests so the page-1 cursor (createdAt + id)
    // resolves against the same rows on page 2 (a fresh mount() would re-seed with
    // new random ids and the cursor would no longer match).
    const app = mount('PLATFORM_ADMIN')

    const first = await app.request('/admin/bookings?limit=2')
    const firstBody = (await first.json()).data
    expect(firstBody.bookings.map((b: { bookingCode: string }) => b.bookingCode)).toEqual([
      'ALPHA003',
      'BETA0002',
    ])
    expect(firstBody.nextCursor).not.toBeNull()

    const next = await app.request(
      `/admin/bookings?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    )
    const nextBody = (await next.json()).data
    expect(nextBody.bookings.map((b: { bookingCode: string }) => b.bookingCode)).toEqual([
      'ALPHA001',
    ])
    expect(nextBody.nextCursor).toBeNull()
  })
})
