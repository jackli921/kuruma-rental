import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryCustomerRepository } from '../../src/repositories/in-memory/customer'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { createCustomerRoutes } from '../../src/routes/customers'
import { CustomerService } from '../../src/services/customer'
import type { Booking, User } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'
import { makeBooking as makeBookingFixture } from '../helpers/booking'

const USER1 = '00000000-0000-4000-8000-0000000000a1'
const USER2 = '00000000-0000-4000-8000-0000000000a2'
const USER3 = '00000000-0000-4000-8000-0000000000a3'
const ADMIN = '00000000-0000-4000-8000-0000000000ad'

let app: Hono

function mkUser(id: string, overrides: Partial<User> = {}): User {
  return {
    id,
    name: `Name ${id.slice(-2)}`,
    email: `${id.slice(-2)}@example.com`,
    phone: null,
    language: 'en',
    country: 'JP',
    role: 'RENTER',
    ...overrides,
  }
}

function mkBooking(b: Partial<Booking> & { id: string; renterId: string }): Booking {
  const startAt = b.startAt ?? new Date('2026-04-01T00:00:00Z')
  const endAt = b.endAt ?? new Date('2026-04-02T00:00:00Z')
  return makeBookingFixture({
    status: 'COMPLETED',
    startAt,
    endAt,
    effectiveEndAt: endAt,
    totalPrice: 10000,
    createdAt: startAt,
    updatedAt: startAt,
    ...b,
  })
}

function setup({
  users = [] as User[],
  bookings = [] as Booking[],
  asRole = 'PLATFORM_ADMIN' as const,
}: {
  users?: User[]
  bookings?: Booking[]
  asRole?: 'PLATFORM_ADMIN' | 'RENTER'
} = {}) {
  const userStore = new Map(users.map((u) => [u.id, u]))
  const bookingStore = new Map(bookings.map((b) => [b.id, b]))
  const customerRepo = new InMemoryCustomerRepository(userStore, bookingStore)
  const userRepo = new InMemoryUserRepository(userStore)
  const service = new CustomerService(customerRepo, userRepo)
  app = new Hono()
  app.use('*', testAuthMiddleware(ADMIN, asRole))
  app.route('/', createCustomerRoutes(service))
  return { customerRepo, userRepo, service }
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

  it('returns 403 for a non-platform caller (RENTER)', async () => {
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
    const ids1 = new Set(body1.data.map((c: { id: string }) => c.id))
    for (const c of body2.data) {
      expect(ids1.has(c.id)).toBe(false)
    }
  })
})

describe('GET /customers/:id', () => {
  beforeEach(() => {
    app = new Hono()
  })

  it('returns 404 for a valid-but-unknown customer id', async () => {
    setup({ users: [mkUser(USER1)] })
    const res = await app.request('/customers/00000000-0000-4000-8000-0000000000ff')
    expect(res.status).toBe(404)
  })

  it('returns 400 for a malformed (non-uuid) customer id', async () => {
    setup({ users: [mkUser(USER1)] })
    const res = await app.request('/customers/does-not-exist')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('id must be a valid uuid')
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

describe('GET /customers/search', () => {
  beforeEach(() => {
    app = new Hono()
  })

  function seed(): User[] {
    return [
      mkUser('u1', {
        name: 'Tanaka Yuki',
        email: 'tanaka@example.com',
        phone: '+81-90-1234-5678',
        language: 'ja',
      }),
      mkUser('u2', {
        name: 'Smith John',
        email: 'smith@example.com',
        phone: null,
        language: 'en',
      }),
      mkUser('u3', {
        name: 'Chen Wei',
        email: 'chen@example.com',
        phone: '+86-138-0000-0000',
        language: 'zh',
      }),
    ]
  }

  it('returns matching customers by name', async () => {
    setup({ users: seed(), asRole: 'PLATFORM_ADMIN' })
    const res = await app.request('/customers/search?q=tanaka')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('Tanaka Yuki')
    expect(body.data[0].email).toBe('tanaka@example.com')
  })

  it('returns 403 for RENTER role', async () => {
    setup({ users: seed(), asRole: 'RENTER' })
    const res = await app.request('/customers/search?q=tanaka')
    expect(res.status).toBe(403)
  })

  it('returns 400 when search query is less than 2 characters', async () => {
    setup({ users: seed(), asRole: 'PLATFORM_ADMIN' })
    const res = await app.request('/customers/search?q=a')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Search query must be at least 2 characters')
  })

  it('returns 400 when search query is missing', async () => {
    setup({ users: seed(), asRole: 'PLATFORM_ADMIN' })
    const res = await app.request('/customers/search')
    expect(res.status).toBe(400)
  })

  it('matches by email', async () => {
    setup({ users: seed(), asRole: 'PLATFORM_ADMIN' })
    const res = await app.request('/customers/search?q=smith@')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('Smith John')
  })

  it('matches by phone', async () => {
    setup({ users: seed(), asRole: 'PLATFORM_ADMIN' })
    const res = await app.request('/customers/search?q=1234-5678')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].name).toBe('Tanaka Yuki')
  })

  it('returns empty array when no matches', async () => {
    setup({ users: seed(), asRole: 'PLATFORM_ADMIN' })
    const res = await app.request('/customers/search?q=zzzzz')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual([])
  })
})

describe('POST /customers/quick-create', () => {
  beforeEach(() => {
    app = new Hono()
  })

  it('creates a new customer with name and email', async () => {
    setup({ asRole: 'PLATFORM_ADMIN' })
    const res = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New Customer',
        email: 'new@example.com',
        language: 'en',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.name).toBe('New Customer')
    expect(body.data.email).toBe('new@example.com')
    expect(body.data.id).toBeDefined()
  })

  it('is idempotent on email — returns existing user on second call', async () => {
    setup({ asRole: 'PLATFORM_ADMIN' })
    const payload = { name: 'Dup', email: 'dup@example.com', language: 'en' }

    const res1 = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(res1.status).toBe(201)
    const body1 = await res1.json()

    const res2 = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(res2.status).toBe(200)
    const body2 = await res2.json()
    expect(body2.data.id).toBe(body1.data.id)
  })

  it('is idempotent on email case — Bob@x.com and bob@x.com resolve to one user (#715)', async () => {
    setup({ asRole: 'PLATFORM_ADMIN' })

    const res1 = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Mixed Case', email: 'Bob@Example.com', language: 'en' }),
    })
    expect(res1.status).toBe(201)
    const body1 = await res1.json()
    // stored lowercased so the DB unique index can't be defeated by casing
    expect(body1.data.email).toBe('bob@example.com')

    const res2 = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Same Human', email: 'bob@example.com', language: 'en' }),
    })
    expect(res2.status).toBe(200) // existing user, not a new row
    const body2 = await res2.json()
    expect(body2.data.id).toBe(body1.data.id)
  })

  it('returns 400 when neither email nor phone is provided', async () => {
    setup({ asRole: 'PLATFORM_ADMIN' })
    const res = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Contact' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 403 for RENTER role', async () => {
    setup({ asRole: 'RENTER' })
    const res = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Forbidden', email: 'f@example.com' }),
    })
    expect(res.status).toBe(403)
  })

  it('creates customer with phone only (no email)', async () => {
    setup({ asRole: 'PLATFORM_ADMIN' })
    const res = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Phone Only',
        phone: '+81-90-9999-8888',
        language: 'ja',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.name).toBe('Phone Only')
    expect(body.data.phone).toBe('+81-90-9999-8888')
    // phone-only must stay email:null — guards the `data.email?.toLowerCase() ?? null`
    // branch against a refactor that accidentally lowercases the synthetic placeholder
    expect(body.data.email).toBeNull()
  })

  it('is idempotent on phone — returns existing user', async () => {
    setup({ asRole: 'PLATFORM_ADMIN' })
    const payload = { name: 'Phone Dup', phone: '+81-90-1111-2222', language: 'ja' }

    const res1 = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(res1.status).toBe(201)
    const body1 = await res1.json()

    const res2 = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(res2.status).toBe(200)
    const body2 = await res2.json()
    expect(body2.data.id).toBe(body1.data.id)
  })

  it('defaults language to en when not specified', async () => {
    setup({ asRole: 'PLATFORM_ADMIN' })
    const res = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Default Lang', email: 'deflang@example.com' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.language).toBe('en')
  })

  it('returns 400 when name is empty', async () => {
    setup({ asRole: 'PLATFORM_ADMIN' })
    const res = await app.request('/customers/quick-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'valid@example.com' }),
    })
    expect(res.status).toBe(400)
  })
})
