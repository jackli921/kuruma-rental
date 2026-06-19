import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { Booking, Vehicle } from '../../src/repositories/types'
import { createAvailabilityRoutes } from '../../src/routes/availability'
import { AvailabilityService } from '../../src/services/availability'
import { authHeaders, setupAuthEnv, testAuthMiddleware } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'

const AVAIL_QUERY = '/availability?from=2026-06-01T10:00:00Z&to=2026-06-01T14:00:00Z'

let app: Hono
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository
let availabilityRepo: InMemoryAvailabilityRepository

async function createTestVehicle(
  overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Promise<Vehicle> {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    name: 'Toyota Corolla',
    description: null,
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    bufferMinutes: 30,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
    ...overrides,
  })
}

async function createTestBooking(
  overrides: Partial<Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>> = {},
  bufferMinutes = 30,
): Promise<Booking> {
  const endAt = overrides.endAt ?? new Date('2026-06-01T14:00:00Z')
  // effectiveEndAt encodes the turnaround buffer that drives overlap exclusion;
  // preserve the endAt + bufferMinutes math unless a test pins it explicitly.
  const effectiveEndAt =
    overrides.effectiveEndAt ?? new Date(endAt.getTime() + bufferMinutes * 60 * 1000)
  return bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      renterId: 'user1',
      startAt: new Date('2026-06-01T10:00:00Z'),
      ...overrides,
      endAt,
      effectiveEndAt,
    }),
  )
}

describe('Availability Routes', () => {
  beforeEach(() => {
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
    app = new Hono()
    app.use('*', testAuthMiddleware('staff-user', 'PLATFORM_ADMIN'))
    app.route('/', createAvailabilityRoutes(new AvailabilityService(availabilityRepo)))
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
        assignedVehicleId: vehicle.id,
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
        assignedVehicleId: vehicle.id,
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
      await createTestBooking(
        {
          assignedVehicleId: vehicle.id,
          startAt: new Date('2026-06-01T10:00:00Z'),
          endAt: new Date('2026-06-01T14:00:00Z'),
          status: 'CONFIRMED',
        },
        60,
      )

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
        assignedVehicleId: vehicle.id,
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-01T14:00:00Z'),
        status: 'CANCELLED',
      })
      await createTestBooking({
        assignedVehicleId: vehicle.id,
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
        assignedVehicleId: vehicle.id,
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

    it('returns 404 for a valid-but-nonexistent vehicle id', async () => {
      const res = await app.request(
        '/availability/00000000-0000-4000-8000-0000000000ff?from=2026-06-01T10:00:00Z&to=2026-06-01T14:00:00Z',
      )

      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Vehicle not found')
    })

    it('returns 400 for a malformed (non-uuid) vehicle id', async () => {
      const res = await app.request(
        '/availability/nonexistent?from=2026-06-01T10:00:00Z&to=2026-06-01T14:00:00Z',
      )

      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('vehicleId must be a valid uuid')
    })

    it('strips conflict details for RENTER role', async () => {
      const renterApp = new Hono()
      renterApp.use('*', testAuthMiddleware('renter-user', 'RENTER'))
      renterApp.route('/', createAvailabilityRoutes(new AvailabilityService(availabilityRepo)))

      const vehicle = await createTestVehicle()
      await createTestBooking({
        assignedVehicleId: vehicle.id,
        renterId: 'other-renter',
        notes: 'secret internal note',
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-01T14:00:00Z'),
        status: 'CONFIRMED',
      })

      const res = await renterApp.request(
        `/availability/${vehicle.id}?from=2026-06-01T12:00:00Z&to=2026-06-01T16:00:00Z`,
      )

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.available).toBe(false)
      expect(body.data.conflicts).toHaveLength(1)

      const conflict = body.data.conflicts[0]
      // Should only have time window fields
      expect(Object.keys(conflict)).toEqual(['startAt', 'effectiveEndAt'])
      // Should NOT leak sensitive fields
      expect(conflict).not.toHaveProperty('id')
      expect(conflict).not.toHaveProperty('renterId')
      expect(conflict).not.toHaveProperty('notes')
      expect(conflict).not.toHaveProperty('status')
    })
  })
})

// The bare GET /availability path is gated by index.ts composition wiring, not the
// route layer above. Pin it through the real createApp() so the requireAuth mount
// can't silently regress (e.g. if the /availability/* wildcard it currently leans
// on were ever removed). See #739.
describe('GET /availability auth mount (#739)', () => {
  beforeEach(() => {
    setupAuthEnv()
  })

  it('401s an unauthenticated request to the bare /availability path', async () => {
    const res = await createApp().request(AVAIL_QUERY)

    expect(res.status).toBe(401)
  })

  it('does not 401 an authenticated request to the bare /availability path', async () => {
    const res = await createApp().request(AVAIL_QUERY, { headers: await authHeaders() })

    expect(res.status).not.toBe(401)
  })
})
