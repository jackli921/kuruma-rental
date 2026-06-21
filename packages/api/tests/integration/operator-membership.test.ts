import { BEST_CAR_RENTAL_OPERATOR_ID, SECOND_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { operatorMemberships, users } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DrizzleOperatorMembershipRepository } from '../../src/repositories/drizzle'
import { InMemoryOperatorMembershipRepository } from '../../src/repositories/in-memory/operator-membership'
import type { OperatorMembership } from '../../src/stores'
import { cleanupUsers, db } from './setup'

// #1010: proves findActiveByOperators against REAL Postgres. The InMemory unit
// tests cover the contract; only this exercises the `operatorId = ANY(...)`
// (inArray) read + the (createdAt, id) ORDER BY + app-side grouping — and that the
// Drizzle SQL returns the SAME grouped shape as the InMemory filter (adapter
// parity), so swapping adapters can never change who the digest emails.

const SUFFIX = Date.now()
const uid = (s: string) => `m1010-${s}-${SUFFIX}`
const EARLY = new Date('2026-01-01T00:00:00Z')
const LATE = new Date('2026-02-01T00:00:00Z')

// op A (BEST_CAR): two ACTIVE members (early, late) + one REVOKED (must drop out).
// op B (SECOND): one ACTIVE member. The LATE member is listed first so a missing
// ORDER BY would surface as reversed output.
const ROWS: OperatorMembership[] = [
  {
    id: uid('a-late'),
    userId: uid('u-a-late'),
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    role: 'OPERATOR_STAFF',
    status: 'ACTIVE',
    createdAt: LATE,
    updatedAt: LATE,
  },
  {
    id: uid('a-early'),
    userId: uid('u-a-early'),
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    role: 'OPERATOR_OWNER',
    status: 'ACTIVE',
    createdAt: EARLY,
    updatedAt: EARLY,
  },
  {
    id: uid('a-revoked'),
    userId: uid('u-a-revoked'),
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    role: 'OPERATOR_STAFF',
    status: 'REVOKED',
    createdAt: EARLY,
    updatedAt: EARLY,
  },
  {
    id: uid('b-solo'),
    userId: uid('u-b'),
    operatorId: SECOND_OPERATOR_ID,
    role: 'OPERATOR_OWNER',
    status: 'ACTIVE',
    createdAt: EARLY,
    updatedAt: EARLY,
  },
]
const USER_IDS = ROWS.map((r) => r.userId)
const MY = new Set(USER_IDS)
// Other integration files share these operators, so assert only on the users this
// test seeded; filtering preserves their relative (createdAt, id) order.
const mine = (members?: OperatorMembership[]) =>
  (members ?? []).map((m) => m.userId).filter((id) => MY.has(id))

beforeAll(async () => {
  await db.insert(users).values(
    USER_IDS.map((id) => ({
      id,
      email: `${id}@kuruma-test.com`,
      role: 'OPERATOR_STAFF' as const,
      language: 'ja',
    })),
  )
  await db.insert(operatorMemberships).values(ROWS)
})

afterAll(async () => {
  await db.delete(operatorMemberships).where(
    inArray(
      operatorMemberships.id,
      ROWS.map((r) => r.id),
    ),
  )
  await cleanupUsers(USER_IDS) // memberships also cascade on user delete; explicit delete first is belt-and-braces
})

describe('DrizzleOperatorMembershipRepository.findActiveByOperators (#1010)', () => {
  const repo = new DrizzleOperatorMembershipRepository(db)
  const ids = [BEST_CAR_RENTAL_OPERATOR_ID, SECOND_OPERATOR_ID]

  it('groups each operator’s ACTIVE members, ordered by (createdAt, id), excluding REVOKED', async () => {
    const byOp = await repo.findActiveByOperators(ids)
    expect(mine(byOp.get(BEST_CAR_RENTAL_OPERATOR_ID))).toEqual([uid('u-a-early'), uid('u-a-late')])
    expect(mine(byOp.get(SECOND_OPERATOR_ID))).toEqual([uid('u-b')])
    // the REVOKED member is absent from the ACTIVE-only result
    expect(mine(byOp.get(BEST_CAR_RENTAL_OPERATOR_ID))).not.toContain(uid('u-a-revoked'))
  })

  it('matches the InMemory repo for the same rows (adapter parity)', async () => {
    const inMemory = new InMemoryOperatorMembershipRepository(
      new Map(ROWS.map((r) => [r.id, { ...r }])),
    )
    const fromDrizzle = await repo.findActiveByOperators(ids)
    const fromMemory = await inMemory.findActiveByOperators(ids)
    // `mine()` is load-bearing on the Drizzle side (strips concurrently-seeded
    // foreign members) and a no-op on the InMemory side (built only from ROWS) —
    // applied to both so the comparison is symmetric.
    const shape = (m: Map<string, OperatorMembership[]>) => ids.map((id) => [id, mine(m.get(id))])
    expect(shape(fromDrizzle)).toEqual(shape(fromMemory))
  })
})
