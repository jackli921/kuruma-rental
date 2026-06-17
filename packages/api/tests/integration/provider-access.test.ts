import type { RunTx } from '@kuruma/shared/db'
import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { operatorMemberships, providerInvites, users } from '@kuruma/shared/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sha256Hex } from '../../src/auth/token-hash'
import { PG_ERROR, pgConstraintName, pgErrorCode } from '../../src/pg-errors'
import {
  DrizzleOperatorMembershipRepository,
  DrizzleProviderInviteRepository,
  DrizzleUserRepository,
  createDrizzleOperatorGrant,
} from '../../src/repositories/drizzle'
import type { Db } from '../../src/repositories/drizzle/shared'
import { createOperatorGrantService } from '../../src/services/operator-grant'
import { db } from './setup'

// #521 Slice A — the Drizzle repos against a real Postgres, where the
// partial-unique-active index is the actual race fence (an in-memory map can
// only mimic it; here we prove the DB enforces it). operatorId reuses the
// global-setup Best Car Rental operator (FK restrict).
const txDb = db as unknown as Db
const invites = new DrizzleProviderInviteRepository(txDb)
const memberships = new DrizzleOperatorMembershipRepository(txDb)
const userRepo = new DrizzleUserRepository(txDb)

// Slice B (B5) — the grant runs through a postgres-js interactive tx: the default
// neon-serverless runTx can't reach docker Postgres (#493), so inject one backed by
// the test client (which DOES roll back, unlike the in-memory passthrough).
const runOnTestDb: RunTx = (fn) => txDb.transaction(fn)
const grantService = createOperatorGrantService({
  memberships,
  invites,
  runGrant: createDrizzleOperatorGrant(runOnTestDb),
})

let userId: string
// Users seeded by the grant tests (distinct from `userId`), cleaned in afterAll.
const grantUserIds: string[] = []

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `provider-${Date.now()}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  if (!user) throw new Error('failed to seed user')
  userId = user.id
})

afterAll(async () => {
  const allUserIds = [userId, ...grantUserIds]
  await db
    .delete(providerInvites)
    .where(inArray(providerInvites.operatorId, [BEST_CAR_RENTAL_OPERATOR_ID]))
  await db.delete(operatorMemberships).where(inArray(operatorMemberships.userId, allUserIds))
  await db.delete(users).where(inArray(users.id, allUserIds))
})

describe('DrizzleProviderInviteRepository (postgres)', () => {
  it('create persists the invite and findByTokenHash returns it by hash', async () => {
    const created = await invites.create({
      email: 'invitee@example.com',
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      role: 'OPERATOR_OWNER',
      tokenHash: `hash-${crypto.randomUUID()}`,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: userId,
      acceptedByUserId: null,
    })

    expect(created.id).toMatch(/[0-9a-f-]{36}/)
    expect(created.status).toBe('PENDING')
    expect(created.createdAt).toBeInstanceOf(Date)

    const found = await invites.findByTokenHash(created.tokenHash)
    expect(found?.id).toBe(created.id)
    expect(found?.email).toBe('invitee@example.com')
    expect(found?.role).toBe('OPERATOR_OWNER')
  })

  it('findByTokenHash returns undefined for an unknown hash', async () => {
    expect(await invites.findByTokenHash('no-such-hash')).toBeUndefined()
  })

  // #904 slice 2: the partial-unique index is the real race fence — an in-memory
  // map only mimics it. A second PENDING invite for the same (operatorId, email)
  // aborts; revoking the first frees the slot so a re-invite then succeeds.
  it('partial-unique pending-email fence: a duplicate PENDING invite aborts, a revoke frees the slot', async () => {
    const email = `dup-${crypto.randomUUID()}@example.com`
    const mk = () => ({
      email,
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      role: 'OPERATOR_STAFF' as const,
      tokenHash: `hash-${crypto.randomUUID()}`,
      status: 'PENDING' as const,
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: userId,
      acceptedByUserId: null,
    })
    const first = await invites.create(mk())

    let thrown: unknown
    try {
      await invites.create(mk())
    } catch (err) {
      thrown = err
    }
    expect(pgErrorCode(thrown)).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(pgConstraintName(thrown)).toBe('provider_invites_pending_email_unique')

    await invites.revoke(first.id, BEST_CAR_RENTAL_OPERATOR_ID)
    const reinvite = await invites.create(mk())
    expect(reinvite.status).toBe('PENDING')
  })
})

describe('DrizzleOperatorMembershipRepository (postgres)', () => {
  it('create persists an ACTIVE membership and findActiveByUserId returns it', async () => {
    const created = await memberships.create({
      userId,
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })

    expect(created.status).toBe('ACTIVE')

    const active = await memberships.findActiveByUserId(userId)
    expect(active?.id).toBe(created.id)
    expect(active?.operatorId).toBe(BEST_CAR_RENTAL_OPERATOR_ID)
  })

  it('partial-unique-active fence: a second ACTIVE membership for the same user raises UNIQUE_VIOLATION', async () => {
    // The first ACTIVE row already exists from the previous test. A concurrent
    // double-accept would attempt a second ACTIVE row for the same user.
    let thrown: unknown
    try {
      await memberships.create({
        userId,
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
        role: 'OPERATOR_STAFF',
        status: 'ACTIVE',
      })
    } catch (err) {
      thrown = err
    }

    expect(pgErrorCode(thrown)).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(pgConstraintName(thrown)).toBe('operator_memberships_active_user_unique')
  })
})

describe('OperatorGrantService accept (postgres)', () => {
  async function seedRenter(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: `grant-${crypto.randomUUID()}@kuruma-test.com`,
        role: 'RENTER',
        language: 'en',
      })
      .returning()
    if (!user) throw new Error('failed to seed renter')
    grantUserIds.push(user.id)
    return user.id
  }

  async function seedPendingInvite(email: string): Promise<{ id: string; token: string }> {
    const token = `tok-${crypto.randomUUID()}`
    const created = await invites.create({
      email,
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      role: 'OPERATOR_OWNER',
      tokenHash: sha256Hex(token),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: null,
      acceptedByUserId: null,
    })
    return { id: created.id, token }
  }

  it('atomically commits the membership, the users projection, and the invite consumption', async () => {
    const renterId = await seedRenter()
    const email = `invitee-${crypto.randomUUID()}@example.com`
    const invite = await seedPendingInvite(email)

    const result = await grantService.resolve({
      userId: renterId,
      inviteToken: invite.token,
      email,
      emailVerified: true,
    })

    expect(result).toEqual({
      type: 'granted',
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      role: 'OPERATOR_OWNER',
    })

    const membership = await memberships.findActiveByUserId(renterId)
    expect(membership).toMatchObject({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      role: 'OPERATOR_OWNER',
      status: 'ACTIVE',
    })

    const [projected] = await db
      .select({ role: users.role, operatorId: users.operatorId })
      .from(users)
      .where(eq(users.id, renterId))
    expect(projected).toEqual({ role: 'OPERATOR_OWNER', operatorId: BEST_CAR_RENTAL_OPERATOR_ID })

    const consumed = await invites.findByTokenHash(sha256Hex(invite.token))
    expect(consumed).toMatchObject({ status: 'ACCEPTED', acceptedByUserId: renterId })
  })

  it('on a concurrent double-accept, exactly one ACTIVE membership commits and both callers are granted', async () => {
    const renterId = await seedRenter()
    const email = `invitee-${crypto.randomUUID()}@example.com`
    const invite = await seedPendingInvite(email)

    // Two concurrent accepts of the same invite by the same user (double-submit).
    // One tx wins the partial-unique-active index; the other aborts and re-reads
    // the committed winner — proving the real tx rolls back, not just the map.
    const [a, b] = await Promise.all([
      grantService.resolve({
        userId: renterId,
        inviteToken: invite.token,
        email,
        emailVerified: true,
      }),
      grantService.resolve({
        userId: renterId,
        inviteToken: invite.token,
        email,
        emailVerified: true,
      }),
    ])

    expect(a).toEqual({
      type: 'granted',
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      role: 'OPERATOR_OWNER',
    })
    expect(b).toEqual(a)

    const activeRows = await db
      .select({ id: operatorMemberships.id })
      .from(operatorMemberships)
      .where(
        and(eq(operatorMemberships.userId, renterId), eq(operatorMemberships.status, 'ACTIVE')),
      )
    expect(activeRows).toHaveLength(1)
  })
})

// #904 slice 2 — the deactivate path against real Postgres: the in-memory map can
// only mimic the scoped UPDATE...RETURNING and the FK-nulling projection clear;
// here we prove the DB does it (enum value, scoped WHERE, null operatorId FK).
describe('DrizzleOperatorMembershipRepository.deactivate + clearOperatorAccess (postgres)', () => {
  let memberUserId: string
  let membershipId: string

  beforeAll(async () => {
    const [u] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: `deact-${crypto.randomUUID()}@kuruma-test.com`,
        role: 'OPERATOR_STAFF',
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
        language: 'en',
      })
      .returning()
    if (!u) throw new Error('failed to seed member')
    memberUserId = u.id
    grantUserIds.push(memberUserId)
    const m = await memberships.create({
      userId: memberUserId,
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      role: 'OPERATOR_STAFF',
      status: 'ACTIVE',
    })
    membershipId = m.id
  })

  it('is a no-op for a foreign operatorId (scoped) — the row stays ACTIVE', async () => {
    expect(await memberships.deactivate(membershipId, 'op_not_mine')).toBeUndefined()
    expect((await memberships.findActiveByUserId(memberUserId))?.status).toBe('ACTIVE')
  })

  it('flips ACTIVE -> REVOKED, returns the row, frees the active slot, and is idempotent', async () => {
    const revoked = await memberships.deactivate(membershipId, BEST_CAR_RENTAL_OPERATOR_ID)
    expect(revoked?.id).toBe(membershipId)
    expect(revoked?.status).toBe('REVOKED')
    expect(await memberships.findActiveByUserId(memberUserId)).toBeUndefined()
    // Only an ACTIVE row transitions, so a second deactivate matches nothing.
    expect(await memberships.deactivate(membershipId, BEST_CAR_RENTAL_OPERATOR_ID)).toBeUndefined()
  })

  it('clearOperatorAccess tears the projection down to a plain RENTER (null operatorId)', async () => {
    await userRepo.clearOperatorAccess(memberUserId)
    const [projected] = await db
      .select({ role: users.role, operatorId: users.operatorId })
      .from(users)
      .where(eq(users.id, memberUserId))
    expect(projected).toEqual({ role: 'RENTER', operatorId: null })
  })
})
