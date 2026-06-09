import { SignJWT } from 'jose'
import { describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

const SESSION_COOKIE = 'kuruma_session'

function createTestApp() {
  setupAuthEnv()
  return createApp()
}

/** Sign a `kuruma_session` cookie JWT. Mirrors the contract the API mints at
 *  OAuth sign-in (Phase 2): same iss/aud as the Bearer token, plus a `csrf` claim. */
async function signSession(
  payload: Record<string, unknown> = { sub: 'user_123', role: 'RENTER', csrf: 'csrf-token-abc' },
  secret = TEST_AUTH_SECRET,
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
}

function cookie(token: string): Record<string, string> {
  return { Cookie: `${SESSION_COOKIE}=${token}` }
}

describe('GET /auth/session', () => {
  test('valid session cookie → 200 with { user: {id, role}, csrfToken }', async () => {
    const app = createTestApp()
    const token = await signSession({ sub: 'user_123', role: 'RENTER', csrf: 'csrf-token-abc' })
    const res = await app.request('/auth/session', { headers: cookie(token) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      success: true,
      data: { user: { id: 'user_123', role: 'RENTER' }, csrfToken: 'csrf-token-abc' },
    })
  })

  test('session cookie carrying profile → 200 includes name/email/image', async () => {
    const app = createTestApp()
    const token = await signSession({
      sub: 'user_123',
      role: 'RENTER',
      csrf: 'c',
      name: 'Aiko Tanaka',
      email: 'aiko@example.com',
      image: 'https://img.example/avatar.png',
    })
    const res = await app.request('/auth/session', { headers: cookie(token) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.user).toMatchObject({
      id: 'user_123',
      role: 'RENTER',
      name: 'Aiko Tanaka',
      email: 'aiko@example.com',
      image: 'https://img.example/avatar.png',
    })
  })

  test('session cookie without profile → 200, user has id/role and no stray profile keys', async () => {
    const app = createTestApp()
    const token = await signSession({ sub: 'user_123', role: 'RENTER', csrf: 'c' })
    const res = await app.request('/auth/session', { headers: cookie(token) })
    const body = await res.json()
    expect(body.data.user).toMatchObject({ id: 'user_123', role: 'RENTER' })
    expect(body.data.user.name).toBeUndefined()
    expect(body.data.user.email).toBeUndefined()
    expect(body.data.user.image).toBeUndefined()
  })

  test('no session cookie → 401', async () => {
    const app = createTestApp()
    const res = await app.request('/auth/session')
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ success: false, error: 'Unauthorized' })
  })

  test('tampered session cookie → 401', async () => {
    const app = createTestApp()
    const token = await signSession()
    const res = await app.request('/auth/session', { headers: cookie(`${token}tampered`) })
    expect(res.status).toBe(401)
  })

  test('session cookie signed with the wrong secret → 401', async () => {
    const app = createTestApp()
    const token = await signSession(
      { sub: 'user_123', role: 'RENTER', csrf: 'x' },
      'wrong-secret-that-is-also-32-chars!',
    )
    const res = await app.request('/auth/session', { headers: cookie(token) })
    expect(res.status).toBe(401)
  })
})

describe('requireAuth cookie path', () => {
  test('valid session cookie authenticates a protected GET', async () => {
    const app = createTestApp()
    const token = await signSession({ sub: 'user_123', role: 'ADMIN', csrf: 'c' })
    const res = await app.request('/vehicles', { headers: cookie(token) })
    expect(res.status).toBe(200)
  })

  test('no credentials still rejects a protected route with 401', async () => {
    const app = createTestApp()
    const res = await app.request('/vehicles')
    expect(res.status).toBe(401)
  })
})

describe('CSRF enforcement (wired into createApp)', () => {
  test('cookie-authenticated mutation without X-CSRF-Token → 403', async () => {
    const app = createTestApp()
    const token = await signSession({ sub: 'admin_1', role: 'ADMIN', csrf: 'tok' })
    const res = await app.request('/vehicles', { method: 'POST', headers: cookie(token) })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ success: false, error: 'CSRF token mismatch' })
  })

  test('cookie-authenticated GET is never CSRF-blocked', async () => {
    const app = createTestApp()
    const token = await signSession({ sub: 'admin_1', role: 'ADMIN', csrf: 'tok' })
    const res = await app.request('/vehicles', { headers: cookie(token) })
    expect(res.status).toBe(200)
  })
})
