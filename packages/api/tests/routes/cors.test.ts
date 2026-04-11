// Regression test for issue #46. Without CORS middleware the browser
// fetch from the web dev server (http://localhost:3001) to the Worker
// (http://localhost:8787) rejects, and the fleet page hangs on skeleton
// loaders forever. See packages/api/src/index.ts for the middleware.

import { describe, expect, it } from 'vitest'
import app from '../../src/index'

describe('CORS middleware', () => {
  it('emits Access-Control-Allow-Origin for the web dev origin on a simple GET', async () => {
    const res = await app.request('/health', {
      headers: { Origin: 'http://localhost:3001' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3001')
  })

  it('accepts 127.0.0.1:3001 as an alias for the dev origin', async () => {
    const res = await app.request('/health', {
      headers: { Origin: 'http://127.0.0.1:3001' },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:3001')
  })

  it('answers OPTIONS preflight with the allowed methods and headers', async () => {
    const res = await app.request('/vehicles', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3001',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    })

    // hono/cors answers preflight with 204
    expect([200, 204]).toContain(res.status)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3001')
    const allowedMethods = res.headers.get('Access-Control-Allow-Methods') ?? ''
    expect(allowedMethods).toContain('GET')
    expect(allowedMethods).toContain('POST')
    expect(allowedMethods).toContain('PATCH')
    expect(allowedMethods).toContain('DELETE')
  })

  it('does NOT echo disallowed origins', async () => {
    const res = await app.request('/health', {
      headers: { Origin: 'http://evil.example.com' },
    })

    // Same-site GETs that are not in the allowlist still succeed — CORS is
    // enforced by the browser, not the server — but the server must NOT
    // echo the rogue origin back. The header must be absent (or falsy).
    const acao = res.headers.get('Access-Control-Allow-Origin')
    expect(acao).not.toBe('http://evil.example.com')
  })
})
