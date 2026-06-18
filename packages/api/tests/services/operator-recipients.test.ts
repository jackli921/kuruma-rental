import { describe, expect, it } from 'vitest'
import { InMemoryOperatorMembershipRepository } from '../../src/repositories/in-memory/operator-membership'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import { makeResolveOperatorRecipients } from '../../src/services/operator-recipients'
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
