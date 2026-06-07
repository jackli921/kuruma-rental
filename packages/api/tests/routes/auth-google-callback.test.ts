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
})
