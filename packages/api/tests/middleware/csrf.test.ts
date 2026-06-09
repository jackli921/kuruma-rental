import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { describe, expect, test } from 'vitest'
import { csrf } from '../../src/middleware/csrf'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

const SESSION_COOKIE = 'kuruma_session'

/** Minimal app: csrf() guarding a GET + POST echo, so the middleware is tested
 *  in isolation from any route's own validation/role logic. */
function appWithCsrf() {
  setupAuthEnv()
  const app = new Hono()
  app.use('*', csrf())
  app.get('/echo', (c) => c.json({ ok: true }))
  app.post('/echo', (c) => c.json({ ok: true }))
  return app
}

async function signSession(csrfToken: string | undefined = 'csrf-abc'): Promise<string> {
  const key = new TextEncoder().encode(TEST_AUTH_SECRET)
  const claims: Record<string, unknown> = { sub: 'user_1', role: 'RENTER' }
  if (csrfToken !== undefined) claims.csrf = csrfToken
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
}

function withCookie(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Cookie: `${SESSION_COOKIE}=${token}`, ...extra }
}

describe('csrf middleware', () => {
  test('non-GET with session cookie + matching X-CSRF-Token passes', async () => {
    const app = appWithCsrf()
    const token = await signSession('csrf-abc')
    const res = await app.request('/echo', {
      method: 'POST',
      headers: withCookie(token, { 'X-CSRF-Token': 'csrf-abc' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('non-GET with session cookie but missing X-CSRF-Token → 403', async () => {
    const app = appWithCsrf()
    const token = await signSession('csrf-abc')
    const res = await app.request('/echo', { method: 'POST', headers: withCookie(token) })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ success: false, error: 'CSRF token mismatch' })
  })

  test('non-GET with session cookie but wrong X-CSRF-Token → 403', async () => {
    const app = appWithCsrf()
    const token = await signSession('csrf-abc')
    const res = await app.request('/echo', {
      method: 'POST',
      headers: withCookie(token, { 'X-CSRF-Token': 'not-the-token' }),
    })
    expect(res.status).toBe(403)
  })

  test('non-GET with a session cookie that carries no csrf claim → 403', async () => {
    const app = appWithCsrf()
    const token = await signSession(undefined)
    const res = await app.request('/echo', {
      method: 'POST',
      headers: withCookie(token, { 'X-CSRF-Token': 'anything' }),
    })
    expect(res.status).toBe(403)
  })

  test('non-GET with no session cookie is exempt (partner Bearer / Apple first-touch)', async () => {
    const app = appWithCsrf()
    const res = await app.request('/echo', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  test('GET never requires a CSRF token even with a session cookie', async () => {
    const app = appWithCsrf()
    const token = await signSession('csrf-abc')
    const res = await app.request('/echo', { headers: withCookie(token) })
    expect(res.status).toBe(200)
  })
})
