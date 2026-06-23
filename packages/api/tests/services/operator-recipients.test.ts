import { describe, expect, it } from 'vitest'
import { InMemoryOperatorMembershipRepository } from '../../src/repositories/in-memory/operator-membership'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import {
  makeResolveOperatorRecipients,
  makeResolveOperatorRecipientsBatch,
} from '../../src/services/operator-recipients'
import type { OperatorMembership, User } from '../../src/stores'

const OP = 'op-1'

function user(id: string, email: string | null): User {
  return {
    id,
    name: id,
    email,
    phone: null,
    language: 'ja',
    country: null,
    role: 'OPERATOR_STAFF',
    operatorId: OP,
  }
}

function member(id: string, userId: string, createdAt: Date): OperatorMembership {
  return {
    id,
    userId,
    operatorId: OP,
    role: 'OPERATOR_STAFF',
    status: 'ACTIVE',
    createdAt,
    updatedAt: createdAt,
  }
}

function build(members: OperatorMembership[], users: User[]) {
  const membershipRepo = new InMemoryOperatorMembershipRepository(
    new Map(members.map((m) => [m.id, m])),
  )
  const userRepo = new InMemoryUserRepository(new Map(users.map((u) => [u.id, u])))
  return makeResolveOperatorRecipients({ membershipRepo, userRepo })
}

describe('makeResolveOperatorRecipients', () => {
  it('returns active member emails in (createdAt, id) order — not membership insertion order', async () => {
    // Insert the later member FIRST so a pass-through of Map order would put it first;
    // the factory must defer to the repo's (createdAt, id) sort instead.
    const late = member('mem-late', 'u-late', new Date('2026-01-02T00:00:00Z'))
    const early = member('mem-early', 'u-early', new Date('2026-01-01T00:00:00Z'))
    const resolve = build(
      [late, early],
      [user('u-late', 'late@op.com'), user('u-early', 'early@op.com')],
    )

    expect(await resolve(OP)).toEqual(['early@op.com', 'late@op.com'])
  })

  it('drops a member whose user email is masked to null (placeholder owner not emailed)', async () => {
    const real = member('mem-real', 'u-real', new Date('2026-01-01T00:00:00Z'))
    const placeholder = member('mem-ph', 'u-ph', new Date('2026-01-02T00:00:00Z'))
    const resolve = build([real, placeholder], [user('u-real', 'real@op.com'), user('u-ph', null)])

    expect(await resolve(OP)).toEqual(['real@op.com'])
  })

  it('returns an empty list when the operator has no active members', async () => {
    const resolve = build([], [user('u-real', 'real@op.com')])

    expect(await resolve(OP)).toEqual([])
  })
})

// #1010: the batch resolver behind the compliance digest. Same per-operator
// semantics as the single resolver (order + null-mask), but resolves EVERY
// requested operator in a constant number of queries, not one round-trip each.
describe('makeResolveOperatorRecipientsBatch', () => {
  function memberOf(
    id: string,
    userId: string,
    operatorId: string,
    createdAt: Date,
  ): OperatorMembership {
    return {
      id,
      userId,
      operatorId,
      role: 'OPERATOR_STAFF',
      status: 'ACTIVE',
      createdAt,
      updatedAt: createdAt,
    }
  }
  function buildBatch(members: OperatorMembership[], users: User[]) {
    const membershipRepo = new InMemoryOperatorMembershipRepository(
      new Map(members.map((m) => [m.id, m])),
    )
    const userRepo = new InMemoryUserRepository(new Map(users.map((u) => [u.id, u])))
    return {
      resolve: makeResolveOperatorRecipientsBatch({ membershipRepo, userRepo }),
      membershipRepo,
      userRepo,
    }
  }

  const d = (iso: string) => new Date(iso)

  it('resolves each operator’s recipients in (createdAt, id) order, keyed by operatorId', async () => {
    // op-a's later member seeded first — the resolver must defer to repo order, not Map order.
    const { resolve } = buildBatch(
      [
        memberOf('a-late', 'u-a-late', 'op-a', d('2026-01-02T00:00:00Z')),
        memberOf('a-early', 'u-a-early', 'op-a', d('2026-01-01T00:00:00Z')),
        memberOf('b-solo', 'u-b', 'op-b', d('2026-01-01T00:00:00Z')),
      ],
      [user('u-a-late', 'late@a.com'), user('u-a-early', 'early@a.com'), user('u-b', 'solo@b.com')],
    )
    const byOp = await resolve(['op-a', 'op-b'])
    expect(byOp.get('op-a')).toEqual(['early@a.com', 'late@a.com'])
    expect(byOp.get('op-b')).toEqual(['solo@b.com'])
  })

  it('drops a member whose user email is masked to null', async () => {
    const { resolve } = buildBatch(
      [
        memberOf('a-real', 'u-real', 'op-a', d('2026-01-01T00:00:00Z')),
        memberOf('a-ph', 'u-ph', 'op-a', d('2026-01-02T00:00:00Z')),
      ],
      [user('u-real', 'real@a.com'), user('u-ph', null)],
    )
    expect((await resolve(['op-a'])).get('op-a')).toEqual(['real@a.com'])
  })

  it('returns [] for a requested operator with no active members', async () => {
    const { resolve } = buildBatch(
      [memberOf('a1', 'u-a', 'op-a', d('2026-01-01T00:00:00Z'))],
      [user('u-a', 'a@a.com')],
    )
    expect((await resolve(['op-a', 'op-empty'])).get('op-empty')).toEqual([])
  })

  it('issues a CONSTANT number of queries regardless of operator count (no per-operator N+1)', async () => {
    const real = buildBatch(
      [
        memberOf('a1', 'u-a', 'op-a', d('2026-01-01T00:00:00Z')),
        memberOf('b1', 'u-b', 'op-b', d('2026-01-01T00:00:00Z')),
        memberOf('c1', 'u-c', 'op-c', d('2026-01-01T00:00:00Z')),
      ],
      [user('u-a', 'a@a.com'), user('u-b', 'b@b.com'), user('u-c', 'c@c.com')],
    )
    let membershipCalls = 0
    let userCalls = 0
    const resolve = makeResolveOperatorRecipientsBatch({
      membershipRepo: {
        findActiveByOperators: (ids) => {
          membershipCalls++
          return real.membershipRepo.findActiveByOperators(ids)
        },
      },
      userRepo: {
        findByIds: (ids) => {
          userCalls++
          return real.userRepo.findByIds(ids)
        },
      },
    })
    await resolve(['op-a', 'op-b', 'op-c'])
    expect(membershipCalls).toBe(1)
    expect(userCalls).toBe(1)
  })
})
