import { describe, expect, test } from 'bun:test'
import { SignJWT } from 'jose'
import { createApp } from '../../src/index'

const TEST_SECRET = 'test-auth-secret-at-least-32-chars-long'

function createTestApp() {
  process.env.AUTH_SECRET = TEST_SECRET
  return createApp()
}

async function signJwt(
  payload: Record<string, unknown>,
  secret = TEST_SECRET,
  expiresIn = '1h',
): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
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
    const token = await signJwt({ sub: 'user_123', role: 'RENTER' }, TEST_SECRET, '0s')
    // Small delay to ensure expiry
    await new Promise((r) => setTimeout(r, 50))
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
