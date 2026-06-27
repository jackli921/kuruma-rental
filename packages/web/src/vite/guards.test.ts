import type { UserRole } from '@kuruma/shared/auth/roles'
import { describe, expect, it } from 'vitest'
import {
  adminGuard,
  canPickOperatorContext,
  canWriteAsOperator,
  canWriteAsOperatorOwner,
  isCrossOperatorReader,
} from './guards'
import type { Session } from './session'

function session(role: UserRole, over: Partial<Session['user']> = {}): Session {
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

describe('canPickOperatorContext', () => {
  it('is true only for PLATFORM_ADMIN', () => {
    expect(canPickOperatorContext(session('PLATFORM_ADMIN'))).toBe(true)
  })
  it('is false for legacy STAFF/ADMIN (tenant-blind on bookings — no picker)', () => {
    expect(canPickOperatorContext(session('STAFF'))).toBe(false)
    expect(canPickOperatorContext(session('ADMIN'))).toBe(false)
  })
  it('is false for an operator session and for null', () => {
    expect(canPickOperatorContext(session('OPERATOR_OWNER', { operatorId: 'op_1' }))).toBe(false)
    expect(canPickOperatorContext(null)).toBe(false)
  })
})

describe('isCrossOperatorReader', () => {
  it('is true for any business role without an operatorId (mirrors API operatorReadScope==="all")', () => {
    expect(isCrossOperatorReader(session('PLATFORM_ADMIN'))).toBe(true)
    expect(isCrossOperatorReader(session('STAFF'))).toBe(true)
  })
  it('is false for an operator session (auto-scoped) and for null', () => {
    expect(isCrossOperatorReader(session('OPERATOR_OWNER', { operatorId: 'op_1' }))).toBe(false)
    expect(isCrossOperatorReader(null)).toBe(false)
  })
})

describe('canWriteAsOperator', () => {
  it('admits a real operator session regardless of pick', () => {
    expect(canWriteAsOperator(session('OPERATOR_OWNER', { operatorId: 'op_1' }), undefined)).toBe(
      true,
    )
  })
  it('admits a PLATFORM_ADMIN only when an operator is picked', () => {
    expect(canWriteAsOperator(session('PLATFORM_ADMIN'), 'op_9')).toBe(true)
    expect(canWriteAsOperator(session('PLATFORM_ADMIN'), undefined)).toBe(false)
  })
  it('denies a legacy admin even with a pick (they get no picker)', () => {
    expect(canWriteAsOperator(session('STAFF'), 'op_9')).toBe(false)
  })
})

describe('canWriteAsOperatorOwner', () => {
  it('admits OPERATOR_OWNER, and a PLATFORM_ADMIN with a pick, but not OPERATOR_STAFF', () => {
    expect(
      canWriteAsOperatorOwner(session('OPERATOR_OWNER', { operatorId: 'op_1' }), undefined),
    ).toBe(true)
    expect(canWriteAsOperatorOwner(session('PLATFORM_ADMIN'), 'op_9')).toBe(true)
    expect(
      canWriteAsOperatorOwner(session('OPERATOR_STAFF', { operatorId: 'op_1' }), undefined),
    ).toBe(false)
  })
})
