import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { clientIp, rateLimitByIp } from '../../src/routes/rate-limit'

// Minimal Context double: clientIp only reads request headers (case-insensitive).
function ctxWithHeaders(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { req: { header: (name: string) => lower[name.toLowerCase()] } } as unknown as Parameters<
    typeof clientIp
  >[0]
}

describe('clientIp', () => {
  it('resolves the Cloudflare-injected cf-connecting-ip header', () => {
    expect(clientIp(ctxWithHeaders({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('IGNORES client-controlled x-forwarded-for / x-real-ip (spoof-proof key)', () => {
    // Only the edge-injected header is trusted; forged proxy headers must not
    // mint a fresh limiter bucket. With no cf-connecting-ip, the IP is null.
    expect(
      clientIp(ctxWithHeaders({ 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '192.0.2.5' })),
    ).toBeNull()
  })

  it('returns null when cf-connecting-ip is absent', () => {
    expect(clientIp(ctxWithHeaders({}))).toBeNull()
  })
})

function makeApp(binding: RateLimitBinding) {
  const app = new Hono()
  app.use('/guarded/*', rateLimitByIp(binding))
  return app.get('/guarded/ping', (c) => c.json({ ok: true }))
}

describe('rateLimitByIp', () => {
  it('fails closed with 429 when no client IP resolves — never the shared "" bucket', async () => {
    const binding = { limit: vi.fn(async () => ({ success: true })) }
    const app = makeApp(binding)

    const res = await app.request('/guarded/ping')

    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ success: false, error: 'Too many requests' })
    // The crux of #563: an absent IP must NOT fall through to the limiter, where
    // an empty key bypasses rate limiting entirely.
    expect(binding.limit).not.toHaveBeenCalled()
  })

  it('rate-limits on the resolved IP key and passes the request through when allowed', async () => {
    const binding = { limit: vi.fn(async () => ({ success: true })) }
    const app = makeApp(binding)

    const res = await app.request('/guarded/ping', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(binding.limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
  })

  it('returns 429 when the limiter rejects the resolved IP', async () => {
    const binding = { limit: vi.fn(async () => ({ success: false })) }
    const app = makeApp(binding)

    const res = await app.request('/guarded/ping', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    })

    expect(res.status).toBe(429)
    expect(binding.limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
  })
})
