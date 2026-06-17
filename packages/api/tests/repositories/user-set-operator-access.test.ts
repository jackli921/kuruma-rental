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

function operator(): User {
  return { ...renter(), role: 'OPERATOR_STAFF', operatorId: 'op_1' }
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

// #904 slice 2: deactivating a member must also tear down the projection — a
// normal (renter-door) sign-in mints the JWT role straight from users.role/
// operatorId (auth callback), so a stale OPERATOR_* projection would re-grant
// access on next login. clearOperatorAccess is the inverse of setOperatorAccess.
describe('InMemoryUserRepository.clearOperatorAccess', () => {
  it('tears the operator projection back down to a renter (operator -> renter, no operatorId)', async () => {
    const store = new Map<string, User>([['u1', operator()]])
    const repo = new InMemoryUserRepository(store)

    await repo.clearOperatorAccess('u1')

    const [updated] = await repo.findByIds(['u1'])
    expect(updated?.role).toBe('RENTER')
    expect(updated?.operatorId).toBeNull()
  })

  it('is a silent no-op for an unknown user (mirrors setOperatorAccess)', async () => {
    const repo = new InMemoryUserRepository()
    await expect(repo.clearOperatorAccess('ghost')).resolves.toBeUndefined()
  })
})
