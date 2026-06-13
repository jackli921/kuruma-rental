import { describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import { readOAuthFlowCookie, setupAuthEnv } from '../helpers/auth'

function setupGoogleEnv() {
  setupAuthEnv()
  process.env.AUTH_GOOGLE_ID = 'test-google-client-id'
  process.env.AUTH_GOOGLE_SECRET = 'test-google-client-secret'
  process.env.AUTH_URL = 'https://api.example.test'
}

/** The raw Set-Cookie string for this flow's per-flow cookie, or undefined. */
function rawFlowCookie(res: Response): string | undefined {
  return (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('kuruma_oauth_flow_'))
}

describe('POST /auth/google/start', () => {
  test('redirects (302) to Google authorize with state bound to its own per-flow cookie', async () => {
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
    // 32 random bytes, base64url-encoded → 43 chars in the base64url charset.
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const raw = rawFlowCookie(res)
    expect(raw).toContain('HttpOnly')
    expect(raw).toContain('SameSite=Lax')
    // The redirect's state MUST name the cookie that was set — that binding is what
    // makes the callback's presence check a real CSRF defence, not theatre.
    expect(raw).toContain(`kuruma_oauth_flow_${state}=`)
    expect(readOAuthFlowCookie(res)?.state).toBe(state)
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

  test('stashes a safe returnTo in the per-flow cookie payload', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start?returnTo=%2Fen%2Fbookings%2Fnew', {
      method: 'POST',
    })
    expect(res.status).toBe(302)
    expect(rawFlowCookie(res)).toContain('HttpOnly')
    expect(readOAuthFlowCookie(res)?.payload.returnTo).toBe('/en/bookings/new')
  })

  test('ignores an open-redirect returnTo — no returnTo in the flow payload', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start?returnTo=%2F%2Fevil.com', { method: 'POST' })
    expect(res.status).toBe(302)
    expect(readOAuthFlowCookie(res)?.payload.returnTo).toBeUndefined()
  })

  test('no returnTo query → flow cookie set, but no returnTo in its payload', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start', { method: 'POST' })
    expect(readOAuthFlowCookie(res)?.payload.returnTo).toBeUndefined()
  })

  // The per-flow design (issue #519) makes stale-slot inheritance structurally
  // impossible: a new flow names its cookie by a FRESH random state, so it can
  // never overwrite — nor inherit from — a prior flow's cookie. Two starts in the
  // same browser leave two distinct, independent cookies; neither is erased.
  test('two starts bind two distinct flow cookies — no shared slot to clobber', async () => {
    setupGoogleEnv()
    const app = createApp()
    const first = await app.request('/auth/google/start?returnTo=%2Fen%2Fa', { method: 'POST' })
    const second = await app.request('/auth/google/start?returnTo=%2Fen%2Fb', { method: 'POST' })

    const a = readOAuthFlowCookie(first)
    const b = readOAuthFlowCookie(second)
    expect(a?.state).not.toBe(b?.state)
    expect(a?.payload.returnTo).toBe('/en/a')
    expect(b?.payload.returnTo).toBe('/en/b')
    // Neither /start emits a Max-Age=0 erase — there is nothing to erase.
    for (const res of [first, second]) {
      expect((res.headers.getSetCookie?.() ?? []).some((c) => /Max-Age=0/.test(c))).toBe(false)
    }
  })

  // Provider sign-in door (#521 §5): intent + optional invite token ride the same
  // per-flow cookie value as returnTo. Identity stays Google's; these only steer
  // the post-login authz decision the callback makes.
  test('intent=provider → flow payload carries provider intent (cookie HttpOnly, Lax)', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start?intent=provider', { method: 'POST' })
    expect(res.status).toBe(302)
    expect(rawFlowCookie(res)).toContain('HttpOnly')
    expect(rawFlowCookie(res)).toContain('SameSite=Lax')
    expect(readOAuthFlowCookie(res)?.payload.intent).toBe('provider')
  })

  test('absent intent → flow payload defaults to renter', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start', { method: 'POST' })
    expect(readOAuthFlowCookie(res)?.payload.intent).toBe('renter')
  })

  test('valid invite token → flow payload carries it', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start?intent=provider&invite=Ab3-_xyz09', {
      method: 'POST',
    })
    expect(res.status).toBe(302)
    expect(readOAuthFlowCookie(res)?.payload.invite).toBe('Ab3-_xyz09')
  })

  test('malformed invite token → no invite in the flow payload', async () => {
    setupGoogleEnv()
    const app = createApp()
    const res = await app.request('/auth/google/start?intent=provider&invite=bad!token', {
      method: 'POST',
    })
    expect(res.status).toBe(302)
    expect(readOAuthFlowCookie(res)?.payload.invite).toBeUndefined()
  })
})
