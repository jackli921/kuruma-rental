import { beforeEach, describe, expect, it } from 'vitest'
import { PG_ERROR } from '../../src/pg-errors'
import { InMemoryOperatorMembershipRepository } from '../../src/repositories/in-memory'
import type { OperatorMembership } from '../../src/stores'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function membershipInput(overrides?: Partial<OperatorMembership>) {
  return {
    userId: 'user_1',
    operatorId: 'op_test',
    role: 'OPERATOR_OWNER' as const,
    status: 'ACTIVE' as const,
    ...overrides,
  }
}

describe('InMemoryOperatorMembershipRepository', () => {
  let repo: InMemoryOperatorMembershipRepository

  beforeEach(() => {
    repo = new InMemoryOperatorMembershipRepository()
  })

  it('create assigns a UUID + timestamps and persists every field', async () => {
    const m = await repo.create(membershipInput())
    expect(m.id).toMatch(UUID_RE)
    expect(m.createdAt).toBeInstanceOf(Date)
    expect(m.updatedAt).toBeInstanceOf(Date)
    expect(m.userId).toBe('user_1')
    expect(m.operatorId).toBe('op_test')
    expect(m.role).toBe('OPERATOR_OWNER')
    expect(m.status).toBe('ACTIVE')
  })

  it('findActiveByUserId returns the user’s active membership', async () => {
    const m = await repo.create(membershipInput())
    const found = await repo.findActiveByUserId('user_1')
    expect(found?.id).toBe(m.id)
  })

  it('findActiveByUserId returns undefined when the user has no active membership', async () => {
    expect(await repo.findActiveByUserId('ghost')).toBeUndefined()
  })

  it('create rejects a second ACTIVE membership for one user with UNIQUE_VIOLATION (mirrors the partial-unique-active index)', async () => {
    await repo.create(membershipInput({ userId: 'u' }))
    await expect(
      repo.create(membershipInput({ userId: 'u', operatorId: 'op_other' })),
    ).rejects.toMatchObject({ code: PG_ERROR.UNIQUE_VIOLATION })
  })

  it('allows a new ACTIVE membership once a prior membership is REVOKED (partial index frees the slot)', async () => {
    await repo.create(membershipInput({ userId: 'u', status: 'REVOKED' }))
    const m = await repo.create(membershipInput({ userId: 'u' }))
    expect(m.status).toBe('ACTIVE')
  })

  // #878: the booking-alert recipient set. Owner AND staff, ACTIVE only, scoped
  // to one operator — sourced from the ledger (not the stale users.role projection).
  describe('findActiveByOperator', () => {
    it('returns every ACTIVE member of the operator — owner and staff', async () => {
      const owner = await repo.create(
        membershipInput({ userId: 'u_owner', role: 'OPERATOR_OWNER' }),
      )
      const staff = await repo.create(
        membershipInput({ userId: 'u_staff', role: 'OPERATOR_STAFF' }),
      )
      const members = await repo.findActiveByOperator('op_test')
      expect(members.map((m) => m.id).sort()).toEqual([owner.id, staff.id].sort())
    })

    it('excludes REVOKED members', async () => {
      await repo.create(membershipInput({ userId: 'u_active' }))
      await repo.create(membershipInput({ userId: 'u_gone', status: 'REVOKED' }))
      const members = await repo.findActiveByOperator('op_test')
      expect(members.map((m) => m.userId)).toEqual(['u_active'])
    })

    it('excludes members of other operators', async () => {
      await repo.create(membershipInput({ userId: 'u_mine' }))
      await repo.create(membershipInput({ userId: 'u_theirs', operatorId: 'op_other' }))
      const members = await repo.findActiveByOperator('op_test')
      expect(members.map((m) => m.userId)).toEqual(['u_mine'])
    })

    it('returns [] for an operator with no members', async () => {
      expect(await repo.findActiveByOperator('op_empty')).toEqual([])
    })

    // #878: the joined recipient list is written to a single notification_log audit
    // column, so the order must be deterministic (by membership createdAt), not
    // insertion/Map order — otherwise the audit string churns between resends.
    it('orders members by createdAt so the audit string is stable', async () => {
      const earlier = new Date('2026-01-01T00:00:00Z')
      const later = new Date('2026-02-01T00:00:00Z')
      const mk = (userId: string, createdAt: Date): OperatorMembership => ({
        id: `mem-${userId}`,
        userId,
        operatorId: 'op_test',
        role: 'OPERATOR_OWNER',
        status: 'ACTIVE',
        createdAt,
        updatedAt: createdAt,
      })
      // Seed with the newer membership FIRST so Map insertion order is the reverse
      // of the expected createdAt order — a missing ORDER BY would surface here.
      const store = new Map<string, OperatorMembership>([
        ['mem-newer', mk('u_newer', later)],
        ['mem-older', mk('u_older', earlier)],
      ])
      const seeded = new InMemoryOperatorMembershipRepository(store)
      const members = await seeded.findActiveByOperator('op_test')
      expect(members.map((m) => m.userId)).toEqual(['u_older', 'u_newer'])
    })
  })

  // #1010: batch sibling of findActiveByOperator. The compliance digest resolves
  // EVERY alert-band operator's recipients in a constant number of queries, so it
  // needs the active members of many operators grouped in one call (no per-operator
  // N+1). Same ledger semantics + (createdAt, id) order as the single-operator read.
  describe('findActiveByOperators', () => {
    it('groups each requested operator’s ACTIVE members, keyed by operatorId', async () => {
      await repo.create(membershipInput({ userId: 'a1', operatorId: 'op_a' }))
      await repo.create(membershipInput({ userId: 'b1', operatorId: 'op_b' }))
      const byOp = await repo.findActiveByOperators(['op_a', 'op_b'])
      expect(byOp.get('op_a')?.map((m) => m.userId)).toEqual(['a1'])
      expect(byOp.get('op_b')?.map((m) => m.userId)).toEqual(['b1'])
    })

    it('excludes REVOKED members and operators that were not requested', async () => {
      await repo.create(membershipInput({ userId: 'live', operatorId: 'op_a' }))
      await repo.create(membershipInput({ userId: 'gone', operatorId: 'op_a', status: 'REVOKED' }))
      await repo.create(membershipInput({ userId: 'other', operatorId: 'op_unasked' }))
      const byOp = await repo.findActiveByOperators(['op_a'])
      expect(byOp.get('op_a')?.map((m) => m.userId)).toEqual(['live'])
      expect(byOp.has('op_unasked')).toBe(false)
    })

    it('omits operators with no active members (absent key, not an empty list)', async () => {
      await repo.create(membershipInput({ userId: 'x', operatorId: 'op_a' }))
      const byOp = await repo.findActiveByOperators(['op_a', 'op_empty'])
      expect(byOp.has('op_empty')).toBe(false)
    })

    it('returns an empty map for no requested operators', async () => {
      await repo.create(membershipInput({ userId: 'x', operatorId: 'op_a' }))
      expect((await repo.findActiveByOperators([])).size).toBe(0)
    })

    // Same audit-stability guarantee as the single read: each operator’s list is
    // ordered by (createdAt, id), independent of store insertion order.
    it('orders each operator’s members by createdAt so the audit string is stable', async () => {
      const mk = (id: string, userId: string, createdAt: Date): OperatorMembership => ({
        id,
        userId,
        operatorId: 'op_a',
        role: 'OPERATOR_OWNER',
        status: 'ACTIVE',
        createdAt,
        updatedAt: createdAt,
      })
      const early = new Date('2026-01-01T00:00:00Z')
      const late = new Date('2026-02-01T00:00:00Z')
      // Newer seeded first, so a missing ORDER BY would surface as reversed output.
      const store = new Map<string, OperatorMembership>([
        ['m-newer', mk('m-newer', 'u_newer', late)],
        ['m-older', mk('m-older', 'u_older', early)],
      ])
      const seeded = new InMemoryOperatorMembershipRepository(store)
      const byOp = await seeded.findActiveByOperators(['op_a'])
      expect(byOp.get('op_a')?.map((m) => m.userId)).toEqual(['u_older', 'u_newer'])
    })
  })

  // #904 slice 2: the owner deactivates a member. ACTIVE -> REVOKED, scoped to
  // (id, operatorId) so a tenant can only touch its own rows; a no-match reads as
  // undefined (the service maps that to a 404, never a cross-tenant oracle).
  describe('deactivate', () => {
    it('flips an ACTIVE membership to REVOKED, frees the active slot, and returns the row', async () => {
      const m = await repo.create(membershipInput({ userId: 'u' }))
      const before = m.updatedAt
      const revoked = await repo.deactivate(m.id, 'op_test')
      expect(revoked?.id).toBe(m.id)
      expect(revoked?.status).toBe('REVOKED')
      expect(revoked?.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      // Drops off the active set + frees the partial-unique slot for a re-invite.
      expect(await repo.findActiveByUserId('u')).toBeUndefined()
      expect(await repo.findActiveByOperator('op_test')).toEqual([])
    })

    it('returns undefined for another operator id (scoped) and leaves the row ACTIVE', async () => {
      const m = await repo.create(membershipInput({ userId: 'u' }))
      expect(await repo.deactivate(m.id, 'op_other')).toBeUndefined()
      expect((await repo.findActiveByUserId('u'))?.status).toBe('ACTIVE')
    })

    it('returns undefined for an unknown id', async () => {
      expect(await repo.deactivate('nope', 'op_test')).toBeUndefined()
    })

    it('returns undefined when the membership is already REVOKED (only ACTIVE transitions)', async () => {
      const m = await repo.create(membershipInput({ userId: 'u', status: 'REVOKED' }))
      expect(await repo.deactivate(m.id, 'op_test')).toBeUndefined()
    })
  })
})
