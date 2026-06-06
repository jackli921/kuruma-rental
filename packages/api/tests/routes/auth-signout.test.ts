import { SignJWT } from 'jose'
import { describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

const SESSION_COOKIE = 'kuruma_session'

function createTestApp() {
  setupAuthEnv()
  return createApp()
}

async function signSession(csrf = 'csrf-abc'): Promise<string> {
  const key = new TextEncoder().encode(TEST_AUTH_SECRET)
  return new SignJWT({ sub: 'user_1', role: 'RENTER', csrf })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
}

describe('POST /auth/signout', () => {
  test('with valid session cookie + matching CSRF token → 204 and clears the cookie', async () => {
    const app = createTestApp()
    const token = await signSession('csrf-abc')
    const res = await app.request('/auth/signout', {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE}=${token}`, 'X-CSRF-Token': 'csrf-abc' },
    })
    expect(res.status).toBe(204)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain(`${SESSION_COOKIE}=`)
    expect(setCookie).toContain('Max-Age=0')
  })

  test('without CSRF token → 403 (cookie-authenticated non-GET)', async () => {
    const app = createTestApp()
    const token = await signSession('csrf-abc')
    const res = await app.request('/auth/signout', {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    })
    expect(res.status).toBe(403)
  })
})
