import { BUSINESS_ROLES, PLATFORM_ROLES } from '@kuruma/shared/auth/roles'
import { describe, expect, it } from 'vitest'
import { FLEET_WRITE_ROLES, MANAGEMENT_READ_ROLES, STAFF_ROLES } from '../../src/middleware/auth'

/**
 * Tripwire for the #487 prep refactor (single-sourced authz role sets). The API's
 * consumer-facing names are aliases of the canonical @kuruma/shared/auth/roles
 * sets. #487 narrows the PLATFORM tier only (PLATFORM_ROLES -> {PLATFORM_ADMIN}),
 * so the BUSINESS-tier aliases must keep tenant operators and must NOT be
 * "harmonized" onto PLATFORM_ROLES — that would silently strip OPERATOR_* from
 * fleet management. These assertions turn the auth.ts guard comment into a machine
 * check, and pin the single-source wiring so a future edit can't reintroduce a
 * private copy (the #387 drift this PR removed).
 */
describe('auth role-set aliases (single-source wiring)', () => {
  it('STAFF_ROLES is the platform tier — same instance as shared PLATFORM_ROLES, PLATFORM_ADMIN only', () => {
    expect(STAFF_ROLES).toBe(PLATFORM_ROLES)
    expect(STAFF_ROLES.has('PLATFORM_ADMIN')).toBe(true)
    // #487: the legacy STAFF/ADMIN aliases no longer grant the platform tier.
    expect(STAFF_ROLES.has('STAFF')).toBe(false)
    expect(STAFF_ROLES.has('ADMIN')).toBe(false)
    expect(STAFF_ROLES.has('OPERATOR_OWNER')).toBe(false)
    expect(STAFF_ROLES.has('OPERATOR_STAFF')).toBe(false)
  })

  it('FLEET_WRITE_ROLES / MANAGEMENT_READ_ROLES are the business tier — platform base PLUS operators', () => {
    expect(FLEET_WRITE_ROLES).toBe(BUSINESS_ROLES)
    expect(MANAGEMENT_READ_ROLES).toBe(BUSINESS_ROLES)
    for (const role of ['STAFF', 'ADMIN', 'PLATFORM_ADMIN', 'OPERATOR_OWNER', 'OPERATOR_STAFF']) {
      expect(MANAGEMENT_READ_ROLES.has(role)).toBe(true)
    }
  })

  it('business tier stays strictly WIDER than platform tier (the #487 harmonize footgun guard)', () => {
    expect(MANAGEMENT_READ_ROLES).not.toBe(PLATFORM_ROLES)
    expect(PLATFORM_ROLES.has('OPERATOR_OWNER')).toBe(false)
    expect(MANAGEMENT_READ_ROLES.has('OPERATOR_OWNER')).toBe(true)
  })
})
