import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { Vehicle } from '../../src/repositories/types'
import { createVehicleClassRoutes } from '../../src/routes/vehicle-classes'
import { VehicleClassService } from '../../src/services/vehicle-class'
import { testAuthMiddleware } from '../helpers/auth'

let app: Hono

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
    const repo = new InMemoryVehicleClassRepository()
    const service = new VehicleClassService(repo)
    app = new Hono()
    app.use('*', testAuthMiddleware('staff-user', 'STAFF'))
    app.route('/', createVehicleClassRoutes(service))
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
    it('archives the class', async () => {
      const createRes = await createClass()
      const { data: created } = await createRes.json()
      const res = await app.request(`/vehicle-classes/${created.id}`, { method: 'DELETE' })
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.status).toBe('ARCHIVED')
    })

    it('returns 404 for nonexistent', async () => {
      const res = await app.request('/vehicle-classes/missing', { method: 'DELETE' })
      expect(res.status).toBe(404)
    })
  })

  describe('Authorization', () => {
    it('RENTER can GET vehicle classes', async () => {
      const renterApp = new Hono()
      const repo = new InMemoryVehicleClassRepository()
      const service = new VehicleClassService(repo)
      renterApp.use('*', testAuthMiddleware('renter-user', 'RENTER'))
      renterApp.route('/', createVehicleClassRoutes(service))
      const res = await renterApp.request('/vehicle-classes')
      expect(res.status).toBe(200)
    })

    it('RENTER gets 403 on POST', async () => {
      const renterApp = new Hono()
      const repo = new InMemoryVehicleClassRepository()
      const service = new VehicleClassService(repo)
      renterApp.use('*', testAuthMiddleware('renter-user', 'RENTER'))
      renterApp.route('/', createVehicleClassRoutes(service))
      const res = await renterApp.request('/vehicle-classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validInput()),
      })
      expect(res.status).toBe(403)
    })
  })

  describe('Public access (no auth)', () => {
    function publicApp() {
      const repo = new InMemoryVehicleClassRepository()
      const service = new VehicleClassService(repo)
      const a = new Hono()
      // Deliberately NO auth middleware — renter catalog must be crawlable.
      a.route('/', createVehicleClassRoutes(service))
      return { app: a, service }
    }

    it('GET /vehicle-classes works unauthenticated', async () => {
      const { app: a } = publicApp()
      const res = await a.request('/vehicle-classes')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toEqual([])
    })

    it('GET /vehicle-classes/by-slug/:slug works unauthenticated', async () => {
      const { app: a, service } = publicApp()
      await service.create({
        name: 'Compact',
        slug: 'compact',
        description: null,
        photos: [],
        seats: 5,
        luggageCapacity: 2,
        transmission: 'AUTO',
        fuelType: null,
        dailyRateJpy: 5500,
        hourlyRateJpy: null,
        sortOrder: 0,
        status: 'ACTIVE',
      })
      const res = await a.request('/vehicle-classes/by-slug/compact')
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.slug).toBe('compact')
    })

    it('POST returns 401 unauthenticated', async () => {
      const { app: a } = publicApp()
      const res = await a.request('/vehicle-classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validInput()),
      })
      expect(res.status).toBe(401)
    })

    it('PATCH returns 401 unauthenticated', async () => {
      const { app: a } = publicApp()
      const res = await a.request('/vehicle-classes/any-id', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      })
      expect(res.status).toBe(401)
    })

    it('DELETE returns 401 unauthenticated', async () => {
      const { app: a } = publicApp()
      const res = await a.request('/vehicle-classes/any-id', { method: 'DELETE' })
      expect(res.status).toBe(401)
    })
  })

  describe('GET /vehicle-classes/by-slug/:slug/availability', () => {
    let classRepo: InMemoryVehicleClassRepository
    let vehicleRepo: InMemoryVehicleRepository
    let bookingRepo: InMemoryBookingRepository
    let avApp: Hono

    async function makeVehicle(
      classId: string,
      overrides: Partial<Vehicle> = {},
    ): Promise<Vehicle> {
      return vehicleRepo.create({
        classId,
        name: 'Car',
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
        ...overrides,
      })
    }

    beforeEach(async () => {
      classRepo = new InMemoryVehicleClassRepository()
      vehicleRepo = new InMemoryVehicleRepository()
      bookingRepo = new InMemoryBookingRepository()
      const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
      const service = new VehicleClassService(classRepo, availabilityRepo)
      avApp = new Hono()
      avApp.route('/', createVehicleClassRoutes(service))
      await service.create({
        name: 'Compact',
        slug: 'compact',
        description: null,
        photos: [],
        seats: 5,
        luggageCapacity: 2,
        transmission: 'AUTO',
        fuelType: null,
        dailyRateJpy: 5000,
        hourlyRateJpy: null,
        sortOrder: 0,
        status: 'ACTIVE',
      })
    })

    it('returns total=0, available=0 when no vehicles tagged to class', async () => {
      const res = await avApp.request(
        '/vehicle-classes/by-slug/compact/availability?from=2026-06-01T10:00:00Z&to=2026-06-02T10:00:00Z',
      )
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data).toMatchObject({ slug: 'compact', total: 0, available: 0 })
    })

    it('returns available = total when vehicles are free', async () => {
      const { data: vc } = await (await avApp.request('/vehicle-classes/by-slug/compact')).json()
      await makeVehicle(vc.id)
      await makeVehicle(vc.id)
      const res = await avApp.request(
        '/vehicle-classes/by-slug/compact/availability?from=2026-06-01T10:00:00Z&to=2026-06-02T10:00:00Z',
      )
      const { data } = await res.json()
      expect(data).toMatchObject({ total: 2, available: 2 })
    })

    it('subtracts vehicles with conflicting CONFIRMED bookings', async () => {
      const { data: vc } = await (await avApp.request('/vehicle-classes/by-slug/compact')).json()
      const v1 = await makeVehicle(vc.id)
      await makeVehicle(vc.id)
      await bookingRepo.create(SYSTEM_CONTEXT, {
        renterId: 'u1',
        vehicleId: v1.id,
        startAt: new Date('2026-06-01T12:00:00Z'),
        endAt: new Date('2026-06-01T16:00:00Z'),
        effectiveEndAt: new Date('2026-06-01T16:00:00Z'),
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
        totalPrice: null,
        cancellationFee: null,
        cancelledAt: null,
        idempotencyKey: null,
      })
      const res = await avApp.request(
        '/vehicle-classes/by-slug/compact/availability?from=2026-06-01T10:00:00Z&to=2026-06-02T10:00:00Z',
      )
      const { data } = await res.json()
      expect(data).toMatchObject({ total: 2, available: 1 })
    })

    it('MAINTENANCE vehicles count in total but not in available', async () => {
      const { data: vc } = await (await avApp.request('/vehicle-classes/by-slug/compact')).json()
      await makeVehicle(vc.id)
      await makeVehicle(vc.id, { status: 'MAINTENANCE' })
      const res = await avApp.request(
        '/vehicle-classes/by-slug/compact/availability?from=2026-06-01T10:00:00Z&to=2026-06-02T10:00:00Z',
      )
      const { data } = await res.json()
      expect(data).toMatchObject({ total: 2, available: 1 })
    })

    it('RETIRED vehicles are excluded from both counts', async () => {
      const { data: vc } = await (await avApp.request('/vehicle-classes/by-slug/compact')).json()
      await makeVehicle(vc.id)
      await makeVehicle(vc.id, { status: 'RETIRED' })
      const res = await avApp.request(
        '/vehicle-classes/by-slug/compact/availability?from=2026-06-01T10:00:00Z&to=2026-06-02T10:00:00Z',
      )
      const { data } = await res.json()
      expect(data).toMatchObject({ total: 1, available: 1 })
    })

    it('ignores vehicles in other classes', async () => {
      const { data: vc } = await (await avApp.request('/vehicle-classes/by-slug/compact')).json()
      await makeVehicle(vc.id)
      await makeVehicle('some-other-class')
      const res = await avApp.request(
        '/vehicle-classes/by-slug/compact/availability?from=2026-06-01T10:00:00Z&to=2026-06-02T10:00:00Z',
      )
      const { data } = await res.json()
      expect(data).toMatchObject({ total: 1, available: 1 })
    })

    it('CANCELLED bookings do not reduce availability', async () => {
      const { data: vc } = await (await avApp.request('/vehicle-classes/by-slug/compact')).json()
      const v1 = await makeVehicle(vc.id)
      await bookingRepo.create(SYSTEM_CONTEXT, {
        renterId: 'u1',
        vehicleId: v1.id,
        startAt: new Date('2026-06-01T12:00:00Z'),
        endAt: new Date('2026-06-01T16:00:00Z'),
        effectiveEndAt: new Date('2026-06-01T16:00:00Z'),
        status: 'CANCELLED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
        totalPrice: null,
        cancellationFee: null,
        cancelledAt: new Date(),
        idempotencyKey: null,
      })
      const res = await avApp.request(
        '/vehicle-classes/by-slug/compact/availability?from=2026-06-01T10:00:00Z&to=2026-06-02T10:00:00Z',
      )
      const { data } = await res.json()
      expect(data).toMatchObject({ total: 1, available: 1 })
    })

    it('returns 404 for unknown slug', async () => {
      const res = await avApp.request(
        '/vehicle-classes/by-slug/nonexistent/availability?from=2026-06-01T10:00:00Z&to=2026-06-02T10:00:00Z',
      )
      expect(res.status).toBe(404)
    })

    it('returns 400 for missing date range', async () => {
      const res = await avApp.request('/vehicle-classes/by-slug/compact/availability')
      expect(res.status).toBe(400)
    })

    it('is accessible without auth (public endpoint)', async () => {
      // No auth middleware mounted on avApp → unauthenticated request should succeed.
      const res = await avApp.request(
        '/vehicle-classes/by-slug/compact/availability?from=2026-06-01T10:00:00Z&to=2026-06-02T10:00:00Z',
      )
      expect(res.status).toBe(200)
    })
  })
})
