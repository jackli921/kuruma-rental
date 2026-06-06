import { describe, expect, it } from 'vitest'
import { InMemoryUserRepository } from '../../src/repositories/in-memory/user'
import type { User } from '../../src/stores'

// §4d / P1a: findOperatorContacts resolves the OPERATOR_OWNER recipient for the
// booking alert. Owner-only (no OPERATOR_STAFF in MVP) and operator-scoped — it
// must never leak another operator's contacts.

const OP1 = 'op-1'
const OP2 = 'op-2'

function user(over: Partial<User> & Pick<User, 'id'>): User {
  return {
    name: 'X',
    email: `${over.id}@example.com`,
    phone: null,
    language: 'ja',
    country: null,
    role: 'RENTER',
    operatorId: null,
    ...over,
  }
}

function repoWith(...users: User[]): InMemoryUserRepository {
  return new InMemoryUserRepository(new Map(users.map((u) => [u.id, u])))
}

describe('InMemoryUserRepository.findOperatorContacts', () => {
  it("returns only the operator's OPERATOR_OWNER users", async () => {
    const repo = repoWith(
      user({ id: 'owner-1', role: 'OPERATOR_OWNER', operatorId: OP1 }),
      user({ id: 'owner-2', role: 'OPERATOR_OWNER', operatorId: OP1 }),
      user({ id: 'staff-1', role: 'OPERATOR_STAFF', operatorId: OP1 }),
      user({ id: 'renter-1', role: 'RENTER', operatorId: null }),
    )
    const contacts = await repo.findOperatorContacts(OP1)
    expect(contacts.map((u) => u.id).sort()).toEqual(['owner-1', 'owner-2'])
  })

  it("never leaks another operator's owners (tenant scope)", async () => {
    const repo = repoWith(
      user({ id: 'owner-1', role: 'OPERATOR_OWNER', operatorId: OP1 }),
      user({ id: 'owner-2', role: 'OPERATOR_OWNER', operatorId: OP2 }),
    )
    const contacts = await repo.findOperatorContacts(OP2)
    expect(contacts).toHaveLength(1)
    expect(contacts[0]!.id).toBe('owner-2')
  })

  it('returns an empty array when the operator has no owner user', async () => {
    const repo = repoWith(user({ id: 'staff-1', role: 'OPERATOR_STAFF', operatorId: OP1 }))
    expect(await repo.findOperatorContacts(OP1)).toEqual([])
  })
})
