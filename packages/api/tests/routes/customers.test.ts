import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryCustomerRepository } from '../../src/repositories/in-memory/customer'
import { createCustomerRoutes } from '../../src/routes/customers'
import { CustomerService } from '../../src/services/customer'
import type { Booking, User } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

const USER1 = '00000000-0000-4000-8000-0000000000a1'
const USER2 = '00000000-0000-4000-8000-0000000000a2'
const USER3 = '00000000-0000-4000-8000-0000000000a3'
const ADMIN = '00000000-0000-4000-8000-0000000000ad'
const V1 = '00000000-0000-4000-8000-000000000001'

let app: Hono

function mkUser(id: string, overrides: Partial<User> = {}): User {
  return {
    id,
    name: `Name ${id.slice(-2)}`,
    email: `${id.slice(-2)}@example.com`,
    language: 'en',
    country: 'JP',
    role: 'RENTER',
    ...overrides,
  }
}

function mkBooking(b: Partial<Booking> & { id: string; renterId: string }): Booking {
  const startAt = b.startAt ?? new Date('2026-04-01T00:00:00Z')
  const endAt = b.endAt ?? new Date('2026-04-02T00:00:00Z')
  return {
    id: b.id,
    renterId: b.renterId,
    vehicleId: V1,
    startAt,
    endAt,
    effectiveEndAt: endAt,
    status: 'COMPLETED',
    source: 'DIRECT',
    externalId: null,
    notes: null,
    totalPrice: 10000,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
    createdAt: startAt,
    updatedAt: startAt,
    ...b,
  }
}

function setup({
  users = [] as User[],
  bookings = [] as Booking[],
  asRole = 'ADMIN' as const,
}: {
  users?: User[]
  bookings?: Booking[]
  asRole?: 'ADMIN' | 'STAFF' | 'RENTER'
} = {}) {
  const userStore = new Map(users.map((u) => [u.id, u]))
  const bookingStore = new Map(bookings.map((b) => [b.id, b]))
  const repo = new InMemoryCustomerRepository(userStore, bookingStore)
  const service = new CustomerService(repo)
  app = new Hono()
  app.use('*', testAuthMiddleware(ADMIN, asRole))
  app.route('/', createCustomerRoutes(service))
  return { repo, service }
}

describe('GET /customers', () => {
  beforeEach(() => {
    app = new Hono()
  })

  it('returns empty list when no bookings exist', async () => {
    setup({ users: [mkUser(USER1)] })
    const res = await app.request('/customers')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, data: [], nextCursor: null })
  })

  it('returns one row per user who has at least one booking, with aggregates', async () => {
    setup({
      users: [mkUser(USER1, { name: 'Alice' }), mkUser(USER2, { name: 'Bob' })],
      bookings: [
        mkBooking({
          id: 'b1',
          renterId: USER1,
          totalPrice: 5000,
          startAt: new Date('2026-04-05T00:00:00Z'),
        }),
        mkBooking({
          id: 'b2',
          renterId: USER1,
          totalPrice: 3000,
          startAt: new Date('2026-04-10T00:00:00Z'),
        }),
        mkBooking({
          id: 'b3',
          renterId: USER2,
          totalPrice: 7000,
          startAt: new Date('2026-04-08T00:00:00Z'),
        }),
      ],
    })
    const res = await app.request('/customers')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)

    // Default sort: lastBookingAt DESC → Bob (Apr 8) then Alice (Apr 10)?
    // Wait: Alice's latest is Apr 10, Bob's is Apr 8 → Alice first.
    const [alice, bob] = body.data
    expect(alice).toMatchObject({
      id: USER1,
      name: 'Alice',
      email: 'a1@example.com',
      language: 'en',
      country: 'JP',
      bookingCount: 2,
      totalSpent: 8000,
      lastBookingAt: '2026-04-10T00:00:00.000Z',
    })
    expect(bob).toMatchObject({
      id: USER2,
      name: 'Bob',
      bookingCount: 1,
      totalSpent: 7000,
      lastBookingAt: '2026-04-08T00:00:00.000Z',
    })
  })

  it('excludes CANCELLED bookings from totalSpent but counts them in bookingCount', async () => {
    setup({
      users: [mkUser(USER1)],
      bookings: [
        mkBooking({ id: 'b1', renterId: USER1, totalPrice: 5000, status: 'COMPLETED' }),
        mkBooking({ id: 'b2', renterId: USER1, totalPrice: 9999, status: 'CANCELLED' }),
      ],
    })
    const res = await app.request('/customers')
    const body = await res.json()
    expect(body.data[0].bookingCount).toBe(2)
    expect(body.data[0].totalSpent).toBe(5000)
  })

  it('does NOT return users with zero bookings', async () => {
    setup({
      users: [mkUser(USER1), mkUser(USER3, { name: 'NoBookings' })],
      bookings: [mkBooking({ id: 'b1', renterId: USER1 })],
    })
    const res = await app.request('/customers')
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe(USER1)
  })

  it('returns 403 when caller is not STAFF/ADMIN', async () => {
    setup({ users: [mkUser(USER1)], asRole: 'RENTER' })
    const res = await app.request('/customers')
    expect(res.status).toBe(403)
  })

  it('supports sort=bookingCount DESC', async () => {
    setup({
      users: [mkUser(USER1, { name: 'Alice' }), mkUser(USER2, { name: 'Bob' })],
      bookings: [
        mkBooking({ id: 'b1', renterId: USER1 }),
        mkBooking({ id: 'b2', renterId: USER2 }),
        mkBooking({ id: 'b3', renterId: USER2 }),
      ],
    })
    const res = await app.request('/customers?sort=bookingCount')
    const body = await res.json()
    expect(body.data.map((c: { id: string }) => c.id)).toEqual([USER2, USER1])
  })

  it('supports ?search= (case-insensitive prefix on name OR email)', async () => {
    setup({
      users: [
        mkUser(USER1, { name: 'Alice', email: 'alice@example.com' }),
        mkUser(USER2, { name: 'Bob', email: 'bob@example.com' }),
      ],
      bookings: [
        mkBooking({ id: 'b1', renterId: USER1 }),
        mkBooking({ id: 'b2', renterId: USER2 }),
      ],
    })
    const res = await app.request('/customers?search=ali')
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe(USER1)
  })

  it('paginates with cursor', async () => {
    const users: User[] = []
    const bookings: Booking[] = []
    for (let i = 0; i < 5; i++) {
      const id = `00000000-0000-4000-8000-0000000000${String(i).padStart(2, 'b')}`
      users.push(mkUser(id, { name: `User${i}` }))
      bookings.push(
        mkBooking({
          id: `bk${i}`,
          renterId: id,
          startAt: new Date(`2026-04-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
        }),
      )
    }
    setup({ users, bookings })
    const res1 = await app.request('/customers?limit=2')
    const body1 = await res1.json()
    expect(body1.data).toHaveLength(2)
    expect(body1.nextCursor).not.toBeNull()

    const res2 = await app.request(
      `/customers?limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`,
    )
    const body2 = await res2.json()
    expect(body2.data).toHaveLength(2)
    // No duplicate IDs between pages.
    const ids1 = new Set(body1.data.map((c: { id: string }) => c.id))
    for (const c of body2.data) {
      expect(ids1.has(c.id)).toBe(false)
    }
  })
})

describe('GET /customers/:id', () => {
  it('returns 404 for unknown customer', async () => {
    setup({ users: [mkUser(USER1)] })
    const res = await app.request('/customers/does-not-exist')
    expect(res.status).toBe(404)
  })

  it('returns 404 when user exists but has no bookings', async () => {
    setup({ users: [mkUser(USER1)] })
    const res = await app.request(`/customers/${USER1}`)
    expect(res.status).toBe(404)
  })

  it('returns user + booking history sorted by startAt DESC', async () => {
    setup({
      users: [mkUser(USER1, { name: 'Alice' })],
      bookings: [
        mkBooking({ id: 'b-old', renterId: USER1, startAt: new Date('2026-03-01T00:00:00Z') }),
        mkBooking({ id: 'b-new', renterId: USER1, startAt: new Date('2026-04-10T00:00:00Z') }),
      ],
    })
    const res = await app.request(`/customers/${USER1}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe(USER1)
    expect(body.data.name).toBe('Alice')
    expect(body.data.bookings).toHaveLength(2)
    expect(body.data.bookings[0].id).toBe('b-new')
    expect(body.data.bookings[1].id).toBe('b-old')
  })
})
