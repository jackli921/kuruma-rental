import { beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../src/auth/context'
import { ForbiddenError, NotFoundError } from '../../src/auth/guards'
import { InMemoryOperatorRepository } from '../../src/repositories/in-memory/operator'
import { InMemoryOperatorMembershipRepository } from '../../src/repositories/in-memory/operator-membership'
import { InMemoryProviderInviteRepository } from '../../src/repositories/in-memory/provider-invite'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { OperatorTeamService } from '../../src/services/operator-team'
import { ProviderInviteService } from '../../src/services/provider-invite'
import type { Operator, User } from '../../src/stores'

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
const FUTURE = new Date('2099-01-01T00:00:00Z')

const OWNER_CTX: CallerContext = { userId: 'u_owner', role: 'OPERATOR_OWNER', operatorId: 'op_1' }
const STAFF_CTX: CallerContext = { userId: 'u_staff', role: 'OPERATOR_STAFF', operatorId: 'op_1' }
// PLATFORM_ADMIN passes requireOperatorOwnerWrite but carries NO operatorId — the
// `/operators/me/*` surface must reject it, not mint against `undefined`.
const ADMIN_CTX: CallerContext = { userId: 'u_admin', role: 'PLATFORM_ADMIN' }

function makeOperator(id: string, slug: string): Operator {
  return {
    id,
    slug,
    name: `Operator ${slug}`,
    preAuthHandoffUrl: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

function makeUser(id: string, name: string, email: string): User {
  return { id, name, email, phone: null, language: 'en', country: null, role: 'OPERATOR_OWNER' }
}

let inviteRepo: InMemoryProviderInviteRepository
let membershipRepo: InMemoryOperatorMembershipRepository
let userRepo: InMemoryUserRepository
let service: OperatorTeamService

beforeEach(() => {
  inviteRepo = new InMemoryProviderInviteRepository()
  membershipRepo = new InMemoryOperatorMembershipRepository()
  userRepo = new InMemoryUserRepository(
    new Map([
      ['u_owner', makeUser('u_owner', 'Olive Owner', 'owner@x.com')],
      ['u_other', makeUser('u_other', 'Otto Other', 'other@x.com')],
    ]),
  )
  const operatorRepo = new InMemoryOperatorRepository(
    new Map([
      ['op_1', makeOperator('op_1', 'one')],
      ['op_2', makeOperator('op_2', 'two')],
    ]),
  )
  const inviteService = new ProviderInviteService(
    inviteRepo,
    operatorRepo,
    { webBaseUrl: 'https://app.example.com' },
    () => {},
  )
  service = new OperatorTeamService(inviteRepo, membershipRepo, userRepo, inviteService)
})

describe('OperatorTeamService.inviteStaff', () => {
  it('mints an OPERATOR_STAFF invite scoped to the caller operator, stamping the inviter', async () => {
    const result = await service.inviteStaff(OWNER_CTX, { email: 'new@x.com' })
    expect(result.inviteUrl).toContain('/provider/invite/')

    const stored = await inviteRepo.listByOperator('op_1')
    expect(stored).toHaveLength(1)
    expect(stored[0]?.role).toBe('OPERATOR_STAFF')
    expect(stored[0]?.operatorId).toBe('op_1')
    expect(stored[0]?.email).toBe('new@x.com')
    expect(stored[0]?.invitedByUserId).toBe('u_owner')
  })

  it('refuses an OPERATOR_STAFF caller (403) and writes nothing', async () => {
    await expect(service.inviteStaff(STAFF_CTX, { email: 'new@x.com' })).rejects.toThrow(
      ForbiddenError,
    )
    expect(await inviteRepo.listByOperator('op_1')).toHaveLength(0)
  })

  it('refuses a caller with no operatorId (e.g. PLATFORM_ADMIN) — never mints against undefined', async () => {
    await expect(service.inviteStaff(ADMIN_CTX, { email: 'new@x.com' })).rejects.toThrow(
      ForbiddenError,
    )
  })
})

describe('OperatorTeamService.listInvites', () => {
  it('returns only the caller operator PENDING invites, projected without the token', async () => {
    await service.inviteStaff(OWNER_CTX, { email: 'mine@x.com' })
    await inviteRepo.create({
      email: 'theirs@x.com',
      operatorId: 'op_2',
      role: 'OPERATOR_STAFF',
      tokenHash: 'h_other',
      status: 'PENDING',
      expiresAt: FUTURE,
      invitedByUserId: 'u_other',
      acceptedByUserId: null,
    })

    const invites = await service.listInvites(OWNER_CTX)
    expect(invites).toHaveLength(1)
    expect(invites[0]?.email).toBe('mine@x.com')
    expect(invites[0]?.role).toBe('OPERATOR_STAFF')
    expect(invites[0]?.status).toBe('PENDING')
    expect(invites[0]?.expiresAt).toMatch(ISO_RE)
    expect(invites[0]?.createdAt).toMatch(ISO_RE)
    // A token (or its hash / the inviter) must never reach the team page.
    expect(invites[0]).not.toHaveProperty('tokenHash')
    expect(invites[0]).not.toHaveProperty('invitedByUserId')
  })

  it('refuses a caller with no operatorId (403)', async () => {
    await expect(service.listInvites(ADMIN_CTX)).rejects.toThrow(ForbiddenError)
  })
})

describe('OperatorTeamService.listMembers', () => {
  it('returns only the caller operator ACTIVE members, joined to user name + email', async () => {
    await membershipRepo.create({
      userId: 'u_owner',
      operatorId: 'op_1',
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })
    await membershipRepo.create({
      userId: 'u_other',
      operatorId: 'op_2',
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })

    const members = await service.listMembers(OWNER_CTX)
    expect(members).toHaveLength(1)
    expect(members[0]?.userId).toBe('u_owner')
    expect(members[0]?.name).toBe('Olive Owner')
    expect(members[0]?.email).toBe('owner@x.com')
    expect(members[0]?.role).toBe('OPERATOR_OWNER')
    expect(members[0]?.status).toBe('ACTIVE')
    expect(members[0]?.joinedAt).toMatch(ISO_RE)
  })

  it('refuses a caller with no operatorId (403)', async () => {
    await expect(service.listMembers(ADMIN_CTX)).rejects.toThrow(ForbiddenError)
  })
})

describe('OperatorTeamService.revokeInvite', () => {
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

  it('lets the owner revoke their own pending invite — it drops off the team page', async () => {
    const id = await seedInvite('op_1', 'h_mine')
    await service.revokeInvite(OWNER_CTX, id)
    expect(await service.listInvites(OWNER_CTX)).toHaveLength(0)
  })

  it('refuses an OPERATOR_STAFF caller (403) and leaves the invite pending', async () => {
    const id = await seedInvite('op_1', 'h_mine')
    await expect(service.revokeInvite(STAFF_CTX, id)).rejects.toThrow(ForbiddenError)
    expect(await service.listInvites(OWNER_CTX)).toHaveLength(1)
  })

  it('refuses a caller with no operatorId (403)', async () => {
    const id = await seedInvite('op_1', 'h_mine')
    await expect(service.revokeInvite(ADMIN_CTX, id)).rejects.toThrow(ForbiddenError)
  })

  it('cannot revoke another tenant invite (404) — the target stays pending', async () => {
    const otherId = await seedInvite('op_2', 'h_theirs')
    await expect(service.revokeInvite(OWNER_CTX, otherId)).rejects.toThrow(NotFoundError)
    expect(await inviteRepo.listByOperator('op_2')).toHaveLength(1)
  })

  it('throws NotFoundError for an unknown invite id (404)', async () => {
    await expect(service.revokeInvite(OWNER_CTX, 'nope')).rejects.toThrow(NotFoundError)
  })
})
