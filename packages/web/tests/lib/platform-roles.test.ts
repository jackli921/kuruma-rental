import { PLATFORM_ADMIN_ROLES, isPlatformAdmin } from '@/lib/platform-roles'
import { describe, expect, test } from 'vitest'

describe('isPlatformAdmin', () => {
  test('admits PLATFORM_ADMIN', () => {
    expect(isPlatformAdmin('PLATFORM_ADMIN')).toBe(true)
  })

  test('admits legacy STAFF/ADMIN (transitional super-admins, schema.ts:23)', () => {
    expect(isPlatformAdmin('STAFF')).toBe(true)
    expect(isPlatformAdmin('ADMIN')).toBe(true)
  })

  test('rejects operator and renter roles', () => {
    expect(isPlatformAdmin('OPERATOR_OWNER')).toBe(false)
    expect(isPlatformAdmin('OPERATOR_STAFF')).toBe(false)
    expect(isPlatformAdmin('RENTER')).toBe(false)
  })

  test('rejects undefined and empty role', () => {
    expect(isPlatformAdmin(undefined)).toBe(false)
    expect(isPlatformAdmin('')).toBe(false)
  })

  // The whole reason this module exists separately from business-roles.ts:
  // the admin gate is NARROWER — it must NOT admit OPERATOR_* the way
  // BUSINESS_ROLES does (#462 §2.3).
  test('PLATFORM_ADMIN_ROLES excludes operator roles (narrower than BUSINESS_ROLES)', () => {
    expect(PLATFORM_ADMIN_ROLES.has('OPERATOR_OWNER')).toBe(false)
    expect(PLATFORM_ADMIN_ROLES.has('OPERATOR_STAFF')).toBe(false)
    expect(PLATFORM_ADMIN_ROLES.has('PLATFORM_ADMIN')).toBe(true)
  })
})
