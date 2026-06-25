import { jwtVerify } from 'jose'
import { describe, expect, test } from 'vitest'
import { createAuthRoutes } from '../../src/routes/auth'
import { TEST_AUTH_SECRET, oauthFlowCookie, setupAuthEnv } from '../helpers/auth'

const config = {
  clientId: 'cid',
  clientSecret: 'secret',
  redirectUri: 'https://api.example.test/auth/google/callback',
  postLoginRedirect: 'https://web.example.test/en/dashboard',
}

/** Records what the route passed to the injected boundary so we can assert the
 *  code/id_token/nonce/profile actually flowed through, not just that a 302 came back. */
function makeRuntime() {
  const calls: { code?: string; idToken?: string; nonce?: string; profile?: unknown } = {}
  return {
    calls,
    runtime: {
      provider: {
        exchangeCode: async (code: string) => {
          calls.code = code
          return { idToken: 'id-token-1' }
        },
        // #1055: identity now comes from the verified id_token, bound to the flow nonce.
        verifyIdToken: async (idToken: string, _config: unknown, nonce: string) => {
          calls.idToken = idToken
          calls.nonce = nonce
          return { sub: 'g-123', email: 'jo@ex.com', name: 'Jo', picture: 'https://pic/jo.png' }
        },
      },
      accountStore: {
        resolveUser: async (profile: unknown) => {
          calls.profile = profile
          return { id: 'user_42', role: 'RENTER' as const }
        },
      },
    },
  }
}

function getSetCookie(res: Response, name: string): string | undefined {
  const all = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']
  const hit = all.find((c) => c.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1).split(';')[0] : undefined
}

/** True when the response expires this flow's per-flow cookie (empty value +
 *  Max-Age=0) — the one-time flow cookie is cleared on every terminal path (#519). */
function erasesFlowCookie(res: Response, state: string): boolean {
  return (res.headers.getSetCookie?.() ?? []).some(
    (c) => c.startsWith(`kuruma_oauth_flow_${state}=`) && /Max-Age=0/.test(c),
  )
}

describe('GET /auth/google/callback', () => {
  test('valid state → exchanges code, resolves user, mints kuruma_session, redirects', async () => {
    setupAuthEnv()
    const { calls, runtime } = makeRuntime()
    const app = createAuthRoutes(config, runtime)
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: oauthFlowCookie('s1') },
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://web.example.test/en/dashboard')

    // The code → id_token → profile chain actually flowed through the boundary, and
    // the flow's nonce was forwarded to the id_token verifier (#1055).
    expect(calls.code).toBe('c1')
    expect(calls.idToken).toBe('id-token-1')
    expect(calls.nonce).toBe('test-nonce')
    expect(calls.profile).toMatchObject({ sub: 'g-123', email: 'jo@ex.com' })

    // Session minted with the resolved user + a fresh csrf claim.
    const token = getSetCookie(res, 'kuruma_session')
    // Compact JWS: three base64url segments (header.payload.signature).
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    const { payload } = await jwtVerify(token!, new TextEncoder().encode(TEST_AUTH_SECRET), {
      issuer: 'kuruma-web',
      audience: 'kuruma-api',
    })
    expect(payload.sub).toBe('user_42')
    expect(payload.role).toBe('RENTER')
    expect(typeof payload.csrf).toBe('string')

    // Display profile from the OAuth response is minted into the session token
    // so the navbar can render the avatar/name/email without a DB round-trip.
    expect(payload.name).toBe('Jo')
    expect(payload.email).toBe('jo@ex.com')
    expect(payload.image).toBe('https://pic/jo.png')

    // The one-time flow cookie is cleared.
    expect(erasesFlowCookie(res, 's1')).toBe(true)
  })

  test('id_token verification failure → fails closed, mints NO session (#1055)', async () => {
    setupAuthEnv()
    // A token that fails verification (bad sig / wrong aud / nonce mismatch) makes
    // verifyIdToken throw; the callback must NOT mint a session on that path.
    const runtime = {
      provider: {
        exchangeCode: async () => ({ idToken: 'id-1' }),
        verifyIdToken: async () => {
          throw new Error('id_token nonce mismatch')
        },
      },
      accountStore: { resolveUser: async () => ({ id: 'user_42', role: 'RENTER' as const }) },
    }
    const app = createAuthRoutes(config, runtime)
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: oauthFlowCookie('s1') },
    })
    expect(res.status).not.toBe(302)
    expect(getSetCookie(res, 'kuruma_session')).toBeUndefined()
  })

  test('state query has no matching flow cookie → 400', async () => {
    setupAuthEnv()
    const { runtime } = makeRuntime()
    const app = createAuthRoutes(config, runtime)
    // Browser holds flow s1, but the callback returns state=attacker — no cookie
    // named for that state exists, so the CSRF binding fails closed.
    const res = await app.request('/auth/google/callback?state=attacker&code=c1', {
      headers: { Cookie: oauthFlowCookie('s1') },
    })
    expect(res.status).toBe(400)
  })

  test('no flow cookie at all → 400', async () => {
    setupAuthEnv()
    const { runtime } = makeRuntime()
    const app = createAuthRoutes(config, runtime)
    const res = await app.request('/auth/google/callback?state=s1&code=c1')
    expect(res.status).toBe(400)
  })

  test('valid returnTo in the flow → redirects there (not postLoginRedirect) + clears it', async () => {
    setupAuthEnv()
    const { runtime } = makeRuntime()
    const app = createAuthRoutes(config, runtime)
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: oauthFlowCookie('s1', { returnTo: '/ja/bookings/new' }) },
    })
    expect(res.status).toBe(302)
    // returnTo is resolved against the web origin postLoginRedirect targets.
    expect(res.headers.get('location')).toBe('https://web.example.test/ja/bookings/new')
    expect(erasesFlowCookie(res, 's1')).toBe(true)
  })

  test('tampered open-redirect returnTo in the flow → falls back to postLoginRedirect', async () => {
    setupAuthEnv()
    const { runtime } = makeRuntime()
    const app = createAuthRoutes(config, runtime)
    // The cookie carries a hostile returnTo; decodeFlowPayload re-validates it
    // (defence in depth) and drops it, so the callback can't be open-redirected.
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: oauthFlowCookie('s1', { returnTo: '//evil.com' }) },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://web.example.test/en/dashboard')
  })

  // --- #521 provider door (B8): intent/invite → grant decision → mint + redirect ---
  // The grant SERVICE decides authority; the callback only forwards identity facts
  // and mints/redirects on its verdict. UI intent alone never grants a role.

  /** Resolves op1 → 'acme'; any other id has no slug. */
  const findSlug = async (id: string): Promise<string | undefined> =>
    id === 'op1' ? 'acme' : undefined

  test('provider intent + granted → mints operator session + redirects to /<locale>/dashboard', async () => {
    setupAuthEnv()
    const { runtime } = makeRuntime()
    const providerAccess = {
      resolve: async () => ({
        type: 'granted' as const,
        operatorId: 'op1',
        role: 'OPERATOR_OWNER' as const,
      }),
    }
    const app = createAuthRoutes(config, runtime, providerAccess, findSlug)
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: oauthFlowCookie('s1', { intent: 'provider', returnTo: '/ja/manage' }) },
    })
    expect(res.status).toBe(302)
    // Provider intent lands on the real operator dashboard (locale from returnTo);
    // the server-computed destination still wins over a renter-style returnTo.
    expect(res.headers.get('location')).toBe('https://web.example.test/ja/dashboard')

    const token = getSetCookie(res, 'kuruma_session')
    // Compact JWS: three base64url segments (header.payload.signature).
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    const { payload } = await jwtVerify(token!, new TextEncoder().encode(TEST_AUTH_SECRET), {
      issuer: 'kuruma-web',
      audience: 'kuruma-api',
    })
    // resolveUser returned RENTER; the grant upgraded it — proves intent didn't.
    expect(payload.role).toBe('OPERATOR_OWNER')
    expect(payload.operatorId).toBe('op1')
    expect(payload.operatorSlug).toBe('acme')
  })

  test('provider intent + access_not_found → bounces to provider login error, mints NO session', async () => {
    setupAuthEnv()
    const { runtime } = makeRuntime()
    const providerAccess = { resolve: async () => ({ type: 'access_not_found' as const }) }
    const app = createAuthRoutes(config, runtime, providerAccess, findSlug)
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: oauthFlowCookie('s1', { intent: 'provider' }) },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://web.example.test/en/provider/login?error=access_not_found',
    )
    // The provider door alone logs no one in.
    expect(getSetCookie(res, 'kuruma_session')).toBeUndefined()
  })

  test('provider intent + invite_invalid → error redirect; forwards verified email + invite token to the grant service', async () => {
    setupAuthEnv()
    const calls: Record<string, unknown> = {}
    const runtime = {
      provider: {
        exchangeCode: async () => ({ idToken: 'id-1' }),
        verifyIdToken: async () => ({
          sub: 'g-1',
          email: 'JO@ex.com',
          email_verified: true,
          name: 'Jo',
        }),
      },
      accountStore: { resolveUser: async () => ({ id: 'user_42', role: 'RENTER' as const }) },
    }
    const providerAccess = {
      resolve: async (input: Record<string, unknown>) => {
        Object.assign(calls, input)
        return { type: 'invite_invalid' as const }
      },
    }
    const app = createAuthRoutes(config, runtime, providerAccess, findSlug)
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: oauthFlowCookie('s1', { intent: 'provider', invite: 'tok123' }) },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://web.example.test/en/provider/login?error=invite_invalid',
    )
    expect(calls).toMatchObject({
      userId: 'user_42',
      email: 'JO@ex.com',
      emailVerified: true,
      inviteToken: 'tok123',
    })
  })

  test('operator via the renter door → operator slug still minted, renter-style redirect', async () => {
    setupAuthEnv()
    const runtime = {
      provider: {
        exchangeCode: async () => ({ idToken: 'id-1' }),
        verifyIdToken: async () => ({ sub: 'g-1', email: 'o@ex.com' }),
      },
      accountStore: {
        resolveUser: async () => ({
          id: 'user_op',
          role: 'OPERATOR_OWNER' as const,
          operatorId: 'op1',
        }),
      },
    }
    // No intent in the flow = renter door; providerAccess never consulted.
    const app = createAuthRoutes(config, runtime, undefined, findSlug)
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: oauthFlowCookie('s1') },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://web.example.test/en/dashboard')

    const token = getSetCookie(res, 'kuruma_session')
    const { payload } = await jwtVerify(token!, new TextEncoder().encode(TEST_AUTH_SECRET), {
      issuer: 'kuruma-web',
      audience: 'kuruma-api',
    })
    // Slug derived on every intent so the /manage/$slug guard passes from any door.
    expect(payload.operatorId).toBe('op1')
    expect(payload.operatorSlug).toBe('acme')
  })

  test('provider intent + granted but slug unresolved → error redirect, mints NO session', async () => {
    setupAuthEnv()
    const { runtime } = makeRuntime()
    // Grant resolves, but findSlug has no slug for this operatorId (internal
    // inconsistency). The provider door must fail CLOSED: redirect to the error
    // page WITHOUT leaving a session cookie, honouring "denied → no session".
    const providerAccess = {
      resolve: async () => ({
        type: 'granted' as const,
        operatorId: 'op-no-slug',
        role: 'OPERATOR_OWNER' as const,
      }),
    }
    const app = createAuthRoutes(config, runtime, providerAccess, findSlug)
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: oauthFlowCookie('s1', { intent: 'provider' }) },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://web.example.test/en/provider/login?error=access_not_found',
    )
    expect(getSetCookie(res, 'kuruma_session')).toBeUndefined()
  })
})
