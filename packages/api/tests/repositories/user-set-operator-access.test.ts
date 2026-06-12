import { describe, expect, it } from 'vitest'

import { InMemoryUserRepository } from '../../src/repositories/in-memory'
import type { User } from '../../src/stores'

// #521 Decision 1: operator_memberships is the source of truth; users.role +
// users.operatorId are its single-active projection that the JWT reads. The grant
// transaction writes that projection through setOperatorAccess.
function renter(): User {
  return {
    id: 'u1',
    name: 'Aiko',
    email: 'aiko@example.com',
    phone: null,
    language: 'en',
    country: null,
    role: 'RENTER',
  }
}

describe('InMemoryUserRepository.setOperatorAccess', () => {
  it('projects the operator role + operatorId onto the user (renter -> operator)', async () => {
    const store = new Map<string, User>([['u1', renter()]])
    const repo = new InMemoryUserRepository(store)

    await repo.setOperatorAccess('u1', { role: 'OPERATOR_OWNER', operatorId: 'op_1' })

    const [updated] = await repo.findByIds(['u1'])
    expect(updated?.role).toBe('OPERATOR_OWNER')
    expect(updated?.operatorId).toBe('op_1')
  })
})
