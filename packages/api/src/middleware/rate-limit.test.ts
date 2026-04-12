import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { type KVStore, rateLimit } from './rate-limit'

function createMockKV(): KVStore {
  const store = new Map<string, string>()
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value)
    },
  }
}

function createTestApp(kv: KVStore) {
  const app = new Hono()
  app.use('*', rateLimit({ kv, readLimit: 5, writeLimit: 2, windowSeconds: 60 }))
  app.get('/vehicles', (c) => c.json({ success: true, data: [] }))
  app.post('/vehicles', (c) => c.json({ success: true, data: {} }))
  app.get('/health', (c) => c.json({ status: 'ok' }))
  return app
}

describe('rate-limit middleware', () => {
  it('passes requests under the limit and sets rate-limit headers', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)

    const res = await app.request('/vehicles', {
      headers: { 'cf-connecting-ip': '1.2.3.4' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4')
  })

  it('returns 429 with Retry-After when limit is exceeded', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)
    const headers = { 'cf-connecting-ip': '1.2.3.4' }

    // Exhaust the 5-request read limit
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/vehicles', { headers })
      expect(res.status).toBe(200)
    }

    // 6th request should be rejected
    const res = await app.request('/vehicles', { headers })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0')

    const body = await res.json()
    expect(body).toEqual({ success: false, error: 'Too many requests' })
  })

  it('applies lower limit to write methods (POST/PATCH/DELETE)', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)
    const headers = { 'cf-connecting-ip': '1.2.3.4' }

    // Exhaust the 2-request write limit
    for (let i = 0; i < 2; i++) {
      const res = await app.request('/vehicles', { method: 'POST', headers })
      expect(res.status).toBe(200)
    }

    // 3rd write should be rejected
    const res = await app.request('/vehicles', { method: 'POST', headers })
    expect(res.status).toBe(429)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('2')
  })

  it('tracks read and write limits independently', async () => {
    const kv = createMockKV()
    const app = createTestApp(kv)
    const headers = { 'cf-connecting-ip': '1.2.3.4' }

    // Exhaust write limit
    for (let i = 0; i < 2; i++) {
      await app.request('/vehicles', { method: 'POST', headers })
    }
    const writeRes = await app.request('/vehicles', { method: 'POST', headers })
    expect(writeRes.status).toBe(429)

    // Read limit should still have capacity
    const readRes = await app.request('/vehicles', { headers })
    expect(readRes.status).toBe(200)
  })

  it('skips rate limiting when KV binding is absent (local dev)', async () => {
    const app = new Hono()
    app.use(
      '*',
      rateLimit({
        kv: undefined,
        readLimit: 1,
        writeLimit: 1,
        windowSeconds: 60,
      }),
    )
    app.get('/test', (c) => c.json({ ok: true }))

    // Should pass even though limit is 1 — KV is missing
    const res1 = await app.request('/test')
    const res2 = await app.request('/test')
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(res1.headers.get('X-RateLimit-Limit')).toBeNull()
  })

  it('exempts health endpoint from rate limiting', async () => {
    const kv = createMockKV()
    const app = new Hono()
    app.use(
      '*',
      rateLimit({ kv, readLimit: 1, writeLimit: 1, windowSeconds: 60, exemptPaths: ['/health'] }),
    )
    app.get('/health', (c) => c.json({ status: 'ok' }))
    app.get('/vehicles', (c) => c.json({ data: [] }))

    // Health should always pass regardless of limit
    const h1 = await app.request('/health')
    const h2 = await app.request('/health')
    expect(h1.status).toBe(200)
    expect(h2.status).toBe(200)
    expect(h1.headers.get('X-RateLimit-Limit')).toBeNull()

    // But /vehicles should still be limited
    await app.request('/vehicles')
    const v2 = await app.request('/vehicles')
    expect(v2.status).toBe(429)
  })
})
