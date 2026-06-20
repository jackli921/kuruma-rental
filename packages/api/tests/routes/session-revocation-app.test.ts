import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../../src/index'
import { InMemoryAvailabilityRepository } from '../../src/repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import type { User } from '../../src/stores'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

// #939 boundary test. The middleware unit test (tests/middleware/session-revocation)
// supplies its OWN revocation check, so it proves requireAuth consults the check but
// NOT that createApp registers one. Drop the `app.use(provideOperatorSessionRevocation)`
// wiring and every unit test still passes while production silently fail-opens — a
// deactivated operator keeps portal access for the whole <=7d TTL (the exact #939 bug).
//
// This test pins the wiring end-to-end through createApp + a real operator route: the
// SAME operator token is accepted while its users projection matches and rejected the
// instant `clearOperatorAccess` (what deactivateMember runs) clears that projection.

const OPERATOR_ID = 'op_best'
const SELF_ID = '00000000-0000-4000-8000-000000000939'

async function operatorBearer(): Promise<Record<string, string>> {
  const key = new TextEncoder().encode(TEST_AUTH_SECRET)
  const token = await new SignJWT({ sub: SELF_ID, role: 'OPERATOR_OWNER', operatorId: OPERATOR_ID })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
  return { Authorization: `Bearer ${token}` }
}

// GET /auth/session reads the kuruma_session COOKIE (not a Bearer header), so the
// session-read boundary (#957) must be exercised through the cookie path.
async function sessionCookie(claims: Record<string, unknown>): Promise<Record<string, string>> {
  const key = new TextEncoder().encode(TEST_AUTH_SECRET)
  const token = await new SignJWT({ csrf: 'csrf-abc', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
  return { Cookie: `kuruma_session=${token}` }
}

// The operator's own users row, mirroring the projection a renter-door sign-in mints
// the token from (role + operatorId set by setOperatorAccess).
function activeOperatorRow(): User {
  return {
    id: SELF_ID,
    name: 'Best Owner',
    email: 'owner@best.local',
    phone: null,
    language: 'en',
    country: null,
    role: 'OPERATOR_OWNER',
    operatorId: OPERATOR_ID,
  }
}

describe('createApp wires operator-session revocation (#939)', () => {
  let app: ReturnType<typeof createApp>
  let userRepo: InMemoryUserRepository

  beforeEach(() => {
    setupAuthEnv()
    userRepo = new InMemoryUserRepository(new Map([[SELF_ID, activeOperatorRow()]]))
    const vehicleRepo = new InMemoryVehicleRepository()
    const bookingRepo = new InMemoryBookingRepository()
    const availabilityRepo = new InMemoryAvailabilityRepository(vehicleRepo, bookingRepo)
    // operatorRepo backs /operators, a FACTORY-INTERNAL requireAuth route (its auth
    // is mounted inside createOperatorRoutes, not as an app-level prefix) — an empty
    // repo still 200s an active operator (the service scopes the list to self).
    const operatorRepo = new InMemoryOperatorRepository()
    app = createApp({ vehicleRepo, bookingRepo, availabilityRepo, userRepo, operatorRepo })
  })

  it('accepts an operator token while the users projection still matches', async () => {
    const res = await app.request(`/users?ids=${SELF_ID}`, { headers: await operatorBearer() })
    expect(res.status).toBe(200)
  })

  it('401s the SAME token the instant deactivation clears the users projection', async () => {
    const headers = await operatorBearer()
    // Active: createApp's registered check re-reads the projection, finds a match,
    // and lets the operator through.
    expect((await app.request(`/users?ids=${SELF_ID}`, { headers })).status).toBe(200)

    // deactivateMember -> users.clearOperatorAccess: role RENTER, operatorId null.
    await userRepo.clearOperatorAccess(SELF_ID)

    // Same still-valid signature, but the projection no longer matches -> revoked.
    const res = await app.request(`/users?ids=${SELF_ID}`, { headers })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: string }).error).toBe('Unauthorized')
  })

  // The case above hits /users, gated by an APP-LEVEL `app.use('/users/*', requireAuth())`.
  // /operators mounts its OWN requireAuth INSIDE createOperatorRoutes (no app-level
  // prefix). The context-provided check exists precisely to reach both styles uniformly;
  // without this case a refactor that broke context inheritance into a factory sub-app
  // would keep the /users test green while the actual operator portal routes fail-open.
  it('401s a revoked operator on a factory-internal requireAuth route (/operators), not just app-level prefixes', async () => {
    const headers = await operatorBearer()
    expect((await app.request('/operators', { headers })).status).toBe(200)

    await userRepo.clearOperatorAccess(SELF_ID)

    const res = await app.request('/operators', { headers })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: string }).error).toBe('Unauthorized')
  })

  // #957 follow-up: #939 closed the DATA-route boundary (requireAuth), but
  // GET /auth/session verified by pure crypto only, so a deactivated operator's
  // session read kept 200ing for the whole TTL and the web never logged them out.
  // The endpoint now consults the SAME context-provided check.
  it('401s the GET /auth/session read once deactivation clears the projection (#957)', async () => {
    const headers = await sessionCookie({
      sub: SELF_ID,
      role: 'OPERATOR_OWNER',
      operatorId: OPERATOR_ID,
    })
    expect((await app.request('/auth/session', { headers })).status).toBe(200)

    // deactivateMember -> users.clearOperatorAccess: role RENTER, operatorId null.
    await userRepo.clearOperatorAccess(SELF_ID)

    const res = await app.request('/auth/session', { headers })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: string }).error).toBe('Unauthorized')
  })

  it('leaves a renter session read untouched — revocation is operator-only (#957)', async () => {
    const headers = await sessionCookie({ sub: 'renter_1', role: 'RENTER' })
    expect((await app.request('/auth/session', { headers })).status).toBe(200)
    // Clearing an operator must never sweep up renter sessions.
    await userRepo.clearOperatorAccess(SELF_ID)
    expect((await app.request('/auth/session', { headers })).status).toBe(200)
  })
})
