import { describe, expect, it } from 'vitest'
import { adminGuard } from './guards'
import type { Session } from './session'

function session(role: string, over: Partial<Session['user']> = {}): Session {
  return { user: { id: 'usr_1', role, ...over }, csrfToken: 'csrf_1' }
}

describe('adminGuard', () => {
  it('sends a signed-out caller to login', () => {
    expect(adminGuard(null)).toEqual({ type: 'login' })
  })

  it('admits a PLATFORM_ADMIN', () => {
    expect(adminGuard(session('PLATFORM_ADMIN'))).toEqual({ type: 'allow' })
  })

  it('forbids a tenant-scoped operator owner from the cross-tenant admin portal', () => {
    // An OPERATOR_OWNER clears the business gate but must NOT reach /admin (#462 §2.3):
    // the customers list is cross-operator PLATFORM_ADMIN-only data.
    expect(adminGuard(session('OPERATOR_OWNER', { operatorId: 'op_1' }))).toEqual({
      type: 'forbidden',
    })
  })

  it('forbids operator staff', () => {
    expect(adminGuard(session('OPERATOR_STAFF', { operatorId: 'op_1' }))).toEqual({
      type: 'forbidden',
    })
  })
})
