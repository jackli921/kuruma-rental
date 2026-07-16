import { SignJWT } from 'jose'
import { beforeEach, describe, expect, it } from 'vitest'

import { verifySessionCookie } from '../../src/auth/jwt'
import { createApp } from '../../src/index'
import { InMemoryAvailabilityRepository } from '../../src/repositories/in-memory/availability'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import { InMemoryVehicleBlockRepository } from '../../src/repositories/in-memory/vehicle-block'
import type { Operator, User } from '../../src/stores'
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

/** The operator the member belongs to, active (deactivatedAt null) by default. */
function activeOperator(): Operator {
  const now = new Date()
  return {
    id: OPERATOR_ID,
    name: 'Best Car Rental',
    slug: 'best-car-rental',
    preAuthHandoffUrl: null,
    createdAt: now,
    updatedAt: now,
    deactivatedAt: null,
  }
}

describe('createApp wires operator-session revocation (#939)', () => {
  let app: ReturnType<typeof createApp>
  let userRepo: InMemoryUserRepository
  let operatorRepo: InMemoryOperatorRepository
  // Hold the backing maps so tests can seed rows after construction — the repos
  // close over these exact references, so a later `.set` is visible to findByIds.
  let userStore: Map<string, User>
  let operatorStore: Map<string, Operator>

  beforeEach(() => {
    setupAuthEnv()
    userStore = new Map([[SELF_ID, activeOperatorRow()]])
    userRepo = new InMemoryUserRepository(userStore)
    const vehicleRepo = new InMemoryVehicleRepository()
    const bookingRepo = new InMemoryBookingRepository()
    const availabilityRepo = new InMemoryAvailabilityRepository(
      vehicleRepo,
      bookingRepo,
      new InMemoryVehicleBlockRepository(),
      new InMemoryOperatorRepository(),
    )
    // operatorRepo backs /operators AND the #1088 operator-active freshness source.
    // Seeded with the member's operator (active) so the operator-deactivation cascade
    // test has a row to toggle; the active row is a no-op for the projection-clear cases.
    operatorStore = new Map([[OPERATOR_ID, activeOperator()]])
    operatorRepo = new InMemoryOperatorRepository(operatorStore)
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

  // #1088 operator-level cascade: deactivating the WHOLE operator must revoke every
  // member on next request, even though their users projection is UNCHANGED (still
  // OPERATOR_OWNER + op_best). This is distinct from #939's per-member deactivation
  // (which clears the users row). The boundary enriches the projection with the
  // operator's deactivatedAt so isStaleOperatorSession can trip.
  it('401s a member the instant their OPERATOR is soft-deactivated (#1088)', async () => {
    const headers = await operatorBearer()
    expect((await app.request(`/users?ids=${SELF_ID}`, { headers })).status).toBe(200)

    // Soft-deactivate the operator — the member's own users row is left intact.
    await operatorRepo.update(OPERATOR_ID, { deactivatedAt: new Date(), updatedAt: new Date() })

    const res = await app.request(`/users?ids=${SELF_ID}`, { headers })
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

  // §5.1 promotion reconcile: after admin approval flips a renter's users row to
  // OPERATOR_OWNER, GET /auth/session must re-mint the token to the new identity on
  // the next read — without a re-login. This pins the createApp-level wiring of the
  // identity resolver end-to-end: drop `app.use(provideIdentityResolver(...))` and the
  // resolver fail-opens (undefined), the reconcile is a no-op, and the promoted user
  // is stuck on a RENTER token for the whole <=7d TTL.
  it('re-mints a RENTER session to OWNER once the users projection flips (promotion)', async () => {
    const userId = 'user_promote'
    userStore.set(userId, {
      id: userId,
      name: 'Promoted Renter',
      email: 'promote@renter.local',
      phone: null,
      language: 'en',
      country: null,
      role: 'RENTER',
      operatorId: null,
    })
    const cookie = await sessionCookie({ sub: userId, role: 'RENTER', csrf: 'csrf-p' })

    const before = await app.request('/auth/session', { headers: cookie })
    expect((await before.json()).data.user).toMatchObject({ id: userId, role: 'RENTER' })

    // Admin approval elsewhere promotes the row (users.setOperatorAccess) and seeds
    // the tenant operator the reconcile reads the slug from.
    await userRepo.setOperatorAccess(userId, { role: 'OPERATOR_OWNER', operatorId: 'op_x' })
    operatorStore.set('op_x', {
      id: 'op_x',
      name: 'Promoted Co',
      slug: 'promoted-co',
      preAuthHandoffUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deactivatedAt: null,
    })

    const after = await app.request('/auth/session', { headers: cookie })
    const body = await after.json()
    expect(body.data.user).toMatchObject({
      id: userId,
      role: 'OPERATOR_OWNER',
      operatorId: 'op_x',
      operatorSlug: 'promoted-co',
    })
    const setCookieHeader = after.headers.get('set-cookie')
    expect(setCookieHeader).toContain('kuruma_session=')
    // Fix A: verify the minted TOKEN itself carries the promoted identity — a bug
    // that built the response body from `current` but re-minted a stale token would
    // pass the body assertion above while this one fails.
    const rawToken = (setCookieHeader ?? '').split(';')[0]?.replace('kuruma_session=', '') ?? ''
    const verified = await verifySessionCookie(rawToken)
    expect(verified?.user.role).toBe('OPERATOR_OWNER')
    expect(verified?.user.operatorId).toBe('op_x')
  })
})
