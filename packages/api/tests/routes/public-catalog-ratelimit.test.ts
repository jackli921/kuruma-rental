import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryOperatorRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleClassRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { setupAuthEnv } from '../helpers/auth'

function createFakeLimiter(limit: number): RateLimitBinding {
  const counts = new Map<string, number>()
  return {
    async limit({ key }) {
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      return { success: next <= limit }
    },
  }
}

function createTestApp(opts?: { publicCatalogLimiter?: RateLimitBinding }) {
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
  return {
    app: createApp({
      vehicleRepo,
      bookingRepo,
      availabilityRepo,
      vehicleClassRepo,
      publicCatalogLimiter: opts?.publicCatalogLimiter,
    }),
    vehicleClassRepo,
  }
}

describe('public catalog rate limiting', () => {
  it('returns 429 once per-IP public limit is exceeded', async () => {
    const ctx = createTestApp({ publicCatalogLimiter: createFakeLimiter(2) })
    await ctx.vehicleClassRepo.create({
      name: 'Compact',
      slug: 'compact',
      description: null,
      photos: [],
      seats: 4,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: 5000,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })
    const ip = { 'cf-connecting-ip': '1.2.3.4' }

    const a = await ctx.app.request('/vehicle-classes', { headers: ip })
    const b = await ctx.app.request('/vehicle-classes', { headers: ip })
    const c = await ctx.app.request('/vehicle-classes', { headers: ip })

    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(c.status).toBe(429)
  })

  it('applies to all three public endpoints under one bucket', async () => {
    const ctx = createTestApp({ publicCatalogLimiter: createFakeLimiter(2) })
    await ctx.vehicleClassRepo.create({
      name: 'Compact',
      slug: 'compact',
      description: null,
      photos: [],
      seats: 4,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: 5000,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })
    const ip = { 'cf-connecting-ip': '2.3.4.5' }

    const list = await ctx.app.request('/vehicle-classes', { headers: ip })
    const slug = await ctx.app.request('/vehicle-classes/by-slug/compact', { headers: ip })
    const avail = await ctx.app.request(
      '/vehicle-classes/compact/availability?from=2026-05-01T00:00:00Z&to=2026-05-02T00:00:00Z',
      { headers: ip },
    )

    expect(list.status).toBe(200)
    expect(slug.status).toBe(200)
    expect(avail.status).toBe(429)
  })

  it('keeps separate buckets per IP', async () => {
    const ctx = createTestApp({ publicCatalogLimiter: createFakeLimiter(1) })

    const a1 = await ctx.app.request('/vehicle-classes', {
      headers: { 'cf-connecting-ip': '10.0.0.1' },
    })
    const a2 = await ctx.app.request('/vehicle-classes', {
      headers: { 'cf-connecting-ip': '10.0.0.1' },
    })
    const b1 = await ctx.app.request('/vehicle-classes', {
      headers: { 'cf-connecting-ip': '10.0.0.2' },
    })

    expect(a1.status).toBe(200)
    expect(a2.status).toBe(429)
    expect(b1.status).toBe(200)
  })

  it('bypasses when no binding is injected (local dev)', async () => {
    const ctx = createTestApp()
    for (let i = 0; i < 5; i++) {
      const res = await ctx.app.request('/vehicle-classes')
      expect(res.status).toBe(200)
    }
  })
})
