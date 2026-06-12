import { jwtVerify } from 'jose'
import { describe, expect, test } from 'vitest'
import { createAuthRoutes } from '../../src/routes/auth'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

const config = {
  clientId: 'cid',
  clientSecret: 'secret',
  redirectUri: 'https://api.example.test/auth/google/callback',
  postLoginRedirect: 'https://web.example.test/en/dashboard',
}

/** Records what the route passed to the injected boundary so we can assert the
 *  code/profile actually flowed through, not just that a 302 came back. */
function makeRuntime() {
  const calls: { code?: string; accessToken?: string; profile?: unknown } = {}
  return {
    calls,
    runtime: {
      provider: {
        exchangeCode: async (code: string) => {
          calls.code = code
          return { accessToken: 'access-1' }
        },
        getUserInfo: async (accessToken: string) => {
          calls.accessToken = accessToken
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

describe('GET /auth/google/callback', () => {
  test('valid state → exchanges code, resolves user, mints kuruma_session, redirects', async () => {
    setupAuthEnv()
    const { calls, runtime } = makeRuntime()
    const app = createAuthRoutes(config, runtime)
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: 'kuruma_oauth_state=s1' },
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://web.example.test/en/dashboard')

    // The code/profile actually flowed through the boundary.
    expect(calls.code).toBe('c1')
    expect(calls.accessToken).toBe('access-1')
    expect(calls.profile).toMatchObject({ sub: 'g-123', email: 'jo@ex.com' })

    // Session minted with the resolved user + a fresh csrf claim.
    const token = getSetCookie(res, 'kuruma_session')
    expect(token).toBeTruthy()
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

    // The one-time state cookie is cleared.
    const allCookies = res.headers.getSetCookie?.() ?? []
    expect(allCookies.some((c) => c.startsWith('kuruma_oauth_state=') && /Max-Age=0/.test(c))).toBe(
      true,
    )
  })

  test('state query does not match the state cookie → 400', async () => {
    setupAuthEnv()
    const { runtime } = makeRuntime()
    const app = createAuthRoutes(config, runtime)
    const res = await app.request('/auth/google/callback?state=attacker&code=c1', {
      headers: { Cookie: 'kuruma_oauth_state=s1' },
    })
    expect(res.status).toBe(400)
  })

  test('missing state cookie → 400', async () => {
    setupAuthEnv()
    const { runtime } = makeRuntime()
    const app = createAuthRoutes(config, runtime)
    const res = await app.request('/auth/google/callback?state=s1&code=c1')
    expect(res.status).toBe(400)
  })

  test('valid return cookie → redirects there (not postLoginRedirect) + clears it', async () => {
    setupAuthEnv()
    const { runtime } = makeRuntime()
    const app = createAuthRoutes(config, runtime)
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: 'kuruma_oauth_state=s1; kuruma_oauth_return=%2Fja%2Fbookings%2Fnew' },
    })
    expect(res.status).toBe(302)
    // returnTo is resolved against the web origin postLoginRedirect targets.
    expect(res.headers.get('location')).toBe('https://web.example.test/ja/bookings/new')
    const cleared = (res.headers.getSetCookie?.() ?? []).some(
      (c) => c.startsWith('kuruma_oauth_return=') && /Max-Age=0/.test(c),
    )
    expect(cleared).toBe(true)
  })

  test('tampered open-redirect return cookie → falls back to postLoginRedirect', async () => {
    setupAuthEnv()
    const { runtime } = makeRuntime()
    const app = createAuthRoutes(config, runtime)
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: 'kuruma_oauth_state=s1; kuruma_oauth_return=%2F%2Fevil.com' },
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

  test('provider intent + granted → mints operator session + redirects to /<locale>/manage/<slug>/dashboard', async () => {
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
      headers: {
        Cookie:
          'kuruma_oauth_state=s1; kuruma_oauth_intent=provider; kuruma_oauth_return=%2Fja%2Fmanage',
      },
    })
    expect(res.status).toBe(302)
    // Server-computed dashboard (locale from returnTo, slug server-derived) wins over returnTo.
    expect(res.headers.get('location')).toBe('https://web.example.test/ja/manage/acme/dashboard')

    const token = getSetCookie(res, 'kuruma_session')
    expect(token).toBeTruthy()
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
      headers: { Cookie: 'kuruma_oauth_state=s1; kuruma_oauth_intent=provider' },
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
        exchangeCode: async () => ({ accessToken: 'a' }),
        getUserInfo: async () => ({
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
      headers: {
        Cookie: 'kuruma_oauth_state=s1; kuruma_oauth_intent=provider; kuruma_oauth_invite=tok123',
      },
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
        exchangeCode: async () => ({ accessToken: 'a' }),
        getUserInfo: async () => ({ sub: 'g-1', email: 'o@ex.com' }),
      },
      accountStore: {
        resolveUser: async () => ({
          id: 'user_op',
          role: 'OPERATOR_OWNER' as const,
          operatorId: 'op1',
        }),
      },
    }
    // No intent cookie = renter door; providerAccess never consulted.
    const app = createAuthRoutes(config, runtime, undefined, findSlug)
    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: 'kuruma_oauth_state=s1' },
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
      headers: { Cookie: 'kuruma_oauth_state=s1; kuruma_oauth_intent=provider' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://web.example.test/en/provider/login?error=access_not_found',
    )
    expect(getSetCookie(res, 'kuruma_session')).toBeUndefined()
  })
})
