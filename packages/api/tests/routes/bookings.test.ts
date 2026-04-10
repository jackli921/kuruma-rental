import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryBookingRepository, InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import { createBookingRoutes } from '../../src/routes/bookings'

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
    app = new Hono()
    app.route('/', createBookingRoutes(repo, vehicleRepo))
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
        minRentalHours: 4,
        maxRentalHours: 168,
        advanceBookingHours: 24,
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

    it('rejects cancelling an already COMPLETED booking', async () => {
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

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toContain('Invalid status transition')
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
  })
})
