import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryLocationRepository,
  InMemoryOperatorRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { Location, Vehicle, VehicleClass } from '../../src/stores'
import { setupAuthEnv } from '../helpers/auth'

const FROM = '2026-08-01T10:00:00Z'
const TO = '2026-08-01T14:00:00Z'

function setup() {
  setupAuthEnv()
  const operatorRepo = new InMemoryOperatorRepository()
  const locationRepo = new InMemoryLocationRepository()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  const vehicleClassRepo = new InMemoryVehicleClassRepository()
  const app = createApp({
    vehicleRepo,
    bookingRepo,
    availabilityRepo,
    vehicleClassRepo,
    locationRepo,
    operatorRepo,
  })
  return { app, operatorRepo, locationRepo, vehicleRepo, vehicleClassRepo }
}

type Ctx = ReturnType<typeof setup>

function makeClass(
  ctx: Ctx,
  operatorId: string,
  overrides: Partial<Omit<VehicleClass, 'id' | 'createdAt' | 'updatedAt'>> = {},
) {
  return ctx.vehicleClassRepo.create({
    operatorId,
    name: 'Compact',
    slug: `compact-${crypto.randomUUID().slice(0, 8)}`,
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: 'MEDIUM',
    transmission: 'AUTO',
    fuelType: null,
    acrissCode: 'CCAR',
    sortOrder: 0,
    status: 'ACTIVE',
    ...overrides,
  })
}

function makeLocation(
  ctx: Ctx,
  operatorId: string,
  overrides: Partial<Omit<Location, 'id' | 'createdAt' | 'updatedAt'>> = {},
) {
  return ctx.locationRepo.create({
    operatorId,
    name: 'Namba',
    address: '1-1 Namba, Osaka',
    operatingHours: { openTime: '09:00', closeTime: '20:00' },
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 60,
    status: 'ACTIVE',
    ...overrides,
  })
}

function makeVehicle(
  ctx: Ctx,
  overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>>,
) {
  return ctx.vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: 'op_a',
    classId: 'class_compact',
    pickupLocationId: 'loc_namba',
    name: 'Toyota Yaris',
    description: null,
    photos: [],
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: 'OSAKA 300 A 12-34',
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: 'Toyota',
    model: 'Yaris',
    year: 2023,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
    ...overrides,
  })
}

/** Seed one ACTIVE storefront with `vehicleCount` available CCAR cars at geocoded coords. */
async function seedStorefront(ctx: Ctx, vehicleCount = 2) {
  const op = await ctx.operatorRepo.create({
    name: 'Best Car Rental',
    slug: 'best',
    preAuthHandoffUrl: null,
  })
  const compact = await makeClass(ctx, op.id)
  const namba = await makeLocation(ctx, op.id, {
    name: 'Namba',
    latitude: 34.6627,
    longitude: 135.5023,
  })
  for (let i = 0; i < vehicleCount; i++) {
    await makeVehicle(ctx, { operatorId: op.id, classId: compact.id, pickupLocationId: namba.id })
  }
  return { op, compact, namba }
}

describe('flat search routes (#458)', () => {
  describe('GET /search/vehicles (public)', () => {
    it('returns 200 without auth with one SPECIFIC item per available car', async () => {
      const ctx = setup()
      await seedStorefront(ctx, 2)

      const res = await ctx.app.request(`/search/vehicles?from=${FROM}&to=${TO}`)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.items).toHaveLength(2)
      expect(body.data.items.every((i: { kind: string }) => i.kind === 'SPECIFIC')).toBe(true)
      expect(body.data.nextCursor).toBeNull()
    })

    it('projects the pickup location real coordinates onto each item (D2)', async () => {
      const ctx = setup()
      await seedStorefront(ctx, 1)

      const res = await ctx.app.request(`/search/vehicles?from=${FROM}&to=${TO}`)

      const body = await res.json()
      const item = body.data.items[0]
      expect(item).toMatchObject({
        kind: 'SPECIFIC',
        classLabel: 'Compact',
        acrissCode: 'CCAR',
        dailyRateJpy: 8000,
        make: 'Toyota',
        model: 'Yaris',
      })
      expect(item.vehicleId).toEqual(expect.any(String))
      expect(item.location).toMatchObject({
        name: 'Namba',
        operatorName: 'Best Car Rental',
        latitude: 34.6627,
        longitude: 135.5023,
      })
    })

    it('never leaks operator internals or the licence plate (D3 renter-safe)', async () => {
      const ctx = setup()
      await seedStorefront(ctx, 1)

      const res = await ctx.app.request(`/search/vehicles?from=${FROM}&to=${TO}`)

      const item = (await res.json()).data.items[0]
      expect(item).not.toHaveProperty('licensePlate')
      expect(item).not.toHaveProperty('bufferMinutes')
      expect(item).not.toHaveProperty('shakenExpiryDate')
      expect(item).not.toHaveProperty('insuranceExpiryDate')
      expect(item).not.toHaveProperty('operatorId')
    })

    it('filters to the requested ACRISS class only', async () => {
      const ctx = setup()
      const { op, namba } = await seedStorefront(ctx, 1)
      const suv = await makeClass(ctx, op.id, { name: 'SUV', acrissCode: 'IFAR' })
      await makeVehicle(ctx, {
        operatorId: op.id,
        classId: suv.id,
        pickupLocationId: namba.id,
        name: 'Toyota RAV4',
      })

      const res = await ctx.app.request(`/search/vehicles?from=${FROM}&to=${TO}&class=IFAR`)

      const body = await res.json()
      expect(body.data.items).toHaveLength(1)
      expect(body.data.items[0].acrissCode).toBe('IFAR')
    })

    it('sets a 10s public edge-cache header', async () => {
      const ctx = setup()
      await seedStorefront(ctx, 1)

      const res = await ctx.app.request(`/search/vehicles?from=${FROM}&to=${TO}`)

      expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=10')
    })

    it('returns a 400 envelope when from/to are missing', async () => {
      const ctx = setup()
      const res = await ctx.app.request('/search/vehicles')
      expect(res.status).toBe(400)
      expect((await res.json()).success).toBe(false)
    })

    it('returns 400 when to <= from', async () => {
      const ctx = setup()
      const res = await ctx.app.request(`/search/vehicles?from=${TO}&to=${FROM}`)
      expect(res.status).toBe(400)
    })

    it('returns 400 for a malformed cursor (never a 500)', async () => {
      const ctx = setup()
      await seedStorefront(ctx, 1)

      const res = await ctx.app.request(
        `/search/vehicles?from=${FROM}&to=${TO}&cursor=not%20base64%21`,
      )

      expect(res.status).toBe(400)
      expect((await res.json()).success).toBe(false)
    })
  })
})
