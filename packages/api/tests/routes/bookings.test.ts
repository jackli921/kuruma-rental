import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { createBookingRoutes } from '../../src/routes/bookings'
import { BookingService } from '../../src/services/booking'

let app: Hono
let vehicleRepo: InMemoryVehicleRepository

function futureDate(hoursFromNow: number): string {
  const d = new Date()
  d.setHours(d.getHours() + hoursFromNow)
  return d.toISOString()
}

function validBookingInput() {
  return {
    vehicleId: 'v1',
    renterId: 'user1',
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
    const repo = new InMemoryBookingRepository()
    const service = new BookingService(repo, vehicleRepo)
    app = new Hono()
    app.route('/', createBookingRoutes(service))
  })

  describe('GET /bookings', () => {
    it('returns empty list initially', async () => {
      const res = await app.request('/bookings')

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toEqual({ success: true, data: [] })
    })

    it('returns created bookings', async () => {
      await createBooking()
      await createBooking({
        ...validBookingInput(),
        vehicleId: 'v2',
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
        vehicleId: 'v2',
      })

      const res = await app.request('/bookings?vehicleId=v1')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].vehicleId).toBe('v1')
    })

    it('filters by renterId', async () => {
      await createBooking()
      await createBooking({
        ...validBookingInput(),
        renterId: 'user2',
        vehicleId: 'v2',
      })

      const res = await app.request('/bookings?renterId=user1')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].renterId).toBe('user1')
    })

    it('filters by renterId returning empty when no match', async () => {
      await createBooking()

      const res = await app.request('/bookings?renterId=nonexistent')
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(0)
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
        vehicleId: 'v2',
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

  describe('POST /bookings', () => {
    it('creates a booking with valid input and returns 201 with status CONFIRMED', async () => {
      const input = validBookingInput()
      const res = await createBooking(input)

      expect(res.status).toBe(201)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.vehicleId).toBe('v1')
      expect(body.data.renterId).toBe('user1')
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
          renterId: 'user1',
          startAt: futureDate(24),
          endAt: futureDate(48),
        }),
      })

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBeDefined()
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

      const res = await createBooking({ ...validBookingInput(), vehicleId: 'v2' })
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
            renterId: 'user1',
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
      expect(body.data.vehicleId).toBe('v1')
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
