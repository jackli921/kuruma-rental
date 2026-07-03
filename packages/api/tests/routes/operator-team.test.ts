import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import type { UserRole } from '../../src/middleware/auth'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryOperatorMembershipRepository } from '../../src/repositories/in-memory/operator-membership'
import { InMemoryProviderInviteRepository } from '../../src/repositories/in-memory/provider-invite'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { createOperatorTeamRoutes } from '../../src/routes/operator-team'
import { OperatorTeamService } from '../../src/services/operator-team'
import { ProviderInviteService } from '../../src/services/provider-invite'
import type { User } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

const FUTURE = new Date('2099-01-01T00:00:00Z')

let inviteRepo: InMemoryProviderInviteRepository
let membershipRepo: InMemoryOperatorMembershipRepository
let userRepo: InMemoryUserRepository

beforeEach(async () => {
  inviteRepo = new InMemoryProviderInviteRepository()
  membershipRepo = new InMemoryOperatorMembershipRepository()
  userRepo = new InMemoryUserRepository(
    new Map<string, User>([
      ['u_owner', user('u_owner', 'Olive Owner', 'owner@op1.com')],
      ['u_b', user('u_b', 'Bob B', 'bob@op2.com')],
    ]),
  )
})

function user(id: string, name: string, email: string): User {
  return { id, name, email, phone: null, language: 'en', country: null, role: 'OPERATOR_OWNER' }
}

function mountFor(role: UserRole, operatorId?: string) {
  const operatorRepo = new InMemoryOperatorRepository(
    new Map([
      [
        'op_1',
        {
          id: 'op_1',
          slug: 'one',
          name: 'Op One',
          preAuthHandoffUrl: null,
          createdAt: FUTURE,
          updatedAt: FUTURE,
        },
      ],
      [
        'op_2',
        {
          id: 'op_2',
          slug: 'two',
          name: 'Op Two',
          preAuthHandoffUrl: null,
          createdAt: FUTURE,
          updatedAt: FUTURE,
        },
      ],
    ]),
  )
  const inviteService = new ProviderInviteService(
    inviteRepo,
    operatorRepo,
    { webBaseUrl: 'https://app.example.com' },
    () => {},
  )
  const service = new OperatorTeamService(
    inviteRepo,
    membershipRepo,
    userRepo,
    inviteService,
    () => {},
  )
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  app.route('/', createOperatorTeamRoutes(service))
  return app
}

describe('POST /operators/me/invites', () => {
  it('mints an OPERATOR_STAFF invite for the caller operator (201) and returns the share URL', async () => {
    const res = await mountFor('OPERATOR_OWNER', 'op_1').request('/operators/me/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'New.Staff@op1.com' }),
    })
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.inviteUrl).toContain('/provider/invite/')
    expect(typeof data.expiresAt).toBe('string')

    const stored = await inviteRepo.listByOperator('op_1')
    expect(stored).toHaveLength(1)
    expect(stored[0]?.role).toBe('OPERATOR_STAFF')
    expect(stored[0]?.email).toBe('new.staff@op1.com')
  })

  it('forbids an OPERATOR_STAFF caller (403)', async () => {
    const res = await mountFor('OPERATOR_STAFF', 'op_1').request('/operators/me/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@op1.com' }),
    })
    expect(res.status).toBe(403)
    expect(await inviteRepo.listByOperator('op_1')).toHaveLength(0)
  })

  it('rejects a malformed email (400)', async () => {
    const res = await mountFor('OPERATOR_OWNER', 'op_1').request('/operators/me/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /operators/me/invites', () => {
  it('returns only the caller operator pending invites, projected without the token', async () => {
    await inviteRepo.create({
      email: 'mine@op1.com',
      operatorId: 'op_1',
      role: 'OPERATOR_STAFF',
      tokenHash: 'h1',
      status: 'PENDING',
      expiresAt: FUTURE,
      invitedByUserId: 'u_owner',
      acceptedByUserId: null,
    })
    await inviteRepo.create({
      email: 'theirs@op2.com',
      operatorId: 'op_2',
      role: 'OPERATOR_STAFF',
      tokenHash: 'h2',
      status: 'PENDING',
      expiresAt: FUTURE,
      invitedByUserId: 'u_b',
      acceptedByUserId: null,
    })
    const res = await mountFor('OPERATOR_OWNER', 'op_1').request('/operators/me/invites')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].email).toBe('mine@op1.com')
    expect(data[0]).not.toHaveProperty('tokenHash')
    expect(data[0]).not.toHaveProperty('invitedByUserId')
  })
})

describe('POST /operators/me/invites/:id/revoke', () => {
  async function seedInvite(operatorId: string, tokenHash: string): Promise<string> {
    const invite = await inviteRepo.create({
      email: `staff@${operatorId}.com`,
      operatorId,
      role: 'OPERATOR_STAFF',
      tokenHash,
      status: 'PENDING',
      expiresAt: FUTURE,
      invitedByUserId: 'u_owner',
      acceptedByUserId: null,
    })
    return invite.id
  }

  it('revokes the caller own pending invite (200) — it drops off the pending list', async () => {
    const id = await seedInvite('op_1', 'h1')
    const res = await mountFor('OPERATOR_OWNER', 'op_1').request(
      `/operators/me/invites/${id}/revoke`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    expect(await inviteRepo.listByOperator('op_1')).toHaveLength(0)
  })

  it('forbids an OPERATOR_STAFF caller (403) and leaves the invite pending', async () => {
    const id = await seedInvite('op_1', 'h1')
    const res = await mountFor('OPERATOR_STAFF', 'op_1').request(
      `/operators/me/invites/${id}/revoke`,
      { method: 'POST' },
    )
    expect(res.status).toBe(403)
    expect(await inviteRepo.listByOperator('op_1')).toHaveLength(1)
  })

  it('cannot revoke another tenant invite (404) — it stays pending', async () => {
    const id = await seedInvite('op_2', 'h2')
    const res = await mountFor('OPERATOR_OWNER', 'op_1').request(
      `/operators/me/invites/${id}/revoke`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
    expect(await inviteRepo.listByOperator('op_2')).toHaveLength(1)
  })
})

describe('GET /operators/me/members', () => {
  it('returns the caller operator ACTIVE members joined to user name + email', async () => {
    await membershipRepo.create({
      userId: 'u_owner',
      operatorId: 'op_1',
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    await membershipRepo.create({
      userId: 'u_b',
      operatorId: 'op_2',
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    const res = await mountFor('OPERATOR_STAFF', 'op_1').request('/operators/me/members')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      userId: 'u_owner',
      name: 'Olive Owner',
      email: 'owner@op1.com',
      role: 'OPERATOR_OWNER',
    })
  })
})

describe('POST /operators/me/members/:id/deactivate', () => {
  async function seedMember(
    userId: string,
    operatorId: string,
    role: 'OPERATOR_OWNER' | 'OPERATOR_STAFF',
  ): Promise<string> {
    const m = await membershipRepo.create({ userId, operatorId, role, status: 'ACTIVE' })
    return m.id
  }

  it('deactivates an active member (200) — they drop off the roster', async () => {
    await seedMember('u_owner', 'op_1', 'OPERATOR_OWNER')
    const staffId = await seedMember('u_staff', 'op_1', 'OPERATOR_STAFF')
    const res = await mountFor('OPERATOR_OWNER', 'op_1').request(
      `/operators/me/members/${staffId}/deactivate`,
      { method: 'POST' },
    )
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toEqual({ id: staffId })
    expect((await membershipRepo.findActiveByOperator('op_1')).map((m) => m.userId)).toEqual([
      'u_owner',
    ])
  })

  it('forbids an OPERATOR_STAFF caller (403) — both members stay active', async () => {
    await seedMember('u_owner', 'op_1', 'OPERATOR_OWNER')
    const staffId = await seedMember('u_staff', 'op_1', 'OPERATOR_STAFF')
    const res = await mountFor('OPERATOR_STAFF', 'op_1').request(
      `/operators/me/members/${staffId}/deactivate`,
      { method: 'POST' },
    )
    expect(res.status).toBe(403)
    expect(await membershipRepo.findActiveByOperator('op_1')).toHaveLength(2)
  })

  it('refuses deactivating the last active owner (409) — the owner stays active', async () => {
    const ownerId = await seedMember('u_owner', 'op_1', 'OPERATOR_OWNER')
    const res = await mountFor('OPERATOR_OWNER', 'op_1').request(
      `/operators/me/members/${ownerId}/deactivate`,
      { method: 'POST' },
    )
    expect(res.status).toBe(409)
    expect(await membershipRepo.findActiveByOperator('op_1')).toHaveLength(1)
  })

  it('cannot deactivate another tenant member (404) — it stays active', async () => {
    const otherId = await seedMember('u_b', 'op_2', 'OPERATOR_OWNER')
    const res = await mountFor('OPERATOR_OWNER', 'op_1').request(
      `/operators/me/members/${otherId}/deactivate`,
      { method: 'POST' },
    )
    expect(res.status).toBe(404)
    expect(await membershipRepo.findActiveByOperator('op_2')).toHaveLength(1)
  })
})

describe('read routes thread ?operatorId= for a picker-admin', () => {
  it('GET /operators/me/members?operatorId=op_2 returns op_2 members for a PLATFORM_ADMIN', async () => {
    await membershipRepo.create({
      userId: 'u_b',
      operatorId: 'op_2',
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    const res = await mountFor('PLATFORM_ADMIN').request('/operators/me/members?operatorId=op_2')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.map((m: { userId: string }) => m.userId)).toEqual(['u_b'])
  })

  it('GET /operators/me/members with NO pick is 422 for a PLATFORM_ADMIN (no merged view)', async () => {
    const res = await mountFor('PLATFORM_ADMIN').request('/operators/me/members')
    expect(res.status).toBe(422)
  })

  it('a RENTER is 403 even with ?operatorId= (team is owner-tier internal)', async () => {
    const res = await mountFor('RENTER').request('/operators/me/members?operatorId=op_1')
    expect(res.status).toBe(403)
  })

  it('an operator IGNORES a foreign ?operatorId= and reads its own tenant', async () => {
    await membershipRepo.create({
      userId: 'u_owner',
      operatorId: 'op_1',
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    await membershipRepo.create({
      userId: 'u_b',
      operatorId: 'op_2',
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    const res = await mountFor('OPERATOR_OWNER', 'op_1').request(
      '/operators/me/members?operatorId=op_2',
    )
    const { data } = await res.json()
    expect(data.map((m: { userId: string }) => m.userId)).toEqual(['u_owner'])
  })
})

describe('write routes as a picked operator (#1230)', () => {
  it('POST /operators/me/invites?operatorId=op_2 mints under op_2 for a PLATFORM_ADMIN (201)', async () => {
    const res = await mountFor('PLATFORM_ADMIN').request('/operators/me/invites?operatorId=op_2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@op2.com' }),
    })
    expect(res.status).toBe(201)
    expect(await inviteRepo.listByOperator('op_2')).toHaveLength(1)
  })

  it('POST invite with NO pick is 422 for a PLATFORM_ADMIN', async () => {
    const res = await mountFor('PLATFORM_ADMIN').request('/operators/me/invites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@x.com' }),
    })
    expect(res.status).toBe(422)
  })

  it('a bogus ?operatorId= on invite is 404 (c1), not 500', async () => {
    const res = await mountFor('PLATFORM_ADMIN').request(
      '/operators/me/invites?operatorId=op_ghost',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x@x.com' }),
      },
    )
    expect(res.status).toBe(404)
  })

  // G6a: a legacy STAFF/ADMIN passes requireOperatorOwnerWrite but the RESOLVER
  // denies it (403). This pins that the resolver, not the gate, is the deny point —
  // collapsing team onto resolveOperatorIdForWrite (which honors legacy admins)
  // would flip this to a cross-tenant 201 and fail here.
  it('denies a legacy STAFF write-with-?operatorId= at the resolver (403)', async () => {
    const res = await mountFor('STAFF').request('/operators/me/invites?operatorId=op_2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@op2.com' }),
    })
    expect(res.status).toBe(403)
    expect(await inviteRepo.listByOperator('op_2')).toHaveLength(0)
  })

  it('still forbids an OPERATOR_STAFF write even with a valid ?operatorId= (owner-tier gate)', async () => {
    const res = await mountFor('OPERATOR_STAFF', 'op_1').request(
      '/operators/me/invites?operatorId=op_1',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x@op1.com' }),
      },
    )
    expect(res.status).toBe(403)
  })
})
