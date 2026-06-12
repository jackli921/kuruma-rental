import { adminGuard, businessGuard, manageGuard, renterGuard } from '@/vite/guards'
import type { Session } from '@/vite/session'
import { describe, expect, it } from 'vitest'

const session = (role: string): Session => ({ user: { id: 'u', role }, csrfToken: 't' })

const operatorSession = (role: string, operatorSlug?: string): Session => ({
  user: { id: 'u', role, ...(operatorSlug ? { operatorSlug } : {}) },
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

describe('manageGuard', () => {
  it('allows an operator whose session slug matches the URL slug', () => {
    expect(manageGuard(operatorSession('OPERATOR_OWNER', 'acme'), 'acme')).toEqual({
      type: 'allow',
    })
  })

  it('forbids an operator viewing a different operator slug (fail-closed)', () => {
    expect(manageGuard(operatorSession('OPERATOR_OWNER', 'acme'), 'pilot')).toEqual({
      type: 'forbidden',
    })
  })

  it('forbids a business role without a slug (e.g. PLATFORM_ADMIN) — they use the admin portal', () => {
    expect(manageGuard(session('PLATFORM_ADMIN'), 'acme')).toEqual({ type: 'forbidden' })
  })

  it('forbids a signed-in renter (non-business role)', () => {
    expect(manageGuard(session('RENTER'), 'acme')).toEqual({ type: 'forbidden' })
  })

  it('redirects signed-out users to login', () => {
    expect(manageGuard(null, 'acme')).toEqual({ type: 'login' })
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
