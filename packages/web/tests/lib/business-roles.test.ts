import { BUSINESS_ROLES, isBusinessRole } from '@/lib/business-roles'
import { describe, expect, it } from 'vitest'

describe('isBusinessRole', () => {
  it('admits tenant operators, legacy staff, and the platform admin', () => {
    for (const role of ['OPERATOR_OWNER', 'OPERATOR_STAFF', 'STAFF', 'ADMIN', 'PLATFORM_ADMIN']) {
      expect(isBusinessRole(role)).toBe(true)
    }
  })

  it('excludes renters, partners, and unknown/undefined roles', () => {
    for (const role of ['RENTER', 'PARTNER', 'nonsense', undefined]) {
      expect(isBusinessRole(role)).toBe(false)
    }
  })

  // Must mirror the API's FLEET_WRITE_ROLES (STAFF_ROLES + OPERATOR_ROLES) so a
  // user the API lets manage fleet is the same user the web portal lets in.
  it('membership matches the API FLEET_WRITE_ROLES set exactly', () => {
    expect([...BUSINESS_ROLES].sort()).toEqual([
      'ADMIN',
      'OPERATOR_OWNER',
      'OPERATOR_STAFF',
      'PLATFORM_ADMIN',
      'STAFF',
    ])
  })
})
