import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { operatorMemberships, providerInvites, users } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PG_ERROR, pgConstraintName, pgErrorCode } from '../../src/pg-errors'
import {
  DrizzleOperatorMembershipRepository,
  DrizzleProviderInviteRepository,
} from '../../src/repositories/drizzle'
import type { Db } from '../../src/repositories/drizzle/shared'
import { db } from './setup'

// #521 Slice A — the Drizzle repos against a real Postgres, where the
// partial-unique-active index is the actual race fence (an in-memory map can
// only mimic it; here we prove the DB enforces it). operatorId reuses the
// global-setup Best Car Rental operator (FK restrict).
const invites = new DrizzleProviderInviteRepository(db as unknown as Db)
const memberships = new DrizzleOperatorMembershipRepository(db as unknown as Db)

let userId: string

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
  await db
    .delete(providerInvites)
    .where(inArray(providerInvites.operatorId, [BEST_CAR_RENTAL_OPERATOR_ID]))
  await db.delete(operatorMemberships).where(inArray(operatorMemberships.userId, [userId]))
  await db.delete(users).where(inArray(users.id, [userId]))
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
