import { jwtVerify } from 'jose'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { GoogleAuthRuntime } from '../../src/auth/google'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

// Records what flowed through the boundary so we assert the runtime was actually
// invoked, not just that some 302 came back.
function makeRuntime(): { calls: { code?: string }; runtime: GoogleAuthRuntime } {
  const calls: { code?: string } = {}
  return {
    calls,
    runtime: {
      provider: {
        exchangeCode: async (code) => {
          calls.code = code
          return { accessToken: 'access-1' }
        },
        getUserInfo: async () => ({ sub: 'g-1', email: 'jo@ex.com', name: 'Jo' }),
      },
      accountStore: {
        resolveUser: async () => ({ id: 'user_7', role: 'RENTER' as const }),
      },
    },
  }
}

function buildApp(googleAuthRuntime: GoogleAuthRuntime) {
  return createApp({
    vehicleRepo: new InMemoryVehicleRepository(),
    bookingRepo: new InMemoryBookingRepository(),
    availabilityRepo: new InMemoryAvailabilityRepository(
      new InMemoryVehicleRepository(),
      new InMemoryBookingRepository(),
    ),
    googleAuthRuntime,
  })
}

describe('createApp wires a googleAuthRuntime override into /auth/google/callback', () => {
  beforeAll(() => {
    setupAuthEnv()
    // resolveGoogleOAuthConfig() reads these; without them the route 503s on
    // missing config rather than exercising the runtime.
    process.env.AUTH_GOOGLE_ID = 'cid'
    process.env.AUTH_GOOGLE_SECRET = 'secret'
    process.env.AUTH_URL = 'https://api.example.test'
    process.env.WEB_POST_LOGIN_URL = 'https://web.example.test/en/dashboard'
  })

  afterAll(() => {
    // Biome noDelete: reset to '' (delete is banned; = undefined coerces to
    // the string "undefined"). '' is falsy so resolveGoogleOAuthConfig → undefined.
    process.env.AUTH_GOOGLE_ID = ''
    process.env.AUTH_GOOGLE_SECRET = ''
    process.env.AUTH_URL = ''
    process.env.WEB_POST_LOGIN_URL = ''
  })

  test('callback uses the injected runtime → 302 + kuruma_session (not 503)', async () => {
    const { calls, runtime } = makeRuntime()
    const app = buildApp(runtime)

    const res = await app.request('/auth/google/callback?state=s1&code=c1', {
      headers: { Cookie: 'kuruma_oauth_state=s1' },
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://web.example.test/en/dashboard')
    expect(calls.code).toBe('c1')

    const setCookies = res.headers.getSetCookie?.() ?? []
    const session = setCookies.find((c) => c.startsWith('kuruma_session='))
    expect(session).toBeTruthy()
    const token = session!.slice('kuruma_session='.length).split(';')[0]
    const { payload } = await jwtVerify(token, new TextEncoder().encode(TEST_AUTH_SECRET), {
      issuer: 'kuruma-web',
      audience: 'kuruma-api',
    })
    expect(payload.sub).toBe('user_7')
    expect(payload.role).toBe('RENTER')
  })
})
