import { describe, expect, it, beforeEach } from 'vitest'
import app from '../../src/index'
import { resetVehicleStore, getVehicleStore } from '../../src/stores'
import { resetBookingStore, getBookingStore } from '../../src/stores'

function createTestVehicle(overrides: Record<string, unknown> = {}) {
  const store = getVehicleStore()
  const id = crypto.randomUUID()
  const now = new Date()
  const vehicle = {
    id,
    name: 'Toyota Corolla',
    description: null,
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: null,
    status: 'AVAILABLE' as const,
    bufferMinutes: 30,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
  store.set(vehicle.id as string, vehicle as never)
  return vehicle
}

function createTestBooking(overrides: Record<string, unknown> = {}) {
  const store = getBookingStore()
  const id = crypto.randomUUID()
  const now = new Date()
  const booking = {
    id,
    renterId: 'user1',
    vehicleId: 'v1',
    startAt: new Date('2026-06-01T10:00:00Z'),
    endAt: new Date('2026-06-01T14:00:00Z'),
    status: 'CONFIRMED' as const,
    source: 'DIRECT' as const,
    externalId: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
  store.set(booking.id as string, booking as never)
  return booking
}

describe('Availability Routes', () => {
  beforeEach(() => {
    resetVehicleStore()
    resetBookingStore()
  })

  describe('GET /availability', () => {
    it('returns all available vehicles when no bookings exist', async () => {
      const v1 = createTestVehicle({ name: 'Car A' })
      const v2 = createTestVehicle({ name: 'Car B' })

      const res = await app.request(
        '/availability?from=2026-06-01T10:00:00Z&to=2026-06-01T14:00:00Z',
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)

      const ids = body.data.map((v: { id: string }) => v.id)
      expect(ids).toContain(v1.id)
      expect(ids).toContain(v2.id)
    })

    it('excludes vehicles with overlapping bookings', async () => {
      const vehicle = createTestVehicle()
      createTestBooking({
        vehicleId: vehicle.id,
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-01T14:00:00Z'),
        status: 'CONFIRMED',
      })

      const res = await app.request(
        '/availability?from=2026-06-01T12:00:00Z&to=2026-06-01T16:00:00Z',
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(0)
    })

    it('includes vehicles when no overlap exists', async () => {
      const vehicle = createTestVehicle()
      createTestBooking({
        vehicleId: vehicle.id,
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-01T14:00:00Z'),
        status: 'CONFIRMED',
      })

      // Query well after the booking ends (buffer is 30min default)
      const res = await app.request(
        '/availability?from=2026-06-01T16:00:00Z&to=2026-06-01T20:00:00Z',
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(vehicle.id)
    })

    it('accounts for buffer time after bookings', async () => {
      const vehicle = createTestVehicle({ bufferMinutes: 60 })
      createTestBooking({
        vehicleId: vehicle.id,
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-01T14:00:00Z'),
        status: 'CONFIRMED',
      })

      // 14:30 is within the buffer (14:00 + 60min = 15:00)
      const res1 = await app.request(
        '/availability?from=2026-06-01T14:30:00Z&to=2026-06-01T16:00:00Z',
      )
      const body1 = await res1.json()
      expect(body1.success).toBe(true)
      expect(body1.data).toHaveLength(0)

      // 15:30 is after the buffer ends
      const res2 = await app.request(
        '/availability?from=2026-06-01T15:30:00Z&to=2026-06-01T18:00:00Z',
      )
      const body2 = await res2.json()
      expect(body2.success).toBe(true)
      expect(body2.data).toHaveLength(1)
      expect(body2.data[0].id).toBe(vehicle.id)
    })

    it('ignores CANCELLED and COMPLETED bookings', async () => {
      const vehicle = createTestVehicle()
      createTestBooking({
        vehicleId: vehicle.id,
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-01T14:00:00Z'),
        status: 'CANCELLED',
      })
      createTestBooking({
        vehicleId: vehicle.id,
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-01T14:00:00Z'),
        status: 'COMPLETED',
      })

      const res = await app.request(
        '/availability?from=2026-06-01T12:00:00Z&to=2026-06-01T16:00:00Z',
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(vehicle.id)
    })

    it('excludes MAINTENANCE and RETIRED vehicles', async () => {
      createTestVehicle({ status: 'MAINTENANCE' })
      createTestVehicle({ status: 'RETIRED' })
      const available = createTestVehicle({ status: 'AVAILABLE' })

      const res = await app.request(
        '/availability?from=2026-06-01T10:00:00Z&to=2026-06-01T14:00:00Z',
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(available.id)
    })

    it('returns 400 for missing query params', async () => {
      const res1 = await app.request('/availability')
      expect(res1.status).toBe(400)

      const body1 = await res1.json()
      expect(body1.success).toBe(false)
      expect(body1.error).toBeDefined()

      const res2 = await app.request('/availability?from=2026-06-01T10:00:00Z')
      expect(res2.status).toBe(400)

      const res3 = await app.request('/availability?to=2026-06-01T14:00:00Z')
      expect(res3.status).toBe(400)
    })

    it('returns 400 when to is before from', async () => {
      const res = await app.request(
        '/availability?from=2026-06-01T14:00:00Z&to=2026-06-01T10:00:00Z',
      )

      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBeDefined()
    })
  })

  describe('GET /availability/:vehicleId', () => {
    it('returns available=true when vehicle is free', async () => {
      const vehicle = createTestVehicle()

      const res = await app.request(
        `/availability/${vehicle.id}?from=2026-06-01T10:00:00Z&to=2026-06-01T14:00:00Z`,
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.available).toBe(true)
      expect(body.data.vehicle.id).toBe(vehicle.id)
    })

    it('returns available=false with conflicts when booked', async () => {
      const vehicle = createTestVehicle()
      const booking = createTestBooking({
        vehicleId: vehicle.id,
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-01T14:00:00Z'),
        status: 'CONFIRMED',
      })

      const res = await app.request(
        `/availability/${vehicle.id}?from=2026-06-01T12:00:00Z&to=2026-06-01T16:00:00Z`,
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.available).toBe(false)
      expect(body.data.vehicle.id).toBe(vehicle.id)
      expect(body.data.conflicts).toHaveLength(1)
      expect(body.data.conflicts[0].id).toBe(booking.id)
    })

    it('returns 404 for nonexistent vehicle', async () => {
      const res = await app.request(
        '/availability/nonexistent?from=2026-06-01T10:00:00Z&to=2026-06-01T14:00:00Z',
      )

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Vehicle not found')
    })
  })
})
