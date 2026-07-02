import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryOperatorRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { authHeaders, setupAuthEnv } from '../helpers/auth'

// #672: each test here needs distinct construction-time wiring (per-test limiter
// overrides; the global-limiter test reads globalThis.RATE_LIMITER at build time),
// so one-app-per-file reuse isn't clean. Bare createApp() still builds the full
// graph, which under 2-core CI contention can tip a request past the default 5s
// timeout — so widen the budget for this file rather than mask it elsewhere.
vi.setConfig({ testTimeout: 15_000, hookTimeout: 15_000 })

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
  function appWithCatalogLimiter(limiter: RateLimitBinding) {
    const vehicleRepo = new InMemoryVehicleRepository()
    const bookingRepo = new InMemoryBookingRepository()
    const availabilityRepo = new InMemoryAvailabilityRepository(
      vehicleRepo,
      bookingRepo,
      new InMemoryVehicleBlockRepository(),
      new InMemoryOperatorRepository(),
    )
    return createApp({ vehicleRepo, bookingRepo, availabilityRepo, publicCatalogLimiter: limiter })
  }

  it('public catalog route 429s when no client IP resolves — limiter never consulted', async () => {
    const limiter = fakeLimiter()
    const res = await appWithCatalogLimiter(limiter).request('/search/vehicles')
    expect(res.status).toBe(429)
    // An empty key would be silently bypassed — proving we never reach it.
    expect(limiter.limit).not.toHaveBeenCalled()
  })

  it('public catalog route consults the limiter on the resolved IP', async () => {
    const limiter = fakeLimiter()
    const res = await appWithCatalogLimiter(limiter).request(
      '/search/vehicles?from=2026-07-01T00:00:00Z&to=2026-07-02T00:00:00Z',
      { headers: { 'cf-connecting-ip': '203.0.113.9' } },
    )
    expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.9' })
    expect(res.status).toBe(200)
  })

  describe('global limiter', () => {
    afterEach(() => {
      // createApp gates on truthiness, so clearing to undefined disables it.
      ;(globalThis as Record<string, unknown>).RATE_LIMITER = undefined
    })

    it('429s every path when no client IP resolves', async () => {
      const limiter = fakeLimiter()
      ;(globalThis as Record<string, unknown>).RATE_LIMITER = limiter
      const res = await createApp().request('/health')
      expect(res.status).toBe(429)
      expect(limiter.limit).not.toHaveBeenCalled()
    })
  })
})

// #1377: /webhooks/stripe is signature-gated (constructEventAsync) and arrives
// from a small fixed set of Stripe source IPs that collapse into ONE per-IP
// bucket. A per-IP budget there risks 429-dropping money-critical
// `checkout.session.completed` events, and the signature — not an IP budget — is
// the real gate. So the webhook path must be EXEMPT from the global limiter.
describe('webhook rate-limit exemption (#1377)', () => {
  afterEach(() => {
    ;(globalThis as Record<string, unknown>).RATE_LIMITER = undefined
  })

  it('exempts /webhooks/stripe from the global IP limiter even when the bucket is exhausted', async () => {
    const exhausted = { limit: vi.fn(async () => ({ success: false })) }
    ;(globalThis as Record<string, unknown>).RATE_LIMITER = exhausted
    const app = createApp()
    const ip = { 'cf-connecting-ip': '203.0.113.7' }

    // A normal path IS limited: an exhausted bucket returns 429.
    const health = await app.request('/health', { headers: ip })
    expect(health.status).toBe(429)

    // The webhook is exempt: it reaches its handler (400 for the missing
    // signature) instead of being 429'd by the shared-IP bucket.
    const webhook = await app.request('/webhooks/stripe', { method: 'POST', headers: ip })
    expect(webhook.status).toBe(400)

    // Proof of exemption: the limiter was consulted ONLY for /health, never the webhook.
    expect(exhausted.limit).toHaveBeenCalledTimes(1)
    expect(exhausted.limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
  })
})
