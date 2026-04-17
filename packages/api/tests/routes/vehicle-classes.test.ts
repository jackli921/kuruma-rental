import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { createVehicleClassRoutes } from '../../src/routes/vehicle-classes'
import { VehicleClassService } from '../../src/services/vehicle-class'
import { VehicleClassAvailabilityService } from '../../src/services/vehicle-class-availability'
import { testAuthMiddleware } from '../helpers/auth'

function buildAvailabilityService(classRepo: InMemoryVehicleClassRepository) {
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  return new VehicleClassAvailabilityService(classRepo, vehicleRepo, availabilityRepo)
}

let app: Hono
let classRepo: InMemoryVehicleClassRepository
let vehicleRepo: InMemoryVehicleRepository
let bookingRepo: InMemoryBookingRepository

function makeService() {
  return new VehicleClassService(classRepo, vehicleRepo, bookingRepo)
}

function validInput() {
  return {
    name: 'Compact',
    slug: 'compact',
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO' as const,
    dailyRateJpy: 5500,
  }
}

async function createClass(input = validInput()) {
  return app.request('/vehicle-classes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

describe('Vehicle Class CRUD Routes', () => {
  beforeEach(() => {
    classRepo = new InMemoryVehicleClassRepository()
    vehicleRepo = new InMemoryVehicleRepository()
    bookingRepo = new InMemoryBookingRepository()
    const availabilityService = buildAvailabilityService(classRepo)
    app = new Hono()
    app.use('*', testAuthMiddleware('staff-user', 'STAFF'))
    app.route('/', createVehicleClassRoutes(makeService(), availabilityService))
  })

  describe('GET /vehicle-classes', () => {
    it('returns empty list initially', async () => {
      const res = await app.request('/vehicle-classes')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toEqual([])
    })

    it('returns created classes', async () => {
      await createClass()
      await createClass({ ...validInput(), name: 'SUV', slug: 'suv' })
      const res = await app.request('/vehicle-classes')
      const body = await res.json()
      expect(body.data).toHaveLength(2)
    })

    it('excludes archived classes by default', async () => {
      const createRes = await createClass()
      const { data } = await createRes.json()
      await app.request(`/vehicle-classes/${data.id}`, { method: 'DELETE' })
      const res = await app.request('/vehicle-classes')
      const body = await res.json()
      expect(body.data).toHaveLength(0)
    })
  })

  describe('POST /vehicle-classes', () => {
    it('creates with 201 and returns the class', async () => {
      const res = await createClass()
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.name).toBe('Compact')
      expect(body.data.slug).toBe('compact')
      expect(body.data.seats).toBe(5)
      expect(body.data.id).toBeDefined()
    })

    it('defaults photos to empty array and sortOrder to 0', async () => {
      const res = await createClass()
      const { data } = await res.json()
      expect(data.photos).toEqual([])
      expect(data.sortOrder).toBe(0)
    })

    it('rejects missing required fields', async () => {
      const res = await app.request('/vehicle-classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects duplicate slug with 409', async () => {
      await createClass()
      const res = await createClass()
      expect(res.status).toBe(409)
    })

    it('rejects when both rates missing', async () => {
      const res = await createClass({
        ...validInput(),
        slug: 'no-rate',
        dailyRateJpy: undefined as unknown as number,
      })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /vehicle-classes/:id', () => {
    it('returns the class by ID', async () => {
      const createRes = await createClass()
      const { data: created } = await createRes.json()
      const res = await app.request(`/vehicle-classes/${created.id}`)
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.slug).toBe('compact')
    })

    it('returns 404 for nonexistent', async () => {
      const res = await app.request('/vehicle-classes/nonexistent-id')
      expect(res.status).toBe(404)
    })
  })

  describe('GET /vehicle-classes/by-slug/:slug', () => {
    it('returns the class by slug', async () => {
      await createClass()
      const res = await app.request('/vehicle-classes/by-slug/compact')
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.name).toBe('Compact')
    })

    it('returns 404 for nonexistent slug', async () => {
      const res = await app.request('/vehicle-classes/by-slug/nonexistent')
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /vehicle-classes/:id', () => {
    it('updates fields', async () => {
      const createRes = await createClass()
      const { data: created } = await createRes.json()
      const res = await app.request(`/vehicle-classes/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Economy' }),
      })
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.name).toBe('Economy')
      expect(data.slug).toBe('compact')
    })

    it('returns 404 for nonexistent', async () => {
      const res = await app.request('/vehicle-classes/missing-id', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      })
      expect(res.status).toBe(404)
    })

    it('returns 409 for slug collision', async () => {
      await createClass()
      const res2 = await createClass({ ...validInput(), name: 'SUV', slug: 'suv' })
      const { data: suv } = await res2.json()
      const res = await app.request(`/vehicle-classes/${suv.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'compact' }),
      })
      expect(res.status).toBe(409)
    })

    it('returns 400 when both rates nullified', async () => {
      const createRes = await createClass()
      const { data: created } = await createRes.json()
      const res = await app.request(`/vehicle-classes/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyRateJpy: null, hourlyRateJpy: null }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /vehicle-classes/:id', () => {
    async function makeVehicle(classId: string) {
      return vehicleRepo.create({
        classId,
        name: 'Test Car',
        description: null,
        photos: [],
        seats: 5,
        transmission: 'AUTO',
        fuelType: null,
        licensePlate: null,
        status: 'AVAILABLE',
        bufferMinutes: 0,
        minRentalHours: null,
        maxRentalHours: null,
        advanceBookingHours: null,
        make: null,
        model: null,
        year: null,
        color: null,
        dailyRateJpy: 5000,
        hourlyRateJpy: null,
        shakenExpiryDate: null,
        insuranceExpiryDate: null,
      })
    }

    async function makeBooking(
      vehicleId: string,
      status: 'CONFIRMED' | 'ACTIVE' | 'CANCELLED' | 'COMPLETED',
    ) {
      return bookingRepo.create(SYSTEM_CONTEXT, {
        renterId: 'user-1',
        vehicleId,
        startAt: new Date('2026-06-01T10:00:00Z'),
        endAt: new Date('2026-06-01T14:00:00Z'),
        effectiveEndAt: new Date('2026-06-01T14:00:00Z'),
        status,
        source: 'DIRECT',
        externalId: null,
        notes: null,
        totalPrice: null,
        cancellationFee: null,
        cancelledAt: status === 'CANCELLED' ? new Date() : null,
        idempotencyKey: null,
      })
    }

    it('archives the class when no vehicles or bookings exist', async () => {
      const createRes = await createClass()
      const { data: created } = await createRes.json()
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.status).toBe('ARCHIVED')
    })

    it('archives the class when member vehicles have no active bookings', async () => {
      const { data: created } = await (await createClass()).json()
      await makeVehicle(created.id)
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
    })

    it('returns 409 with CLASS_HAS_ACTIVE_BOOKINGS when a member has a CONFIRMED booking', async () => {
      const { data: created } = await (await createClass()).json()
      const v = await makeVehicle(created.id)
      await makeBooking(v.id, 'CONFIRMED')
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.code).toBe('CLASS_HAS_ACTIVE_BOOKINGS')
      expect(body.activeBookingsCount).toBe(1)
    })

    it('returns 409 when a member has an ACTIVE booking', async () => {
      const { data: created } = await (await createClass()).json()
      const v = await makeVehicle(created.id)
      await makeBooking(v.id, 'ACTIVE')
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
    })

    it('allows archive when bookings are CANCELLED or COMPLETED', async () => {
      const { data: created } = await (await createClass()).json()
      const v = await makeVehicle(created.id)
      await makeBooking(v.id, 'CANCELLED')
      await makeBooking(v.id, 'COMPLETED')
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
    })

    it('counts bookings across multiple member vehicles', async () => {
      const { data: created } = await (await createClass()).json()
      const v1 = await makeVehicle(created.id)
      const v2 = await makeVehicle(created.id)
      await makeBooking(v1.id, 'CONFIRMED')
      await makeBooking(v2.id, 'ACTIVE')
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.activeBookingsCount).toBe(2)
    })

    it('blocks archive when a RETIRED member vehicle has an active booking', async () => {
      // A retired car can still have a future CONFIRMED booking — the owner
      // retired the vehicle but hasn't cancelled/reassigned the booking yet.
      // Archiving the class before that is resolved would leave an orphan.
      const { data: created } = await (await createClass()).json()
      const v = await makeVehicle(created.id)
      await makeBooking(v.id, 'CONFIRMED')
      await vehicleRepo.softDelete(v.id)
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.activeBookingsCount).toBe(1)
    })

    it('ignores active bookings on vehicles in a different class', async () => {
      const { data: created } = await (await createClass()).json()
      const other = await (await createClass({ ...validInput(), slug: 'suv', name: 'SUV' })).json()
      const v = await makeVehicle(other.data.id)
      await makeBooking(v.id, 'CONFIRMED')
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
    })

    it('returns 404 for nonexistent', async () => {
      const res = await app.request('/vehicle-classes/missing', { method: 'DELETE' })
      expect(res.status).toBe(404)
    })
  })

  describe('Authorization', () => {
    it('RENTER can GET vehicle classes', async () => {
      const renterApp = new Hono()
      const localClassRepo = new InMemoryVehicleClassRepository()
      const localVehicleRepo = new InMemoryVehicleRepository()
      const localBookingRepo = new InMemoryBookingRepository()
      const service = new VehicleClassService(localClassRepo, localVehicleRepo, localBookingRepo)
      const availabilityService = buildAvailabilityService(localClassRepo)
      renterApp.use('*', testAuthMiddleware('renter-user', 'RENTER'))
      renterApp.route('/', createVehicleClassRoutes(service, availabilityService))
      const res = await renterApp.request('/vehicle-classes')
      expect(res.status).toBe(200)
    })

    it('RENTER gets 403 on POST', async () => {
      const renterApp = new Hono()
      const localClassRepo = new InMemoryVehicleClassRepository()
      const localVehicleRepo = new InMemoryVehicleRepository()
      const localBookingRepo = new InMemoryBookingRepository()
      const service = new VehicleClassService(localClassRepo, localVehicleRepo, localBookingRepo)
      const availabilityService = buildAvailabilityService(localClassRepo)
      renterApp.use('*', testAuthMiddleware('renter-user', 'RENTER'))
      renterApp.route('/', createVehicleClassRoutes(service, availabilityService))
      const res = await renterApp.request('/vehicle-classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validInput()),
      })
      expect(res.status).toBe(403)
    })
  })
})
