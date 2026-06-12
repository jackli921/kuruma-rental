import { beforeEach, describe, expect, it } from 'vitest'
import { sha256Hex } from '../auth/token-hash'
import { InMemoryOperatorMembershipRepository } from '../repositories/in-memory/operator-membership'
import { InMemoryProviderInviteRepository } from '../repositories/in-memory/provider-invite'
import { InMemoryUserRepository } from '../repositories/in-memory/user'
import type { OperatorMembershipRepository, RunOperatorGrant } from '../repositories/types'
import type { OperatorMembership, ProviderInvite, User } from '../stores'
import { createOperatorGrantService } from './operator-grant'

const USER_ID = 'user-1'
const OPERATOR_ID = 'op-1'
const EMAIL = 'owner@operator.test'
const TOKEN = 'invite-token-abc'

function setup() {
  const userStore = new Map<string, User>([
    [
      USER_ID,
      {
        id: USER_ID,
        name: 'Owner',
        email: EMAIL,
        phone: null,
        language: 'en',
        country: null,
        role: 'RENTER',
      },
    ],
  ])
  const memberStore = new Map<string, OperatorMembership>()
  const memberships = new InMemoryOperatorMembershipRepository(memberStore)
  const invites = new InMemoryProviderInviteRepository()
  const users = new InMemoryUserRepository(userStore)
  // In-memory grant passthrough (single-threaded, no real tx) — the same shape
  // index.ts wires for the override / in-memory branches.
  const service = createOperatorGrantService({
    memberships,
    invites,
    runGrant: (fn) => fn({ memberships, users, invites }),
  })
  return { service, memberships, invites, users, memberStore }
}

function seedInvite(
  invites: InMemoryProviderInviteRepository,
  overrides: Partial<Omit<ProviderInvite, 'id' | 'createdAt' | 'updatedAt'>> = {},
) {
  return invites.create({
    email: EMAIL,
    operatorId: OPERATOR_ID,
    role: 'OPERATOR_OWNER',
    tokenHash: sha256Hex(TOKEN),
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    invitedByUserId: 'admin-1',
    acceptedByUserId: null,
    ...overrides,
  })
}

describe('OperatorGrantService', () => {
  let ctx: ReturnType<typeof setup>
  beforeEach(() => {
    ctx = setup()
  })

  it('grants from an existing active membership, short-circuiting before invites', async () => {
    await ctx.memberships.create({
      userId: USER_ID,
      operatorId: OPERATOR_ID,
      role: 'OPERATOR_STAFF',
      status: 'ACTIVE',
    })

    // A bogus token is supplied to prove the membership path returns first.
    const result = await ctx.service.resolve({
      userId: USER_ID,
      inviteToken: 'ignored',
      email: EMAIL,
      emailVerified: true,
    })

    expect(result).toEqual({ type: 'granted', operatorId: OPERATOR_ID, role: 'OPERATOR_STAFF' })
  })

  it('returns access_not_found with no membership and no invite token', async () => {
    expect(await ctx.service.resolve({ userId: USER_ID })).toEqual({ type: 'access_not_found' })
  })

  it('returns access_not_found when a token is presented without an email', async () => {
    await seedInvite(ctx.invites)
    expect(
      await ctx.service.resolve({ userId: USER_ID, inviteToken: TOKEN, emailVerified: true }),
    ).toEqual({ type: 'access_not_found' })
  })

  it('returns access_not_found when the email is not Google-verified', async () => {
    await seedInvite(ctx.invites)
    expect(
      await ctx.service.resolve({
        userId: USER_ID,
        inviteToken: TOKEN,
        email: EMAIL,
        emailVerified: false,
      }),
    ).toEqual({ type: 'access_not_found' })
  })

  it('returns invite_invalid when the token matches no invite', async () => {
    expect(
      await ctx.service.resolve({
        userId: USER_ID,
        inviteToken: 'unknown',
        email: EMAIL,
        emailVerified: true,
      }),
    ).toEqual({ type: 'invite_invalid' })
  })

  it('returns invite_invalid when the invite was already accepted', async () => {
    await seedInvite(ctx.invites, { status: 'ACCEPTED', acceptedByUserId: 'someone-else' })
    expect(
      await ctx.service.resolve({
        userId: USER_ID,
        inviteToken: TOKEN,
        email: EMAIL,
        emailVerified: true,
      }),
    ).toEqual({ type: 'invite_invalid' })
  })

  it('returns invite_invalid when the invite has expired', async () => {
    await seedInvite(ctx.invites, { expiresAt: new Date(Date.now() - 1000) })
    expect(
      await ctx.service.resolve({
        userId: USER_ID,
        inviteToken: TOKEN,
        email: EMAIL,
        emailVerified: true,
      }),
    ).toEqual({ type: 'invite_invalid' })
  })

  it('returns invite_invalid when the verified email does not match the invite', async () => {
    await seedInvite(ctx.invites)
    expect(
      await ctx.service.resolve({
        userId: USER_ID,
        inviteToken: TOKEN,
        email: 'someone.else@operator.test',
        emailVerified: true,
      }),
    ).toEqual({ type: 'invite_invalid' })
  })

  it('grants and performs all three writes for a valid, email-matched invite', async () => {
    const invite = await seedInvite(ctx.invites)

    // Mixed-case email proves the match is case-insensitive on both sides.
    const result = await ctx.service.resolve({
      userId: USER_ID,
      inviteToken: TOKEN,
      email: EMAIL.toUpperCase(),
      emailVerified: true,
    })

    expect(result).toEqual({ type: 'granted', operatorId: OPERATOR_ID, role: 'OPERATOR_OWNER' })

    const membership = await ctx.memberships.findActiveByUserId(USER_ID)
    expect(membership).toMatchObject({
      userId: USER_ID,
      operatorId: OPERATOR_ID,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })

    const [user] = await ctx.users.findByIds([USER_ID])
    expect(user).toMatchObject({ role: 'OPERATOR_OWNER', operatorId: OPERATOR_ID })

    const consumed = await ctx.invites.findByTokenHash(sha256Hex(TOKEN))
    expect(consumed).toMatchObject({ id: invite.id, status: 'ACCEPTED', acceptedByUserId: USER_ID })
  })

  it('grants both callers from the single winning membership on a concurrent double-accept', async () => {
    await seedInvite(ctx.invites)

    const [a, b] = await Promise.all([
      ctx.service.resolve({
        userId: USER_ID,
        inviteToken: TOKEN,
        email: EMAIL,
        emailVerified: true,
      }),
      ctx.service.resolve({
        userId: USER_ID,
        inviteToken: TOKEN,
        email: EMAIL,
        emailVerified: true,
      }),
    ])

    expect(a).toEqual({ type: 'granted', operatorId: OPERATOR_ID, role: 'OPERATOR_OWNER' })
    expect(b).toEqual({ type: 'granted', operatorId: OPERATOR_ID, role: 'OPERATOR_OWNER' })

    // The partial-unique-active fence leaves exactly one membership row; the
    // losing tx re-read that winner instead of minting from its stale snapshot.
    expect(ctx.memberStore.size).toBe(1)
  })

  it('grants the accept-race loser whose invite is already consumed but whose membership the winner just committed', async () => {
    // The dangerous race the postgres integration test catches non-deterministically:
    // B's step-1 membership read sees nothing, then the winner commits (membership +
    // invite ACCEPTED) before B reads the invite. B must re-read the winner's
    // membership and grant — NOT mistake the consumed invite for a bad one. Modelled
    // here with a stateful fake: no membership on the first read, the winner on the
    // re-read.
    await seedInvite(ctx.invites, { status: 'ACCEPTED', acceptedByUserId: USER_ID })
    const winner: OperatorMembership = {
      id: 'm-winner',
      userId: USER_ID,
      operatorId: OPERATOR_ID,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    let reads = 0
    const memberships: Pick<OperatorMembershipRepository, 'findActiveByUserId'> = {
      findActiveByUserId: async () => (reads++ === 0 ? undefined : winner),
    }
    const runGrant: RunOperatorGrant = () => {
      throw new Error('runGrant must not run — the consumed-invite re-read skips the write')
    }
    const service = createOperatorGrantService({ memberships, invites: ctx.invites, runGrant })

    const result = await service.resolve({
      userId: USER_ID,
      inviteToken: TOKEN,
      email: EMAIL,
      emailVerified: true,
    })

    expect(result).toEqual({ type: 'granted', operatorId: OPERATOR_ID, role: 'OPERATOR_OWNER' })
    expect(reads).toBe(2) // step-1 (null) + the consumed-invite re-read (winner)
  })
})
