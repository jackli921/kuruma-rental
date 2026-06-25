import { describe, expect, test } from 'vitest'
import { decodeFlowPayload } from '../../src/auth/google'
import { createAuthRoutes } from '../../src/routes/auth'
import { setupAuthEnv } from '../helpers/auth'

const config = {
  clientId: 'cid',
  clientSecret: 'secret',
  redirectUri: 'https://api.example.test/auth/google/callback',
  postLoginRedirect: 'https://web.example.test/en/dashboard',
}

function makeRuntime() {
  return {
    provider: {
      exchangeCode: async () => ({ idToken: 'id-1' }),
      verifyIdToken: async () => ({ sub: 'g-1', email: 'jo@ex.com' }),
    },
    accountStore: {
      resolveUser: async () => ({ id: 'user_1', role: 'RENTER' as const }),
    },
  }
}

/** Model a real browser cookie jar across responses: cookies are keyed by name,
 *  so a later Set-Cookie for the same name overwrites the earlier value (the very
 *  single-slot behaviour that breaks concurrent tabs). Empty (expired) values are
 *  dropped, mirroring how a browser evicts a Max-Age=0 cookie. */
function mergeJar(responses: Response[]): string {
  const jar = new Map<string, string>()
  for (const res of responses) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(';')[0] ?? ''
      const eq = pair.indexOf('=')
      if (eq < 0) continue
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      if (value === '') jar.delete(name)
      else jar.set(name, value)
    }
  }
  return [...jar].map(([n, v]) => `${n}=${v}`).join('; ')
}

function stateOf(res: Response): string {
  return new URL(res.headers.get('location') ?? '').searchParams.get('state') ?? ''
}

describe('multi-tab Google login (issue #519)', () => {
  test('two tabs start concurrently → each callback validates against its own flow', async () => {
    setupAuthEnv()
    const app = createAuthRoutes(config, makeRuntime())

    // Tab A and tab B each begin a sign-in; B starts while A is still pending.
    const startA = await app.request('/auth/google/start?returnTo=%2Fen%2Fa', { method: 'POST' })
    const startB = await app.request('/auth/google/start?returnTo=%2Fen%2Fb', { method: 'POST' })
    const stateA = stateOf(startA)
    const stateB = stateOf(startB)
    expect(stateA).not.toBe(stateB)

    // The browser now holds BOTH flows' cookies. Tab A's callback comes back.
    const jar = mergeJar([startA, startB])
    const cbA = await app.request(`/auth/google/callback?state=${stateA}&code=cA`, {
      headers: { Cookie: jar },
    })

    // Pre-fix: B's /start clobbered the single-slot state cookie → A dead-ends 400.
    expect(cbA.status).toBe(302)
    expect(cbA.headers.get('location')).toBe('https://web.example.test/en/a')

    // And tab B's callback still lands on B's own returnTo, not A's.
    const cbB = await app.request(`/auth/google/callback?state=${stateB}&code=cB`, {
      headers: { Cookie: jar },
    })
    expect(cbB.status).toBe(302)
    expect(cbB.headers.get('location')).toBe('https://web.example.test/en/b')
  })
})

// Hardening from the #519 code review: the per-flow cookie value and the `state`
// query are both attacker-influenceable (a forged cookie / a crafted callback
// URL), so neither may crash the auth boundary or smuggle a non-string through.
describe('forged-input hardening (issue #519 review)', () => {
  test('decodeFlowPayload drops non-string fields — a forged cookie can not smuggle a number', () => {
    // RegExp.test() coerces its argument, so an un-filtered `{invite: 12345}`
    // would slip a *number* past safeInviteToken and later throw in sha256Hex.
    const raw = Buffer.from(
      JSON.stringify({ returnTo: 1, intent: ['provider'], invite: 12345 }),
    ).toString('base64url')
    const payload = decodeFlowPayload(raw)
    expect(payload.returnTo).toBeUndefined()
    expect(payload.invite).toBeUndefined()
    expect(payload.intent).toBe('renter')
  })

  test('a hostile state with invalid cookie-name chars → 400, never a 500', async () => {
    setupAuthEnv()
    const app = createAuthRoutes(config, makeRuntime())
    // A space is not a valid cookie-name token char; the bad-state path must not
    // try to delete a cookie by this name (which would throw → 500).
    const res = await app.request('/auth/google/callback?state=abc%20def&code=c1')
    expect(res.status).toBe(400)
  })
})
