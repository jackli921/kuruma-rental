import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { createBookingRoutes } from '../../src/routes/bookings'
import { BookingService } from '../../src/services/booking'
import { testAuthMiddleware } from '../helpers/auth'

let app: Hono
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let service: BookingService

function futureDate(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString()
}

const V1 = '00000000-0000-4000-8000-000000000001'
const V2 = '00000000-0000-4000-8000-000000000002'
const USER1 = '00000000-0000-4000-8000-0000000000a1'
const USER2 = '00000000-0000-4000-8000-0000000000a2'

function validBookingInput() {
  return {
    vehicleId: V1,
    renterId: USER1,
    startAt: futureDate(24),
    endAt: futureDate(48),
    source: 'DIRECT' as const,
  }
}

async function createBooking(input = validBookingInput()) {
  return app.request('/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

describe('Booking Routes', () => {
  beforeEach(() => {
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    service = new BookingService(bookingRepo, vehicleRepo)
    app = new Hono()
    // ADMIN with USER1 identity — mirrors pre-auth test data
    app.use('*', testAuthMiddleware(USER1, 'ADMIN'))
    app.route('/', createBookingRoutes(service))
  })

  describe('GET /bookings', () => {
    it('returns empty list initially', async () => {
      const res = await app.request('/bookings')

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toEqual({ success: true, data: [], nextCursor: null })
    })

    it('returns created bookings', async () => {
      await createBooking()
      await createBooking({
        ...validBookingInput(),
        vehicleId: V2,
      })

      const res = await app.request('/bookings')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
    })

    it('filters by status', async () => {
      await createBooking()

      const res = await app.request('/bookings?status=CONFIRMED')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].status).toBe('CONFIRMED')
    })

    it('filters by status returning empty when no match', async () => {
      await createBooking()

      const res = await app.request('/bookings?status=ACTIVE')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(0)
    })

    it('filters by vehicleId', async () => {
      await createBooking()
      await createBooking({
        ...validBookingInput(),
        vehicleId: V2,
      })

      const res = await app.request(`/bookings?vehicleId=${V1}`)
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].vehicleId).toBe(V1)
    })

    it('filters by renterId', async () => {
      // Create one booking via route (gets USER1 from JWT context)
      await createBooking()
      // Create second booking directly in repo with USER2 (bypasses JWT)
      await bookingRepo.create({
        vehicleId: V2,
        renterId: USER2,
        startAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        effectiveEndAt: new Date(Date.now() + 49 * 60 * 60 * 1000),
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      })

      const res = await app.request(`/bookings?renterId=${USER1}`)
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].renterId).toBe(USER1)
    })

    it('filters by renterId returning empty when no match', async () => {
      await createBooking()

      const res = await app.request('/bookings?renterId=nonexistent')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(0)
    })

    it('RENTER only sees own bookings, not other users', async () => {
      // USER1 creates a booking (default app user)
      await createBooking()

      // USER2 creates a booking via a separate app instance
      const app2 = new Hono()
      app2.use('*', testAuthMiddleware(USER2, 'ADMIN'))
      app2.route('/', createBookingRoutes(service))
      await app2.request('/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBookingInput(), vehicleId: V2 }),
      })

      // Query as RENTER — should only see own bookings
      const renterApp = new Hono()
      renterApp.use('*', testAuthMiddleware(USER1, 'RENTER'))
      renterApp.route('/', createBookingRoutes(service))

      const res = await renterApp.request('/bookings')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].renterId).toBe(USER1)
    })

    it('filters by date range returning bookings that overlap', async () => {
      // Booking from hour 24 to hour 48
      await createBooking()

      // Query range that overlaps (hour 30 to hour 60)
      const from = futureDate(30)
      const to = futureDate(60)
      const res = await app.request(
        `/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
    })

    it('filters by date range excluding non-overlapping bookings', async () => {
      // Booking from hour 24 to hour 48
      await createBooking()

      // Query range that does NOT overlap (hour 72 to hour 96)
      const from = futureDate(72)
      const to = futureDate(96)
      const res = await app.request(
        `/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(0)
    })

    it('combines date range with status filter', async () => {
      // Create two bookings in the same range
      await createBooking()
      await createBooking({
        ...validBookingInput(),
        vehicleId: V2,
      })

      // Cancel one
      const listRes = await app.request('/bookings')
      const allBookings = await listRes.json()
      await app.request(`/bookings/${allBookings.data[0].id}/cancel`, { method: 'POST' })

      // Query overlapping range with status=CONFIRMED
      const from = futureDate(20)
      const to = futureDate(50)
      const res = await app.request(
        `/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=CONFIRMED`,
      )
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].status).toBe('CONFIRMED')
    })

    it('returns 400 when from is provided without to', async () => {
      const res = await app.request(`/bookings?from=${encodeURIComponent(futureDate(1))}`)
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.error).toContain('"to"')
    })

    it('returns 400 for invalid date strings', async () => {
      const res = await app.request('/bookings?from=not-a-date&to=also-bad')
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.error).toContain('valid ISO dates')
    })

    it('returns 400 when to is before from', async () => {
      const from = futureDate(48)
      const to = futureDate(24)
      const res = await app.request(
        `/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.error).toContain('"to" must be after "from"')
    })

    it('returns bookings with vehicle data when expand=vehicle', async () => {
      await vehicleRepo.create({
        name: 'Toyota Corolla',
        description: 'A reliable sedan',
        photos: ['photo1.jpg', 'photo2.jpg'],
        seats: 5,
        transmission: 'AUTO',
        fuelType: 'Gasoline',
        status: 'AVAILABLE',
        bufferMinutes: 60,
        // No rental rules — this test verifies expand projection, not
        // rental-rules enforcement. Keep them null so the 24h booking from
        // validBookingInput doesn't flirt with the advance-booking boundary.
        minRentalHours: null,
        maxRentalHours: null,
        advanceBookingHours: null,
        // Rates required for server-side pricing (issue #74).
        dailyRateJpy: 10000,
        hourlyRateJpy: null,
      })

      const allVehicles = await vehicleRepo.findAll()
      const vehicleId = allVehicles[0]!.id

      await createBooking({
        ...validBookingInput(),
        vehicleId,
      })

      const res = await app.request('/bookings?expand=vehicle')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].vehicle).toBeDefined()
      expect(body.data[0].vehicle.name).toBe('Toyota Corolla')
      expect(body.data[0].vehicle.photos).toEqual(['photo1.jpg', 'photo2.jpg'])
    })

    it('returns bookings without vehicle data when expand is not set', async () => {
      await createBooking()

      const res = await app.request('/bookings')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].vehicle).toBeUndefined()
    })
  })

  describe('GET /bookings — cursor pagination', () => {
    async function createNBookings(n: number) {
      const ids: string[] = []
      for (let i = 0; i < n; i++) {
        const res = await app.request('/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicleId: `00000000-0000-4000-8000-00000000${String(i).padStart(4, '0')}`,
            renterId: USER1,
            startAt: futureDate(24),
            endAt: futureDate(48),
            source: 'DIRECT',
          }),
        })
        const body = await res.json()
        ids.push(body.data.id)
      }
      return ids
    }

    it('returns at most limit items and a nextCursor when more exist', async () => {
      await createNBookings(5)

      const res = await app.request('/bookings?limit=2')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
      expect(body.nextCursor).toBeDefined()
      expect(typeof body.nextCursor).toBe('string')
    })

    it('returns nextCursor null when no more results', async () => {
      await createNBookings(2)

      const res = await app.request('/bookings?limit=10')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
      expect(body.nextCursor).toBeNull()
    })

    it('pages through all results using nextCursor', async () => {
      await createNBookings(5)

      // Page 1
      const res1 = await app.request('/bookings?limit=2')
      const body1 = await res1.json()
      expect(body1.data).toHaveLength(2)
      expect(body1.nextCursor).toBeDefined()

      // Page 2
      const res2 = await app.request(`/bookings?limit=2&cursor=${body1.nextCursor}`)
      const body2 = await res2.json()
      expect(body2.data).toHaveLength(2)
      expect(body2.nextCursor).toBeDefined()

      // Page 3 (last item)
      const res3 = await app.request(`/bookings?limit=2&cursor=${body2.nextCursor}`)
      const body3 = await res3.json()
      expect(body3.data).toHaveLength(1)
      expect(body3.nextCursor).toBeNull()

      // No duplicates across pages
      const allIds = [
        ...body1.data.map((b: { id: string }) => b.id),
        ...body2.data.map((b: { id: string }) => b.id),
        ...body3.data.map((b: { id: string }) => b.id),
      ]
      expect(new Set(allIds).size).toBe(5)
    })

    it('combines pagination with status filter', async () => {
      await createNBookings(3)
      // Cancel the first one
      const allRes = await app.request('/bookings')
      const allBody = await allRes.json()
      const firstId = allBody.data[0].id
      await app.request(`/bookings/${firstId}/cancel`, { method: 'POST' })

      const res = await app.request('/bookings?status=CONFIRMED&limit=10')
      const body = await res.json()

      expect(body.data).toHaveLength(2)
      expect(body.data.every((b: { status: string }) => b.status === 'CONFIRMED')).toBe(true)
      expect(body.nextCursor).toBeNull()
    })

    it('defaults to 20 items when no limit specified', async () => {
      const res = await app.request('/bookings')
      const body = await res.json()

      // Existing behavior: returns all (empty here), with nextCursor null
      expect(body.nextCursor).toBeNull()
    })

    it('rejects limit > 100', async () => {
      const res = await app.request('/bookings?limit=200')
      expect(res.status).toBe(400)
    })

    it('rejects limit < 1', async () => {
      const res = await app.request('/bookings?limit=0')
      expect(res.status).toBe(400)
    })
  })

  describe('POST /bookings', () => {
    it('creates a booking with valid input and returns 201 with status CONFIRMED', async () => {
      const input = validBookingInput()
      const res = await createBooking(input)

      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.vehicleId).toBe(V1)
      expect(body.data.renterId).toBe(USER1)
      expect(body.data.status).toBe('CONFIRMED')
      expect(body.data.source).toBe('DIRECT')
      expect(body.data.externalId).toBeNull()
      expect(body.data.notes).toBeNull()
      expect(body.data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(body.data.createdAt).toBeDefined()
      expect(body.data.updatedAt).toBeDefined()
    })

    it('rejects invalid input with missing vehicleId and returns 400', async () => {
      const res = await app.request('/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          renterId: USER1,
          startAt: futureDate(24),
          endAt: futureDate(48),
        }),
      })

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBeDefined()
    })

    it('rejects non-UUID vehicleId with 400', async () => {
      const res = await createBooking({
        ...validBookingInput(),
        vehicleId: 'not-a-uuid',
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error.vehicleId[0]).toContain('UUID')
    })

    it('rejects invalid status string in PATCH /bookings/:id/status', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'BANANA' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('rejects endAt before startAt and returns 400', async () => {
      const res = await createBooking({
        ...validBookingInput(),
        startAt: futureDate(48),
        endAt: futureDate(24),
      })

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('returns 409 when the new booking overlaps an existing CONFIRMED booking on the same vehicle', async () => {
      const first = await createBooking()
      expect(first.status).toBe(201)

      const second = await createBooking({
        ...validBookingInput(),
        startAt: futureDate(36),
        endAt: futureDate(60),
      })

      expect(second.status).toBe(409)

      const body = await second.json()
      expect(body.success).toBe(false)
      expect(body.error).toMatch(/already booked/i)
    })

    it('allows overlapping booking on a different vehicle', async () => {
      const first = await createBooking()
      expect(first.status).toBe(201)

      const res = await createBooking({ ...validBookingInput(), vehicleId: V2 })
      expect(res.status).toBe(201)
    })

    it('allows a new booking once the conflicting one is CANCELLED', async () => {
      const first = await createBooking()
      const created = await first.json()

      await app.request(`/bookings/${created.data.id}/cancel`, { method: 'POST' })

      const res = await createBooking()
      expect(res.status).toBe(201)
    })

    // Issue #65: per-vehicle rental rules. Shared helper logic is unit-tested
    // in packages/shared/tests/lib/rental-rules.test.ts — these tests verify
    // the API route wires the helper correctly and returns the structured
    // error envelope the web client depends on.
    describe('rental rules enforcement', () => {
      async function seedVehicleWithRules(rules: {
        minRentalHours?: number | null
        maxRentalHours?: number | null
        advanceBookingHours?: number | null
      }) {
        const vehicle = await vehicleRepo.create({
          name: 'Toyota Alphard',
          description: null,
          photos: [],
          seats: 7,
          transmission: 'AUTO',
          fuelType: 'Hybrid',
          status: 'AVAILABLE',
          bufferMinutes: 60,
          minRentalHours: rules.minRentalHours ?? null,
          maxRentalHours: rules.maxRentalHours ?? null,
          advanceBookingHours: rules.advanceBookingHours ?? null,
          dailyRateJpy: 18000,
          hourlyRateJpy: 2500,
        })
        return vehicle.id
      }

      it('rejects a 2h booking on a vehicle with min 6h', async () => {
        const vehicleId = await seedVehicleWithRules({ minRentalHours: 6 })

        const res = await createBooking({
          ...validBookingInput(),
          vehicleId,
          startAt: futureDate(48),
          endAt: futureDate(50),
        })

        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.success).toBe(false)
        expect(body.code).toBe('RENTAL_RULE_MIN_DURATION')
        expect(body.details).toMatchObject({ required: 6 })
      })

      it('rejects a 100h booking on a vehicle with max 72h', async () => {
        const vehicleId = await seedVehicleWithRules({ maxRentalHours: 72 })

        const res = await createBooking({
          ...validBookingInput(),
          vehicleId,
          startAt: futureDate(48),
          endAt: futureDate(148),
        })

        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.success).toBe(false)
        expect(body.code).toBe('RENTAL_RULE_MAX_DURATION')
        expect(body.details).toMatchObject({ required: 72 })
      })

      it('rejects a same-day booking on a vehicle requiring 24h advance', async () => {
        const vehicleId = await seedVehicleWithRules({ advanceBookingHours: 24 })

        const res = await createBooking({
          ...validBookingInput(),
          vehicleId,
          startAt: futureDate(2),
          endAt: futureDate(26),
        })

        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.success).toBe(false)
        expect(body.code).toBe('RENTAL_RULE_ADVANCE_BOOKING')
        expect(body.details).toMatchObject({ required: 24 })
      })

      it('accepts a compliant booking on a vehicle with all three rules', async () => {
        const vehicleId = await seedVehicleWithRules({
          minRentalHours: 6,
          maxRentalHours: 240,
          advanceBookingHours: 24,
        })

        const res = await createBooking({
          ...validBookingInput(),
          vehicleId,
          startAt: futureDate(48),
          endAt: futureDate(96),
        })

        expect(res.status).toBe(201)
      })

      it('accepts a booking on a vehicle with no rules set', async () => {
        const vehicleId = await seedVehicleWithRules({})

        const res = await createBooking({
          ...validBookingInput(),
          vehicleId,
          startAt: futureDate(2),
          endAt: futureDate(3),
        })

        expect(res.status).toBe(201)
      })
    })

    describe('idempotency key', () => {
      it('returns 200 with the same booking when duplicate key is sent', async () => {
        const idempotencyKey = crypto.randomUUID()
        const input = { ...validBookingInput(), idempotencyKey }

        const first = await createBooking(input)
        expect(first.status).toBe(201)
        const firstBody = await first.json()

        const second = await createBooking(input)
        expect(second.status).toBe(200)
        const secondBody = await second.json()

        expect(secondBody.data.id).toBe(firstBody.data.id)
      })

      it('creates distinct bookings when different keys are sent', async () => {
        const first = await createBooking({
          ...validBookingInput(),
          idempotencyKey: crypto.randomUUID(),
          vehicleId: V1,
        })
        expect(first.status).toBe(201)
        const firstBody = await first.json()

        const second = await createBooking({
          ...validBookingInput(),
          idempotencyKey: crypto.randomUUID(),
          vehicleId: V2,
        })
        expect(second.status).toBe(201)
        const secondBody = await second.json()

        expect(secondBody.data.id).not.toBe(firstBody.data.id)
      })

      it('creates booking without idempotency key for backward compatibility', async () => {
        const res = await createBooking(validBookingInput())
        expect(res.status).toBe(201)

        const body = await res.json()
        expect(body.data.idempotencyKey).toBeNull()
      })

      it('returns 200 when concurrent duplicate key hits unique constraint', async () => {
        const idempotencyKey = crypto.randomUUID()
        const input = { ...validBookingInput(), idempotencyKey }

        // Simulate race: both requests pass findByIdempotencyKey check,
        // then both attempt create. Second one hits the unique constraint.
        const [r1, r2] = await Promise.all([
          createBooking(input),
          createBooking({ ...input, vehicleId: V2 }),
        ])

        const statuses = [r1.status, r2.status].sort()
        expect(statuses).toEqual([200, 201])

        const b1 = await r1.json()
        const b2 = await r2.json()
        expect(b1.data.id).toBe(b2.data.id)
      })
    })

    // Issue #74: server-side pricing. Clients must not be able to propose a
    // totalPrice — the route always computes it from the vehicle's rates.
    // Without this, a renter could submit {totalPrice: 1} and pay a 1 JPY
    // cancellation penalty on a 200,000 JPY booking.
    describe('server-side pricing', () => {
      async function seedVehicleWithRates(rates: {
        dailyRateJpy: number | null
        hourlyRateJpy: number | null
      }) {
        const vehicle = await vehicleRepo.create({
          name: 'Test Vehicle',
          description: null,
          photos: [],
          seats: 5,
          transmission: 'AUTO',
          fuelType: null,
          status: 'AVAILABLE',
          bufferMinutes: 60,
          minRentalHours: null,
          maxRentalHours: null,
          advanceBookingHours: null,
          dailyRateJpy: rates.dailyRateJpy,
          hourlyRateJpy: rates.hourlyRateJpy,
        })
        return vehicle.id
      }

      it('ignores client-supplied totalPrice and persists server calculation', async () => {
        // Vehicle: 10,000 JPY/day. 24h booking → server should compute 10,000.
        // Client tries to inject totalPrice: 1 — must be ignored.
        const vehicleId = await seedVehicleWithRates({
          dailyRateJpy: 10000,
          hourlyRateJpy: null,
        })

        const res = await app.request('/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vehicleId,
            renterId: USER1,
            startAt: futureDate(48),
            endAt: futureDate(72),
            source: 'DIRECT',
            totalPrice: 1, // attacker-controlled — must be ignored
          }),
        })

        expect(res.status).toBe(201)
        const body = await res.json()
        expect(body.success).toBe(true)
        expect(body.data.totalPrice).toBe(10000)
      })

      it('rejects booking when vehicle has no rates set with 400 NO_RATES_SET', async () => {
        const vehicleId = await seedVehicleWithRates({
          dailyRateJpy: null,
          hourlyRateJpy: null,
        })

        const res = await createBooking({
          ...validBookingInput(),
          vehicleId,
        })

        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.success).toBe(false)
        expect(body.code).toBe('NO_RATES_SET')
      })
    })
  })

  describe('GET /bookings/:id', () => {
    it('returns a specific booking', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}`)

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.id).toBe(created.data.id)
      expect(body.data.vehicleId).toBe(V1)
    })

    it('returns 404 for nonexistent booking', async () => {
      const res = await app.request('/bookings/nonexistent-id')

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Booking not found')
    })
  })

  describe('PATCH /bookings/:id/status', () => {
    it('transitions CONFIRMED to ACTIVE', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('ACTIVE')
      expect(body.data.id).toBe(created.data.id)
    })

    it('rejects invalid transition CONFIRMED to COMPLETED', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      })

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toContain('Invalid status transition')
    })

    it('rejects transition from terminal state CANCELLED', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      // First cancel the booking
      await app.request(`/bookings/${created.data.id}/cancel`, {
        method: 'POST',
      })

      // Then try to transition from CANCELLED
      const res = await app.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toContain('Invalid status transition')
    })

    it('returns 404 for nonexistent booking', async () => {
      const res = await app.request('/bookings/nonexistent-id/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Booking not found')
    })
  })

  describe('POST /bookings/:id/cancel', () => {
    it('cancels a CONFIRMED booking', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/cancel`, {
        method: 'POST',
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('CANCELLED')
      expect(body.data.id).toBe(created.data.id)
    })

    it('rejects cancelling an already COMPLETED booking with 409', async () => {
      const createRes = await createBooking()
      const created = await createRes.json()

      // Transition to ACTIVE then COMPLETED
      await app.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })
      await app.request(`/bookings/${created.data.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COMPLETED' }),
      })

      const res = await app.request(`/bookings/${created.data.id}/cancel`, {
        method: 'POST',
      })

      expect(res.status).toBe(409)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toContain('Only CONFIRMED bookings can be cancelled')
    })

    it('returns 404 for nonexistent booking', async () => {
      const res = await app.request('/bookings/nonexistent-id/cancel', {
        method: 'POST',
      })

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Booking not found')
    })

    // Issue #74: cancellation fee tests seed a vehicle with known rates so
    // the server-side pricing code produces a deterministic totalPrice for
    // the 24h booking (10,000 JPY/day × 1 day = 10,000). Clients can no
    // longer propose totalPrice on the request body.
    async function seedPricedVehicle() {
      const vehicle = await vehicleRepo.create({
        name: 'Priced Vehicle',
        description: null,
        photos: [],
        seats: 5,
        transmission: 'AUTO',
        fuelType: null,
        status: 'AVAILABLE',
        bufferMinutes: 60,
        minRentalHours: null,
        maxRentalHours: null,
        advanceBookingHours: null,
        dailyRateJpy: 10000,
        hourlyRateJpy: null,
      })
      return vehicle.id
    }

    it('returns FREE tier and 0 fee when cancelling 72h+ before pickup', async () => {
      const vehicleId = await seedPricedVehicle()
      const createRes = await createBooking({
        ...validBookingInput(),
        vehicleId,
        startAt: futureDate(96), // 96h from now
        endAt: futureDate(120),
      })
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/cancel`, {
        method: 'POST',
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.status).toBe('CANCELLED')
      expect(body.data.cancellationFee).toBe(0)
      expect(body.data.cancelledAt).toBeTruthy()
      expect(body.cancellation.tier).toBe('FREE')
      expect(body.cancellation.feePercentage).toBe(0)
      expect(body.cancellation.refundAmount).toBe(10000)
    })

    it('returns LOW tier and 30% fee when cancelling 48-72h before pickup', async () => {
      const vehicleId = await seedPricedVehicle()
      const createRes = await createBooking({
        ...validBookingInput(),
        vehicleId,
        startAt: futureDate(60), // 60h from now (between 48-72)
        endAt: futureDate(84),
      })
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/cancel`, {
        method: 'POST',
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.cancellationFee).toBe(3000)
      expect(body.cancellation.tier).toBe('LOW')
      expect(body.cancellation.feePercentage).toBe(0.3)
    })

    it('returns FULL tier and 100% fee when cancelling < 24h before pickup', async () => {
      const vehicleId = await seedPricedVehicle()
      const createRes = await createBooking({
        ...validBookingInput(),
        vehicleId,
        startAt: futureDate(12), // 12h from now
        endAt: futureDate(36),
      })
      const created = await createRes.json()

      const res = await app.request(`/bookings/${created.data.id}/cancel`, {
        method: 'POST',
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.cancellationFee).toBe(10000)
      expect(body.cancellation.tier).toBe('FULL')
      expect(body.cancellation.feePercentage).toBe(1)
      expect(body.cancellation.refundAmount).toBe(0)
    })
  })
})
