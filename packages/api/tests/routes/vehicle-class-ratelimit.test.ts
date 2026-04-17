import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'

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

function buildApp(publicCatalogLimiter?: RateLimitBinding) {
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
  return createApp({
    vehicleRepo,
    bookingRepo,
    availabilityRepo,
    publicCatalogLimiter,
  })
}

describe('public catalog rate limiting', () => {
  it('allows requests under the limit', async () => {
    const app = buildApp(createFakeLimiter(3))
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/vehicle-classes', {
        headers: { 'cf-connecting-ip': '1.2.3.4' },
      })
      expect(res.status).toBe(200)
    }
  })

  it('returns 429 after exceeding the per-IP limit', async () => {
    const app = buildApp(createFakeLimiter(2))
    for (let i = 0; i < 2; i++) {
      const res = await app.request('/vehicle-classes', {
        headers: { 'cf-connecting-ip': '9.9.9.9' },
      })
      expect(res.status).toBe(200)
    }
    const res = await app.request('/vehicle-classes', {
      headers: { 'cf-connecting-ip': '9.9.9.9' },
    })
    expect(res.status).toBe(429)
  })

  it('isolates buckets by IP', async () => {
    const app = buildApp(createFakeLimiter(1))
    const first = await app.request('/vehicle-classes', {
      headers: { 'cf-connecting-ip': '1.1.1.1' },
    })
    expect(first.status).toBe(200)
    const otherIp = await app.request('/vehicle-classes', {
      headers: { 'cf-connecting-ip': '2.2.2.2' },
    })
    expect(otherIp.status).toBe(200)
  })

  it('does not rate-limit when binding is absent', async () => {
    const app = buildApp()
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/vehicle-classes', {
        headers: { 'cf-connecting-ip': '3.3.3.3' },
      })
      expect(res.status).toBe(200)
    }
  })
})
