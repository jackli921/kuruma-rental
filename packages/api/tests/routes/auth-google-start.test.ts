import { describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import { setupAuthEnv } from '../helpers/auth'

function setupGoogleEnv() {
  setupAuthEnv()
  process.env.AUTH_GOOGLE_ID = 'test-google-client-id'
  process.env.AUTH_GOOGLE_SECRET = 'test-google-client-secret'
  process.env.AUTH_URL = 'https://api.example.test'
}

describe('POST /auth/google/start', () => {
  test('redirects (302) to Google authorize with state bound to a cookie', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start', { method: 'POST' })
    expect(res.status).toBe(302)

    const location = res.headers.get('location') ?? ''
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    const url = new URL(location)
    expect(url.searchParams.get('client_id')).toBe('test-google-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.example.test/auth/google/callback',
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    const state = url.searchParams.get('state')
    expect(state).toBeTruthy()

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('kuruma_oauth_state=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    // The redirect's state MUST equal the cookie's state — that binding is what
    // makes the callback's state check a real CSRF defence, not theatre.
    expect(setCookie).toContain(`kuruma_oauth_state=${state}`)
  })

  test('503 when Google OAuth is not configured', async () => {
    setupAuthEnv()
    // Empty (falsy) rather than delete: Node coerces env values to strings, so
    // `= undefined` would leave the truthy string "undefined" behind.
    process.env.AUTH_GOOGLE_ID = ''
    process.env.AUTH_URL = ''
    const app = createApp()
    const res = await app.request('/auth/google/start', { method: 'POST' })
    expect(res.status).toBe(503)
  })
})
