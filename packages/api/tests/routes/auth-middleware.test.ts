import { SignJWT } from 'jose'
import { beforeAll, describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

// One app per file (#672): bare createApp() builds the full graph (~30 repos +
// every service). Rebuilding it per test multiplied that cost ~10x and, under
// 2-core CI contention, tipped these tests past the 5s timeout. AUTH_SECRET and
// PARTNER_API_KEY are read per request, so a single shared instance is safe; the
// lone build now runs in beforeAll under the more generous hook timeout.
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

async function signJwt(
  payload: Record<string, unknown>,
  secret = TEST_AUTH_SECRET,
  expiresIn = '1h',
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
}

describe('auth middleware', () => {
  test('GET /health returns 200 without auth', async () => {
    const app = createTestApp()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
  })

  test('protected route returns 401 without Authorization header', async () => {
    const app = createTestApp()
    const res = await app.request('/vehicles')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toContain('Unauthorized')
  })

  test('returns 401 with malformed Bearer token', async () => {
    const app = createTestApp()
    const res = await app.request('/vehicles', {
      headers: { Authorization: 'Bearer not-a-real-jwt' },
    })
    expect(res.status).toBe(401)
  })

  test('returns 200 with valid JWT and populates user context', async () => {
    const app = createTestApp()
    const token = await signJwt({ sub: 'user_123', role: 'RENTER' })
    const res = await app.request('/vehicles', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test('returns 401 with expired JWT', async () => {
    const app = createTestApp()
    // Create a JWT that expired 10 seconds ago
    const key = new TextEncoder().encode(TEST_AUTH_SECRET)
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ sub: 'user_123', role: 'RENTER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now - 60)
      .setExpirationTime(now - 10)
      .setIssuer('kuruma-web')
      .setAudience('kuruma-api')
      .sign(key)
    const res = await app.request('/vehicles', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })

  test('returns 401 with JWT signed by wrong secret', async () => {
    const app = createTestApp()
    const token = await signJwt(
      { sub: 'user_123', role: 'RENTER' },
      'wrong-secret-that-is-also-32-chars!',
    )
    const res = await app.request('/vehicles', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })

  test('returns 401 with a valid signature but wrong audience', async () => {
    const app = createTestApp()
    const key = new TextEncoder().encode(TEST_AUTH_SECRET)
    const token = await new SignJWT({ sub: 'user_123', role: 'RENTER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer('kuruma-web')
      .setAudience('not-kuruma-api')
      .sign(key)
    const res = await app.request('/vehicles', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })

  test('returns 401 with a valid signature but wrong issuer', async () => {
    const app = createTestApp()
    const key = new TextEncoder().encode(TEST_AUTH_SECRET)
    const token = await new SignJWT({ sub: 'user_123', role: 'RENTER' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setIssuer('evil-issuer')
      .setAudience('kuruma-api')
      .sign(key)
    const res = await app.request('/vehicles', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })

  test('returns 200 with valid X-API-Key header', async () => {
    const app = createTestApp()
    process.env.PARTNER_API_KEY = 'partner-test-key-123'
    const res = await app.request('/vehicles', {
      headers: { 'X-API-Key': 'partner-test-key-123' },
    })
    expect(res.status).toBe(200)
    process.env.PARTNER_API_KEY = undefined
  })

  test('returns 401 with invalid X-API-Key', async () => {
    const app = createTestApp()
    process.env.PARTNER_API_KEY = 'partner-test-key-123'
    const res = await app.request('/vehicles', {
      headers: { 'X-API-Key': 'wrong-key-totally-bad' },
    })
    expect(res.status).toBe(401)
    process.env.PARTNER_API_KEY = undefined
  })
})
