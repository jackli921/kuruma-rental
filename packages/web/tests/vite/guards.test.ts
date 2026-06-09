import { businessGuard, renterGuard } from '@/vite/guards'
import type { Session } from '@/vite/session'
import { describe, expect, it } from 'vitest'

const session = (role: string): Session => ({ user: { id: 'u', role }, csrfToken: 't' })

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
