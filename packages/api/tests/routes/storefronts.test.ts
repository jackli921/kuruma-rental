import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryInsuranceOptionRepository,
  InMemoryLocationRepository,
  InMemoryOperatorRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { InsuranceOption, Location, Vehicle, VehicleClass } from '../../src/stores'
import { setupAuthEnv } from '../helpers/auth'

const FROM = '2026-08-01T10:00:00Z'
const TO = '2026-08-01T14:00:00Z'

function setup() {
  setupAuthEnv()
  const operatorRepo = new InMemoryOperatorRepository()
  const locationRepo = new InMemoryLocationRepository()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
    operatorRepo,
  )
  const vehicleClassRepo = new InMemoryVehicleClassRepository()
  const insuranceOptionRepo = new InMemoryInsuranceOptionRepository()
  const app = createApp({
    vehicleRepo,
    bookingRepo,
    availabilityRepo,
    vehicleClassRepo,
    locationRepo,
    operatorRepo,
    insuranceOptionRepo,
  })
  return { app, operatorRepo, locationRepo, vehicleRepo, vehicleClassRepo, insuranceOptionRepo }
}

type Ctx = ReturnType<typeof setup>

function makeOperator(ctx: Ctx, name: string, slug: string) {
  return ctx.operatorRepo.create({ name, slug, preAuthHandoffUrl: null })
}

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

function makeInsurance(
  ctx: Ctx,
  operatorId: string,
  overrides: Partial<Omit<InsuranceOption, 'id' | 'createdAt' | 'updatedAt'>> = {},
) {
  return ctx.insuranceOptionRepo.create({
    operatorId,
    name: 'CDW',
    description: null,
    dailyPriceJpy: 1500,
    deductibleJpy: null,
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
    licensePlate: null,
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

/** Seed one ACTIVE storefront with `vehicleCount` available CCAR vehicles. */
async function seedStorefront(ctx: Ctx, vehicleCount = 2) {
  const op = await makeOperator(ctx, 'Best Car Rental', 'best')
  const compact = await makeClass(ctx, op.id)
  const namba = await makeLocation(ctx, op.id, { name: 'Namba' })
  for (let i = 0; i < vehicleCount; i++) {
    await makeVehicle(ctx, {
      operatorId: op.id,
      classId: compact.id,
      pickupLocationId: namba.id,
    })
  }
  return { op, compact, namba }
}

describe('storefront routes (#391)', () => {
  describe('GET /storefronts/search (public)', () => {
    it('returns 200 without auth with storefront cards in the contract shape', async () => {
      const ctx = setup()
      await seedStorefront(ctx, 2)

      const res = await ctx.app.request(`/storefronts/search?from=${FROM}&to=${TO}`)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.storefronts).toHaveLength(1)
      const card = body.data.storefronts[0]
      expect(card.name).toBe('Namba')
      expect(card.operatorName).toBe('Best Car Rental')
      expect(card.classSummaries).toEqual([
        {
          acrissCode: 'CCAR',
          label: 'Compact',
          luggageCapacity: 2,
          luggageSize: 'MEDIUM',
          availableCount: 2,
        },
      ])
      expect(card.fromDailyPriceJpy).toBe(8000)
      expect(card.fromHourlyPriceJpy).toBeNull()
      expect(body.data.nextCursor).toBeNull()
    })

    it('sets a 10s public edge-cache header', async () => {
      const ctx = setup()
      await seedStorefront(ctx, 1)

      const res = await ctx.app.request(`/storefronts/search?from=${FROM}&to=${TO}`)

      expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=10')
    })

    it('returns 400 when from/to are missing', async () => {
      const ctx = setup()
      const res = await ctx.app.request('/storefronts/search')
      expect(res.status).toBe(400)
    })

    it('returns 400 when to <= from', async () => {
      const ctx = setup()
      const res = await ctx.app.request(`/storefronts/search?from=${TO}&to=${FROM}`)
      expect(res.status).toBe(400)
    })
  })

  describe('GET /storefronts/:locationId/vehicles (public)', () => {
    it('returns 200 with a renter-safe vehicle projection (no operator internals)', async () => {
      const ctx = setup()
      const { namba } = await seedStorefront(ctx, 1)

      const res = await ctx.app.request(`/storefronts/${namba.id}/vehicles?from=${FROM}&to=${TO}`)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.storefront.locationId).toBe(namba.id)
      expect(body.data.storefront.operatorName).toBe('Best Car Rental')
      expect(body.data.vehicles).toHaveLength(1)
      const vehicle = body.data.vehicles[0]
      expect(vehicle).toMatchObject({
        name: 'Toyota Yaris',
        acrissCode: 'CCAR',
        classLabel: 'Compact',
        dailyRateJpy: 8000,
      })
      // Renter-safe whitelist: operator internals must never leak (§5).
      expect(vehicle).not.toHaveProperty('shakenExpiryDate')
      expect(vehicle).not.toHaveProperty('insuranceExpiryDate')
      expect(vehicle).not.toHaveProperty('bufferMinutes')
      expect(vehicle).not.toHaveProperty('licensePlate')
      expect(vehicle).not.toHaveProperty('operatorId')
    })

    it('sets a 10s public edge-cache header on the detail response', async () => {
      const ctx = setup()
      const { namba } = await seedStorefront(ctx, 1)

      const res = await ctx.app.request(`/storefronts/${namba.id}/vehicles?from=${FROM}&to=${TO}`)

      expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=10')
    })

    it('returns 404 for an unknown locationId (does not cache the miss)', async () => {
      const ctx = setup()
      const res = await ctx.app.request(
        `/storefronts/00000000-0000-4000-8000-0000000000ff/vehicles?from=${FROM}&to=${TO}`,
      )
      expect(res.status).toBe(404)
      expect(res.headers.get('Cache-Control')).toBeNull()
    })

    it('returns 400 when from/to are missing', async () => {
      const ctx = setup()
      const { namba } = await seedStorefront(ctx, 1)
      const res = await ctx.app.request(`/storefronts/${namba.id}/vehicles`)
      expect(res.status).toBe(400)
    })
  })

  describe('GET /storefronts/:locationId/insurance-options (public, #392)', () => {
    it('returns 200 without auth with the operator ACTIVE options (renter-safe projection)', async () => {
      const ctx = setup()
      const { op, namba } = await seedStorefront(ctx, 1)
      await makeInsurance(ctx, op.id, {
        name: 'CDW',
        description: 'Collision damage waiver',
        dailyPriceJpy: 1500,
        deductibleJpy: 50000,
      })

      const res = await ctx.app.request(`/storefronts/${namba.id}/insurance-options`)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toEqual([
        {
          id: expect.any(String),
          name: 'CDW',
          description: 'Collision damage waiver',
          dailyPriceJpy: 1500,
          deductibleJpy: 50000,
        },
      ])
      // Operator internals must never leak on the public read.
      expect(body.data[0]).not.toHaveProperty('operatorId')
      expect(body.data[0]).not.toHaveProperty('status')
    })

    it('excludes ARCHIVED options and never another operator', async () => {
      const ctx = setup()
      const { op, namba } = await seedStorefront(ctx, 1)
      const other = await makeOperator(ctx, 'Other Co', 'other')
      await makeInsurance(ctx, op.id, { name: 'Active' })
      const archived = await makeInsurance(ctx, op.id, { name: 'Old' })
      await ctx.insuranceOptionRepo.archive(SYSTEM_CONTEXT, archived.id)
      await makeInsurance(ctx, other.id, { name: 'Foreign' })

      const res = await ctx.app.request(`/storefronts/${namba.id}/insurance-options`)

      const body = await res.json()
      expect(body.data.map((o: { name: string }) => o.name)).toEqual(['Active'])
    })

    it('sets a 10s public edge-cache header', async () => {
      const ctx = setup()
      const { namba } = await seedStorefront(ctx, 1)

      const res = await ctx.app.request(`/storefronts/${namba.id}/insurance-options`)

      expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=10')
    })

    it('returns 404 for an unknown locationId (does not cache the miss)', async () => {
      const ctx = setup()
      const res = await ctx.app.request(
        '/storefronts/00000000-0000-4000-8000-0000000000ff/insurance-options',
      )
      expect(res.status).toBe(404)
      expect(res.headers.get('Cache-Control')).toBeNull()
    })
  })
})
