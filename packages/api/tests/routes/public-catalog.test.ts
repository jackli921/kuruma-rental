import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryOperatorRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'

function vehicleInput(overrides?: Partial<{ classId: string | null; status: string }>) {
  return {
    classId: null,
    name: 'Test Car',
    description: null,
    photos: [] as string[],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'GASOLINE',
    licensePlate: null,
    status: 'AVAILABLE' as const,
    bufferMinutes: 60,
    minRentalHours: 1,
    maxRentalHours: 168,
    advanceBookingHours: 24,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 5000,
    hourlyRateJpy: 1000,
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
    ...overrides,
  }
}

function classInput(overrides?: Partial<{ slug: string; name: string }>) {
  return {
    name: 'Compact',
    slug: 'compact',
    description: null,
    photos: [] as string[],
    seats: 4,
    luggageCapacity: 2,
    transmission: 'AUTO' as const,
    fuelType: null,
    dailyRateJpy: 5000,
    hourlyRateJpy: 1000,
    sortOrder: 0,
    status: 'ACTIVE' as const,
    ...overrides,
  }
}

function createTestApp() {
  setupAuthEnv()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
    new InMemoryOperatorRepository(),
  )
  const vehicleClassRepo = new InMemoryVehicleClassRepository()
  const app = createApp({
    vehicleRepo,
    bookingRepo,
    availabilityRepo,
    vehicleClassRepo,
  })
  return { app, vehicleRepo, bookingRepo, vehicleClassRepo }
}

describe('public catalog endpoints', () => {
  describe('GET /vehicle-classes (public)', () => {
    it('returns 200 without auth and lists active classes', async () => {
      const ctx = createTestApp()
      await ctx.vehicleClassRepo.create(classInput())
      await ctx.vehicleClassRepo.create(classInput({ slug: 'suv', name: 'SUV' }))

      const res = await ctx.app.request('/vehicle-classes')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toHaveLength(2)
    })

    it('still works when caller is authenticated', async () => {
      const ctx = createTestApp()
      await ctx.vehicleClassRepo.create(classInput())
      const headers = await authHeaders()
      const res = await ctx.app.request('/vehicle-classes', { headers })
      expect(res.status).toBe(200)
    })
  })

  describe('GET /vehicle-classes/by-slug/:slug (public)', () => {
    it('returns 200 without auth', async () => {
      const ctx = createTestApp()
      await ctx.vehicleClassRepo.create(classInput())

      const res = await ctx.app.request('/vehicle-classes/by-slug/compact')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.slug).toBe('compact')
      expect(body.data.name).toBe('Compact')
    })

    it('returns 404 without auth for missing slug', async () => {
      const ctx = createTestApp()
      const res = await ctx.app.request('/vehicle-classes/by-slug/nope')
      expect(res.status).toBe(404)
    })
  })

  describe('protected vehicle-class routes still require auth', () => {
    it('POST /vehicle-classes is 401 without auth', async () => {
      const ctx = createTestApp()
      const res = await ctx.app.request('/vehicle-classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(classInput()),
      })
      expect(res.status).toBe(401)
    })

    it('GET /vehicle-classes/:id is 401 without auth (admin-only lookup)', async () => {
      const ctx = createTestApp()
      const vc = await ctx.vehicleClassRepo.create(classInput())
      const res = await ctx.app.request(`/vehicle-classes/${vc.id}`)
      expect(res.status).toBe(401)
    })

    it('PATCH /vehicle-classes/:id is 401 without auth', async () => {
      const ctx = createTestApp()
      const vc = await ctx.vehicleClassRepo.create(classInput())
      const res = await ctx.app.request(`/vehicle-classes/${vc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      })
      expect(res.status).toBe(401)
    })

    it('DELETE /vehicle-classes/:id is 401 without auth', async () => {
      const ctx = createTestApp()
      const vc = await ctx.vehicleClassRepo.create(classInput())
      const res = await ctx.app.request(`/vehicle-classes/${vc.id}`, { method: 'DELETE' })
      expect(res.status).toBe(401)
    })
  })

  describe('GET /vehicle-classes/:slug/availability (public)', () => {
    const FROM = '2026-05-01T00:00:00Z'
    const TO = '2026-05-03T00:00:00Z'

    it('returns 200 without auth with zero totalCars when class has no vehicles', async () => {
      const ctx = createTestApp()
      await ctx.vehicleClassRepo.create(classInput())

      const res = await ctx.app.request(
        `/vehicle-classes/compact/availability?from=${FROM}&to=${TO}`,
      )
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data).toEqual({
        totalCars: 0,
        availableCars: 0,
        sampleAvailableVehicleIds: [],
      })
    })

    it('returns totalCars=availableCars when no bookings conflict', async () => {
      const ctx = createTestApp()
      const vc = await ctx.vehicleClassRepo.create(classInput())
      const v1 = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ classId: vc.id }))
      const v2 = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ classId: vc.id }))

      const res = await ctx.app.request(
        `/vehicle-classes/compact/availability?from=${FROM}&to=${TO}`,
      )
      const { data } = await res.json()
      expect(data.totalCars).toBe(2)
      expect(data.availableCars).toBe(2)
      expect(data.sampleAvailableVehicleIds).toHaveLength(2)
      expect(new Set(data.sampleAvailableVehicleIds)).toEqual(new Set([v1.id, v2.id]))
    })

    it('excludes vehicles not in the class', async () => {
      const ctx = createTestApp()
      const vc = await ctx.vehicleClassRepo.create(classInput())
      const other = await ctx.vehicleClassRepo.create(classInput({ slug: 'suv', name: 'SUV' }))
      await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ classId: vc.id }))
      await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ classId: other.id }))

      const res = await ctx.app.request(
        `/vehicle-classes/compact/availability?from=${FROM}&to=${TO}`,
      )
      const { data } = await res.json()
      expect(data.totalCars).toBe(1)
      expect(data.availableCars).toBe(1)
    })

    it('subtracts bookings that fully overlap the window', async () => {
      const ctx = createTestApp()
      const vc = await ctx.vehicleClassRepo.create(classInput())
      const v1 = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ classId: vc.id }))
      const v2 = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ classId: vc.id }))

      // v1 is fully booked across the window
      const now = new Date()
      await ctx.bookingRepo.create(
        { userId: 'r1', role: 'ADMIN' },
        bookingInput({
          renterId: 'r1',
          assignedVehicleId: v1.id,
          startAt: new Date(FROM),
          endAt: new Date(TO),
          effectiveEndAt: new Date(TO),
          status: 'CONFIRMED',
          totalPrice: 10000,
        }),
      )

      const res = await ctx.app.request(
        `/vehicle-classes/compact/availability?from=${FROM}&to=${TO}`,
      )
      const { data } = await res.json()
      expect(data.totalCars).toBe(2)
      expect(data.availableCars).toBe(1)
      expect(data.sampleAvailableVehicleIds).toEqual([v2.id])
      // Keep reference to silence unused-var lints
      void now
    })

    it('counts partial overlaps as conflicts (effectiveEndAt respected)', async () => {
      const ctx = createTestApp()
      const vc = await ctx.vehicleClassRepo.create(classInput())
      const v1 = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ classId: vc.id }))

      // booking ends with 60-min buffer extending into the window
      await ctx.bookingRepo.create(
        { userId: 'r1', role: 'ADMIN' },
        bookingInput({
          renterId: 'r1',
          assignedVehicleId: v1.id,
          startAt: new Date('2026-04-30T20:00:00Z'),
          endAt: new Date('2026-05-01T01:00:00Z'),
          effectiveEndAt: new Date('2026-05-01T02:00:00Z'),
          status: 'CONFIRMED',
          totalPrice: 5000,
        }),
      )

      const res = await ctx.app.request(
        `/vehicle-classes/compact/availability?from=${FROM}&to=${TO}`,
      )
      const { data } = await res.json()
      expect(data.totalCars).toBe(1)
      expect(data.availableCars).toBe(0)
    })

    it('returns all-booked counts when every car in class is booked', async () => {
      const ctx = createTestApp()
      const vc = await ctx.vehicleClassRepo.create(classInput())
      const v1 = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ classId: vc.id }))
      const v2 = await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ classId: vc.id }))
      for (const id of [v1.id, v2.id]) {
        await ctx.bookingRepo.create(
          { userId: 'r1', role: 'ADMIN' },
          bookingInput({
            renterId: 'r1',
            assignedVehicleId: id,
            startAt: new Date(FROM),
            endAt: new Date(TO),
            effectiveEndAt: new Date(TO),
            status: 'CONFIRMED',
            totalPrice: 10000,
          }),
        )
      }

      const res = await ctx.app.request(
        `/vehicle-classes/compact/availability?from=${FROM}&to=${TO}`,
      )
      const { data } = await res.json()
      expect(data.totalCars).toBe(2)
      expect(data.availableCars).toBe(0)
      expect(data.sampleAvailableVehicleIds).toEqual([])
    })

    it('excludes RETIRED/MAINTENANCE vehicles from totalCars', async () => {
      const ctx = createTestApp()
      const vc = await ctx.vehicleClassRepo.create(classInput())
      await ctx.vehicleRepo.create(
        SYSTEM_CONTEXT,
        vehicleInput({ classId: vc.id, status: 'AVAILABLE' }),
      )
      await ctx.vehicleRepo.create(
        SYSTEM_CONTEXT,
        vehicleInput({ classId: vc.id, status: 'MAINTENANCE' }),
      )
      await ctx.vehicleRepo.create(
        SYSTEM_CONTEXT,
        vehicleInput({ classId: vc.id, status: 'RETIRED' }),
      )

      const res = await ctx.app.request(
        `/vehicle-classes/compact/availability?from=${FROM}&to=${TO}`,
      )
      const { data } = await res.json()
      expect(data.totalCars).toBe(1)
      expect(data.availableCars).toBe(1)
    })

    it('returns 404 for unknown class slug', async () => {
      const ctx = createTestApp()
      const res = await ctx.app.request(`/vehicle-classes/nope/availability?from=${FROM}&to=${TO}`)
      expect(res.status).toBe(404)
    })

    it('returns 400 when from/to missing', async () => {
      const ctx = createTestApp()
      await ctx.vehicleClassRepo.create(classInput())
      const res = await ctx.app.request('/vehicle-classes/compact/availability')
      expect(res.status).toBe(400)
    })

    it('returns 400 when to <= from', async () => {
      const ctx = createTestApp()
      await ctx.vehicleClassRepo.create(classInput())
      const res = await ctx.app.request(
        `/vehicle-classes/compact/availability?from=${TO}&to=${FROM}`,
      )
      expect(res.status).toBe(400)
    })

    it('caps sampleAvailableVehicleIds to 5 entries', async () => {
      const ctx = createTestApp()
      const vc = await ctx.vehicleClassRepo.create(classInput())
      for (let i = 0; i < 7; i++) {
        await ctx.vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput({ classId: vc.id }))
      }
      const res = await ctx.app.request(
        `/vehicle-classes/compact/availability?from=${FROM}&to=${TO}`,
      )
      const { data } = await res.json()
      expect(data.totalCars).toBe(7)
      expect(data.availableCars).toBe(7)
      expect(data.sampleAvailableVehicleIds).toHaveLength(5)
    })
  })
})
