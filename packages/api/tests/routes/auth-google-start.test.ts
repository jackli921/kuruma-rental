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

  test('stashes a safe returnTo in the kuruma_oauth_return cookie', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start?returnTo=%2Fen%2Fbookings%2Fnew', {
      method: 'POST',
    })
    expect(res.status).toBe(302)
    const setCookie = (res.headers.getSetCookie?.() ?? []).find((c) =>
      c.startsWith('kuruma_oauth_return='),
    )
    expect(setCookie).toBeTruthy()
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(readReturnCookie(res)).toBe('/en/bookings/new')
  })

  test('ignores an open-redirect returnTo — no return cookie set', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start?returnTo=%2F%2Fevil.com', { method: 'POST' })
    expect(res.status).toBe(302)
    expect(readReturnCookie(res)).toBeUndefined()
  })

  test('no returnTo query → no return cookie', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start', { method: 'POST' })
    expect(readReturnCookie(res)).toBeUndefined()
  })

  // A new flow must bind a *fresh* return value. If the browser still holds a
  // stale kuruma_oauth_return from an aborted flow, a later plain login (no
  // returnTo) would otherwise inherit it and the callback would redirect to that
  // stale path. So /start must actively erase the old cookie, not just skip it.
  test('no returnTo + stale return cookie present → erases the stale cookie', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start', {
      method: 'POST',
      headers: { cookie: 'kuruma_oauth_return=%2Fja%2Fbookings%2Fnew' },
    })
    expect(res.status).toBe(302)
    expect(erasesReturnCookie(res)).toBe(true)
  })

  test('open-redirect returnTo + stale return cookie present → erases the stale cookie', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start?returnTo=%2F%2Fevil.com', {
      method: 'POST',
      headers: { cookie: 'kuruma_oauth_return=%2Fja%2Fbookings%2Fnew' },
    })
    expect(res.status).toBe(302)
    expect(erasesReturnCookie(res)).toBe(true)
  })

  // Provider sign-in door (#521 §5): intent + optional invite token ride the same
  // HttpOnly/Lax round-trip cookies as state/return. Identity stays Google's;
  // these only steer the post-login authz decision the callback makes.
  test('intent=provider → sets the kuruma_oauth_intent cookie (HttpOnly, Lax)', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start?intent=provider', { method: 'POST' })
    expect(res.status).toBe(302)
    const hit = (res.headers.getSetCookie?.() ?? []).find((c) =>
      c.startsWith('kuruma_oauth_intent='),
    )
    expect(hit).toContain('kuruma_oauth_intent=provider')
    expect(hit).toContain('HttpOnly')
    expect(hit).toContain('SameSite=Lax')
    expect(readFlowCookie(res, 'kuruma_oauth_intent')).toBe('provider')
  })

  test('absent intent → no provider intent cookie set', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start', { method: 'POST' })
    expect(readFlowCookie(res, 'kuruma_oauth_intent')).toBeUndefined()
  })

  // An unknown/renter intent must not leave a stale `provider` cookie alive from
  // an aborted provider flow — /start binds the cookie freshly (erase otherwise).
  test('intent=renter + stale provider intent cookie → erases it', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start?intent=renter', {
      method: 'POST',
      headers: { cookie: 'kuruma_oauth_intent=provider' },
    })
    expect(res.status).toBe(302)
    expect(erasesFlowCookie(res, 'kuruma_oauth_intent')).toBe(true)
  })

  test('valid invite token → sets the kuruma_oauth_invite cookie', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start?intent=provider&invite=Ab3-_xyz09', {
      method: 'POST',
    })
    expect(res.status).toBe(302)
    expect(readFlowCookie(res, 'kuruma_oauth_invite')).toBe('Ab3-_xyz09')
  })

  test('malformed invite token → no invite cookie + erases stale', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start?intent=provider&invite=bad!token', {
      method: 'POST',
      headers: { cookie: 'kuruma_oauth_invite=stale' },
    })
    expect(res.status).toBe(302)
    expect(readFlowCookie(res, 'kuruma_oauth_invite')).toBeUndefined()
    expect(erasesFlowCookie(res, 'kuruma_oauth_invite')).toBe(true)
  })
})

/** Read the decoded value of the kuruma_oauth_return cookie, or undefined. */
function readReturnCookie(res: Response): string | undefined {
  const hit = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('kuruma_oauth_return='))
  if (!hit) return undefined
  const value = hit.slice('kuruma_oauth_return='.length).split(';')[0] ?? ''
  return value === '' ? undefined : decodeURIComponent(value)
}

/** True when the response sends a Set-Cookie that expires kuruma_oauth_return
 *  (empty value + Max-Age=0) — i.e. it tells the browser to drop the stale one. */
function erasesReturnCookie(res: Response): boolean {
  return erasesFlowCookie(res, 'kuruma_oauth_return')
}

/** Read the decoded value of a named flow cookie, or undefined (empty = unset). */
function readFlowCookie(res: Response, name: string): string | undefined {
  const hit = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(`${name}=`))
  if (!hit) return undefined
  const value = hit.slice(`${name}=`.length).split(';')[0] ?? ''
  return value === '' ? undefined : decodeURIComponent(value)
}

/** True when the response expires a named flow cookie (empty value + Max-Age=0). */
function erasesFlowCookie(res: Response, name: string): boolean {
  const hit = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(`${name}=`))
  if (!hit) return false
  const value = hit.slice(`${name}=`.length).split(';')[0] ?? ''
  return value === '' && /max-age=0\b/i.test(hit)
}
