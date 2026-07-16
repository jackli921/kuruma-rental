import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { beforeAll, describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import { type CurrentIdentity, provideIdentityResolver } from '../../src/middleware/auth'
import { createAuthRoutes } from '../../src/routes/auth'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

const SESSION_COOKIE = 'kuruma_session'

// One app per file (#672): bare createApp() builds the full graph; rebuilding it
// per test multiplied that cost ~11x and, under 2-core CI contention, tipped
// these tests past the 5s timeout. AUTH_SECRET is read per request, so a single
// shared instance is safe; the lone build now runs in beforeAll under the hook timeout.
// Invariant: AUTH_SECRET is asserted once here — never mutate it in a test body,
// or every test after that one would verify against the wrong secret.
let app: ReturnType<typeof createApp>
beforeAll(() => {
  setupAuthEnv()
  app = createApp()
})
function createTestApp() {
  return app
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

  // Reconcile-and-remint (§5.1). These build a bespoke app wiring a fake identity
  // resolver via provideIdentityResolver (the shared createApp() does NOT wire one
  // until Task 4), then mount the real createAuthRoutes with a stub slug lookup.
  function appWithIdentity(identity: (id: string) => CurrentIdentity | undefined) {
    const inner = new Hono()
    inner.use(
      '*',
      provideIdentityResolver(async (u) => identity(u.id)),
    )
    inner.route(
      '/',
      createAuthRoutes(undefined, undefined, undefined, async () => 'acme'),
    )
    return inner
  }

  test('re-mints RENTER→OWNER: returns fresh operatorId/slug + a new Set-Cookie', async () => {
    const token = await signSession({ sub: 'user_1', role: 'RENTER', csrf: 'csrf-a' })
    const app = appWithIdentity((id) =>
      id === 'user_1' ? { role: 'OPERATOR_OWNER', operatorId: 'op_9' } : undefined,
    )
    const res = await app.request('/auth/session', { headers: cookie(token) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.user).toMatchObject({
      id: 'user_1',
      role: 'OPERATOR_OWNER',
      operatorId: 'op_9',
      operatorSlug: 'acme',
    })
    expect(res.headers.get('set-cookie')).toContain('kuruma_session=')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  test('re-mint preserves the display profile (C1)', async () => {
    const token = await signSession({
      sub: 'user_1',
      role: 'RENTER',
      csrf: 'csrf-a',
      name: 'Ada',
      email: 'ada@x.io',
      image: 'https://img/a.png',
    })
    const app = appWithIdentity(() => ({ role: 'OPERATOR_OWNER', operatorId: 'op_9' }))
    const res = await app.request('/auth/session', { headers: cookie(token) })
    const body = await res.json()
    expect(body.data.user).toMatchObject({
      name: 'Ada',
      email: 'ada@x.io',
      image: 'https://img/a.png',
    })
  })

  test('no change → no re-mint, same csrf, no Set-Cookie', async () => {
    const token = await signSession({ sub: 'user_1', role: 'RENTER', csrf: 'csrf-a' })
    const app = appWithIdentity(() => ({ role: 'RENTER' }))
    const res = await app.request('/auth/session', { headers: cookie(token) })
    const body = await res.json()
    expect(body.data.user.role).toBe('RENTER')
    expect(body.data.csrfToken).toBe('csrf-a')
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  test('operator token skips reconcile: resolver never runs, no Set-Cookie', async () => {
    const token = await signSession({
      sub: 'op_user',
      role: 'OPERATOR_OWNER',
      csrf: 'csrf-op',
      operatorId: 'op_9',
      operatorSlug: 'acme',
    })
    const app = appWithIdentity(() => {
      throw new Error('resolver must not run for operator tokens')
    })
    const res = await app.request('/auth/session', { headers: cookie(token) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.user.role).toBe('OPERATOR_OWNER')
    expect(res.headers.get('set-cookie')).toBeNull()
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
