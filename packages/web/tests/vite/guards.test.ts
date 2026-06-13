import { adminGuard, businessGuard, isOperatorSession, renterGuard } from '@/vite/guards'
import type { Session } from '@/vite/session'
import { describe, expect, it } from 'vitest'

const session = (role: string): Session => ({ user: { id: 'u', role }, csrfToken: 't' })

const tenantSession = (role: string): Session => ({
  user: { id: 'u', role, operatorId: 'op_1' },
  csrfToken: 't',
})

describe('renterGuard', () => {
  it('allows any signed-in user', () => {
    expect(renterGuard(session('RENTER'))).toEqual({ type: 'allow' })
  })
  it('redirects signed-out users to login', () => {
    expect(renterGuard(null)).toEqual({ type: 'login' })
  })
})

describe('businessGuard', () => {
  it('allows business roles', () => {
    expect(businessGuard(session('STAFF'))).toEqual({ type: 'allow' })
    expect(businessGuard(session('OPERATOR_OWNER'))).toEqual({ type: 'allow' })
    expect(businessGuard(session('PLATFORM_ADMIN'))).toEqual({ type: 'allow' })
  })
  it('forbids a signed-in non-business role (renter) -> landing', () => {
    expect(businessGuard(session('RENTER'))).toEqual({ type: 'forbidden' })
  })
  it('redirects signed-out users to login', () => {
    expect(businessGuard(null)).toEqual({ type: 'login' })
  })
})

describe('isOperatorSession', () => {
  it('is true for a tenant-scoped operator session (carries an operatorId)', () => {
    expect(isOperatorSession(tenantSession('OPERATOR_OWNER'))).toBe(true)
    expect(isOperatorSession(tenantSession('OPERATOR_STAFF'))).toBe(true)
  })

  it('is false for bypass business roles with no operatorId — they can read but cannot write', () => {
    expect(isOperatorSession(session('PLATFORM_ADMIN'))).toBe(false)
    expect(isOperatorSession(session('STAFF'))).toBe(false)
    expect(isOperatorSession(session('ADMIN'))).toBe(false)
  })

  it('is false for a signed-out session', () => {
    expect(isOperatorSession(null)).toBe(false)
  })
})

describe('adminGuard', () => {
  it('allows platform-admin roles (incl. legacy STAFF/ADMIN)', () => {
    expect(adminGuard(session('PLATFORM_ADMIN'))).toEqual({ type: 'allow' })
    expect(adminGuard(session('STAFF'))).toEqual({ type: 'allow' })
    expect(adminGuard(session('ADMIN'))).toEqual({ type: 'allow' })
  })
  it('forbids tenant-scoped operators — admin is narrower than business', () => {
    expect(adminGuard(session('OPERATOR_OWNER'))).toEqual({ type: 'forbidden' })
    expect(adminGuard(session('OPERATOR_STAFF'))).toEqual({ type: 'forbidden' })
  })
  it('forbids a signed-in renter -> landing', () => {
    expect(adminGuard(session('RENTER'))).toEqual({ type: 'forbidden' })
  })
  it('redirects signed-out users to login', () => {
    expect(adminGuard(null)).toEqual({ type: 'login' })
  })
})
