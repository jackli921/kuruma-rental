import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

const fakeLimiter = () => ({ limit: vi.fn(async () => ({ success: true })) })

describe('rate limiting wiring', () => {
  it('app starts without rate limit binding (local dev)', async () => {
    const app = createApp()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
  })

  it('all endpoints respond when no rate limit binding is present', async () => {
    setupAuthEnv()
    const app = createApp()
    const headers = await authHeaders()

    const vehicles = await app.request('/vehicles', { headers })
    expect(vehicles.status).toBe(200)

    const health = await app.request('/health')
    expect(health.status).toBe(200)
  })
})

// #580: every public limiter must fail CLOSED on an unresolvable IP. The
// underlying limiter bypasses entirely on an empty key, so a missing IP must
// 429 rather than fall through to a shared '' bucket (#563 generalized).
describe('fail-closed rate limiting (#580)', () => {
  function buildApp(extra: {
    publicCatalogLimiter?: RateLimitBinding
    globalRateLimiter?: RateLimitBinding
  }) {
    const vehicleRepo = new InMemoryVehicleRepository()
    const bookingRepo = new InMemoryBookingRepository()
    const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
    return createApp({ vehicleRepo, bookingRepo, availabilityRepo, ...extra })
  }

  it('public catalog route 429s when no client IP resolves — limiter never consulted', async () => {
    const limiter = fakeLimiter()
    const res = await buildApp({ publicCatalogLimiter: limiter }).request('/search/vehicles')
    expect(res.status).toBe(429)
    // An empty key would be silently bypassed — proving we never reach it.
    expect(limiter.limit).not.toHaveBeenCalled()
  })

  it('public catalog route consults the limiter on the resolved IP', async () => {
    const limiter = fakeLimiter()
    const res = await buildApp({ publicCatalogLimiter: limiter }).request(
      '/search/vehicles?from=2026-07-01T00:00:00Z&to=2026-07-02T00:00:00Z',
      { headers: { 'cf-connecting-ip': '203.0.113.9' } },
    )
    expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.9' })
    expect(res.status).toBe(200)
  })

  describe('global limiter', () => {
    it('429s every path when no client IP resolves', async () => {
      const limiter = fakeLimiter()
      // Inject the app-wide limiter via overrides instead of mutating the shared
      // globalThis.RATE_LIMITER: a process-global write races any parallel suite
      // that builds its own app, and createApp reads it (#672).
      const res = await buildApp({ globalRateLimiter: limiter }).request('/health')
      expect(res.status).toBe(429)
      expect(limiter.limit).not.toHaveBeenCalled()
    })
  })
})
