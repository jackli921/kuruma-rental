import { describe, expect, it, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createAvailabilityRoutes } from '../../src/routes/availability'
import {
  InMemoryVehicleRepository,
  InMemoryBookingRepository,
  InMemoryAvailabilityRepository,
} from '../../src/repositories/in-memory'
import type { Vehicle, Booking } from '../../src/repositories/types'

let app: Hono
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository

async function createTestVehicle(
  overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Promise<Vehicle> {
  return vehicleRepo.create({
    name: 'Toyota Corolla',
    description: null,
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    status: 'AVAILABLE',
    bufferMinutes: 30,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    ...overrides,
  })
}

async function createTestBooking(
  overrides: Partial<Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>> = {},
  bufferMinutes = 30,
): Promise<Booking> {
  const endAt = overrides.endAt ?? new Date('2026-06-01T14:00:00Z')
  const effectiveEndAt = overrides.effectiveEndAt ?? new Date(endAt.getTime() + bufferMinutes * 60 * 1000)
  return bookingRepo.create({
    renterId: 'user1',
    vehicleId: 'v1',
    startAt: new Date('2026-06-01T10:00:00Z'),
    endAt,
    effectiveEndAt,
    status: 'CONFIRMED',
    source: 'DIRECT',
    externalId: null,
    notes: null,
    ...overrides,
  })
}

describe('Availability Routes', () => {
  beforeEach(() => {
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    const availabilityRepo = new InMemoryAvailabilityRepository(
      vehicleRepo,
      bookingRepo,
    )
    app = new Hono()
    app.route('/', createAvailabilityRoutes(availabilityRepo))
  })

  describe('GET /availability', () => {
    it('returns all available vehicles when no bookings exist', async () => {
      const v1 = await createTestVehicle({ name: 'Car A' })
      const v2 = await createTestVehicle({ name: 'Car B' })

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
      const vehicle = await createTestVehicle()
      await createTestBooking({
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
      const vehicle = await createTestVehicle()
      await createTestBooking({
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
      const vehicle = await createTestVehicle({ bufferMinutes: 60 })
      await createTestBooking({
        vehicleId: vehicle.id,
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-01T14:00:00Z'),
        status: 'CONFIRMED',
      }, 60)

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
      const vehicle = await createTestVehicle()
      await createTestBooking({
        vehicleId: vehicle.id,
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-01T14:00:00Z'),
        status: 'CANCELLED',
      })
      await createTestBooking({
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
      await createTestVehicle({ status: 'MAINTENANCE' })
      await createTestVehicle({ status: 'RETIRED' })
      const available = await createTestVehicle({ status: 'AVAILABLE' })

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
      const vehicle = await createTestVehicle()

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
      const vehicle = await createTestVehicle()
      const booking = await createTestBooking({
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
