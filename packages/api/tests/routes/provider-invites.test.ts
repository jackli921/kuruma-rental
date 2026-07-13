import { createHash } from 'node:crypto'
import { SignJWT } from 'jose'
import { beforeEach, describe, expect, test } from 'vitest'
import { createApp } from '../../src/index'
import {
  InMemoryAvailabilityRepository,
  InMemoryBookingRepository,
  InMemoryOperatorMembershipRepository,
  InMemoryOperatorRepository,
  InMemoryProviderInviteRepository,
  InMemoryUserRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { createOperatorGrantService } from '../../src/services/operator-grant'
import type { Operator, User } from '../../src/stores'
import { TEST_AUTH_SECRET, setupAuthEnv } from '../helpers/auth'

async function bearer(payload: Record<string, unknown>): Promise<Record<string, string>> {
  const key = new TextEncoder().encode(TEST_AUTH_SECRET)
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setIssuer('kuruma-web')
    .setAudience('kuruma-api')
    .sign(key)
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

const OPERATOR: Operator = {
  id: 'op_1',
  slug: 'pilot',
  name: 'Pilot Operator',
  preAuthHandoffUrl: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

function makeApp() {
  setupAuthEnv()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
    new InMemoryOperatorRepository(),
  )
  const providerInviteRepo = new InMemoryProviderInviteRepository()
  const operatorRepo = new InMemoryOperatorRepository(new Map([[OPERATOR.id, OPERATOR]]))
  const app = createApp({
    vehicleRepo,
    bookingRepo,
    availabilityRepo,
    providerInviteRepo,
    operatorRepo,
  })
  return { app, providerInviteRepo, operatorRepo }
}

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')

const validBody = { email: 'Pilot@Operator.example', operatorId: 'op_1', role: 'OPERATOR_OWNER' }

describe('POST /admin/provider-invites', () => {
  let app: ReturnType<typeof makeApp>['app']
  let providerInviteRepo: ReturnType<typeof makeApp>['providerInviteRepo']

  beforeEach(() => {
    ;({ app, providerInviteRepo } = makeApp())
  })

  test('PLATFORM_ADMIN mints an invite, returning a one-time token (201)', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify(validBody),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.token).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(body.data.inviteUrl).toMatch(
      new RegExp(`/provider/invite/${body.data.token.replace(/[-]/g, '\\$&')}$`),
    )
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  test('persists only the token hash, lowercased email, and PENDING status', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify(validBody),
    })
    const { token } = (await res.json()).data

    // Plaintext token is never stored — only its sha256 hash is queryable.
    expect(await providerInviteRepo.findByTokenHash(token)).toBeUndefined()
    const stored = await providerInviteRepo.findByTokenHash(sha256Hex(token))
    expect(stored).toMatchObject({
      email: 'pilot@operator.example',
      operatorId: 'op_1',
      role: 'OPERATOR_OWNER',
      status: 'PENDING',
      invitedByUserId: 'admin-1',
      acceptedByUserId: null,
    })
  })

  test('OPERATOR_OWNER cannot mint invites (403)', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'owner-1', role: 'OPERATOR_OWNER', operatorId: 'op_1' }),
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(403)
  })

  test('RENTER cannot mint invites (403)', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'renter-1', role: 'RENTER' }),
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(403)
  })

  test('rejects an unauthenticated request (401)', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    expect(res.status).toBe(401)
  })

  test('rejects a malformed body (400)', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify({ email: 'not-an-email', operatorId: 'op_1', role: 'OPERATOR_OWNER' }),
    })
    expect(res.status).toBe(400)
  })

  test('returns 404 when the target operator does not exist', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify({ ...validBody, operatorId: 'op_missing' }),
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ success: false, error: 'Operator not found' })
  })

  test('rejects an unknown operator role (400)', async () => {
    const res = await app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'admin-1', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify({ email: 'pilot@operator.example', operatorId: 'op_1', role: 'WIZARD' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /provider-invites/:token/preview', () => {
  let app: ReturnType<typeof makeApp>['app']
  let providerInviteRepo: ReturnType<typeof makeApp>['providerInviteRepo']

  beforeEach(() => {
    ;({ app, providerInviteRepo } = makeApp())
  })

  const seedInvite = (token: string) =>
    providerInviteRepo.create({
      email: 'invitee@example.com',
      operatorId: 'op_1',
      role: 'OPERATOR_OWNER',
      tokenHash: sha256Hex(token),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      invitedByUserId: 'admin-1',
      acceptedByUserId: null,
    })

  test('is public (no auth) and returns operator name + valid, never the email', async () => {
    await seedInvite('live-token')

    const res = await app.request('/provider-invites/live-token/preview')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.valid).toBe(true)
    expect(body.data.operatorName).toBe('Pilot Operator')
    // A leaked invite URL must not disclose the invited address (#521 §7).
    expect(JSON.stringify(body)).not.toContain('invitee@example.com')
  })

  test('returns valid:false with no operator details for an unknown token (200)', async () => {
    const res = await app.request('/provider-invites/never-issued/preview')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual({ valid: false })
  })
})

// ---------------------------------------------------------------------------
// P1a regression guard: STAFF + manual-OWNER invite mint -> resolve end-to-end
//
// These tests prove the shared provider-invite machinery (invite-mint.ts,
// provider-invite.ts, operator-grant.ts) keeps both non-application invite
// flows working after the approval-path stopped minting invites.
//
// A single shared InMemoryProviderInviteRepository is injected into createApp
// (so both mint routes write into it) AND into createOperatorGrantService (so
// resolve() reads the freshly-minted invite by token hash). The same
// operatorMembershipRepo and userRepo are shared so all three grant writes
// (membership, user projection, invite consumption) are visible to assertions.
// ---------------------------------------------------------------------------

const GUARD_OPERATOR: Operator = {
  id: 'op_guard',
  slug: 'guard',
  name: 'Guard Operator',
  preAuthHandoffUrl: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

const STAFF_USER: User = {
  id: 'staff-user-1',
  name: 'Staff Member',
  email: 'staff@guard.example',
  phone: null,
  language: 'en',
  country: null,
  role: 'RENTER',
}

const OWNER_USER: User = {
  id: 'owner-user-1',
  name: 'Incoming Owner',
  email: 'new.owner@guard.example',
  phone: null,
  language: 'en',
  country: null,
  role: 'RENTER',
}

function makeGuardApp() {
  setupAuthEnv()
  const vehicleRepo = new InMemoryVehicleRepository()
  const bookingRepo = new InMemoryBookingRepository()
  const availabilityRepo = new InMemoryAvailabilityRepository(
    vehicleRepo,
    bookingRepo,
    new InMemoryVehicleBlockRepository(),
    new InMemoryOperatorRepository(),
  )
  const providerInviteRepo = new InMemoryProviderInviteRepository()
  const operatorMembershipRepo = new InMemoryOperatorMembershipRepository()
  const userRepo = new InMemoryUserRepository(
    new Map([
      [STAFF_USER.id, STAFF_USER],
      [OWNER_USER.id, OWNER_USER],
    ]),
  )
  const operatorRepo = new InMemoryOperatorRepository(
    new Map([[GUARD_OPERATOR.id, GUARD_OPERATOR]]),
  )

  const app = createApp({
    vehicleRepo,
    bookingRepo,
    availabilityRepo,
    providerInviteRepo,
    operatorMembershipRepo,
    userRepo,
    operatorRepo,
  })

  // Grant service reads from the SAME repos the app's mint routes wrote into.
  const grantService = createOperatorGrantService({
    memberships: operatorMembershipRepo,
    invites: providerInviteRepo,
    runGrant: (fn) =>
      fn({ memberships: operatorMembershipRepo, users: userRepo, invites: providerInviteRepo }),
  })

  return { app, providerInviteRepo, operatorMembershipRepo, userRepo, grantService }
}

describe('invite acceptance survives approval-mint removal (P1a)', () => {
  let ctx: ReturnType<typeof makeGuardApp>

  beforeEach(() => {
    ctx = makeGuardApp()
  })

  test('STAFF path: operator owner mints, grant resolves OPERATOR_STAFF membership', async () => {
    // Step 1: OPERATOR_OWNER mints a STAFF invite via the team route.
    const mintRes = await ctx.app.request('/operators/me/invites', {
      method: 'POST',
      headers: {
        ...(await bearer({
          sub: 'op-owner-caller',
          role: 'OPERATOR_OWNER',
          operatorId: GUARD_OPERATOR.id,
        })),
      },
      body: JSON.stringify({ email: STAFF_USER.email }),
    })
    expect(mintRes.status).toBe(201)
    const mintData = (await mintRes.json()).data as { inviteUrl: string }

    // The team route returns only the URL (no bare token), so extract it from the
    // last path segment. Same token shape the admin route asserts (file line 84).
    const token = mintData.inviteUrl.split('/').at(-1) ?? ''
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/)

    // Step 2: The staff user redeems the invite.
    const result = await ctx.grantService.resolve({
      userId: STAFF_USER.id,
      email: STAFF_USER.email,
      emailVerified: true,
      inviteToken: token,
    })

    // Grant result.
    expect(result).toEqual({
      type: 'granted',
      operatorId: GUARD_OPERATOR.id,
      role: 'OPERATOR_STAFF',
    })

    // Membership written.
    const membership = await ctx.operatorMembershipRepo.findActiveByUserId(STAFF_USER.id)
    expect(membership).toMatchObject({
      userId: STAFF_USER.id,
      operatorId: GUARD_OPERATOR.id,
      role: 'OPERATOR_STAFF',
      status: 'ACTIVE',
    })

    // User projected to OPERATOR_STAFF.
    const [user] = await ctx.userRepo.findByIds([STAFF_USER.id])
    expect(user).toMatchObject({ role: 'OPERATOR_STAFF', operatorId: GUARD_OPERATOR.id })

    // Invite consumed — hashed with the file's shared sha256Hex, the same helper
    // production resolve() uses, so this is a true round-trip not a private copy.
    const consumed = await ctx.providerInviteRepo.findByTokenHash(sha256Hex(token))
    expect(consumed).toMatchObject({ status: 'ACCEPTED', acceptedByUserId: STAFF_USER.id })
  })

  test('manual OWNER path: platform admin mints, grant resolves OPERATOR_OWNER membership', async () => {
    // Step 1: PLATFORM_ADMIN mints an OPERATOR_OWNER invite via the admin route.
    const mintRes = await ctx.app.request('/admin/provider-invites', {
      method: 'POST',
      headers: await bearer({ sub: 'platform-admin-caller', role: 'PLATFORM_ADMIN' }),
      body: JSON.stringify({
        email: OWNER_USER.email,
        operatorId: GUARD_OPERATOR.id,
        role: 'OPERATOR_OWNER',
      }),
    })
    expect(mintRes.status).toBe(201)
    const mintData = (await mintRes.json()).data as { token: string }
    const { token } = mintData
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/)

    // Step 2: The incoming owner redeems the invite.
    const result = await ctx.grantService.resolve({
      userId: OWNER_USER.id,
      email: OWNER_USER.email,
      emailVerified: true,
      inviteToken: token,
    })

    // Grant result.
    expect(result).toEqual({
      type: 'granted',
      operatorId: GUARD_OPERATOR.id,
      role: 'OPERATOR_OWNER',
    })

    // Membership written.
    const membership = await ctx.operatorMembershipRepo.findActiveByUserId(OWNER_USER.id)
    expect(membership).toMatchObject({
      userId: OWNER_USER.id,
      operatorId: GUARD_OPERATOR.id,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })

    // User projected to OPERATOR_OWNER.
    const [user] = await ctx.userRepo.findByIds([OWNER_USER.id])
    expect(user).toMatchObject({ role: 'OPERATOR_OWNER', operatorId: GUARD_OPERATOR.id })

    // Invite consumed — shared sha256Hex round-trip (see STAFF path note).
    const consumed = await ctx.providerInviteRepo.findByTokenHash(sha256Hex(token))
    expect(consumed).toMatchObject({ status: 'ACCEPTED', acceptedByUserId: OWNER_USER.id })
  })
})
