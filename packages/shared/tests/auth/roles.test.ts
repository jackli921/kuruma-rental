import { describe, expect, it } from 'vitest'
import {
  ALL_ROLES,
  BUSINESS_ROLES,
  MANAGEMENT_BASE_ROLES,
  OPERATOR_ROLES,
  PLATFORM_ROLES,
  PRIVILEGED_ROLES,
  SCOPE_BYPASS_ROLES,
} from '../../src/auth/roles'

const members = (s: ReadonlySet<string>): string[] => [...s].sort()

// Characterization of the canonical authorization role sets (#487 prep). These
// lock the exact membership so a future #487 edit is an intentional, visible diff —
// and so the api/web single-source rewire stays behavior-preserving.
describe('canonical role sets (#487 prep — single source of truth)', () => {
  it('OPERATOR_ROLES = the two tenant-scoped roles', () => {
    expect(members(OPERATOR_ROLES)).toEqual(['OPERATOR_OWNER', 'OPERATOR_STAFF'])
  })

  it('PLATFORM_ROLES = STAFF/ADMIN/PLATFORM_ADMIN (the #487 tightening target)', () => {
    expect(members(PLATFORM_ROLES)).toEqual(['ADMIN', 'PLATFORM_ADMIN', 'STAFF'])
  })

  it('MANAGEMENT_BASE_ROLES mirrors PLATFORM_ROLES today but is a SEPARATE instance', () => {
    expect(members(MANAGEMENT_BASE_ROLES)).toEqual(['ADMIN', 'PLATFORM_ADMIN', 'STAFF'])
    // The whole point of the split: #487 can tighten PLATFORM_ROLES without
    // dragging the business-management base with it.
    expect(MANAGEMENT_BASE_ROLES).not.toBe(PLATFORM_ROLES)
  })

  it('BUSINESS_ROLES = management base ∪ tenant operators', () => {
    expect(members(BUSINESS_ROLES)).toEqual([
      'ADMIN',
      'OPERATOR_OWNER',
      'OPERATOR_STAFF',
      'PLATFORM_ADMIN',
      'STAFF',
    ])
  })

  it('SCOPE_BYPASS_ROLES and PRIVILEGED_ROLES = platform tier PLUS PARTNER, as distinct instances', () => {
    const expected = ['ADMIN', 'PARTNER', 'PLATFORM_ADMIN', 'STAFF']
    expect(members(SCOPE_BYPASS_ROLES)).toEqual(expected)
    expect(members(PRIVILEGED_ROLES)).toEqual(expected)
    // Same members today, but they gate different things (bypass flag vs direct
    // cross-tenant reads) and may diverge under #487 (e.g. PARTNER kept for
    // bookings but dropped for message threads).
    expect(SCOPE_BYPASS_ROLES).not.toBe(PRIVILEGED_ROLES)
  })

  it('ALL_ROLES = the full seven-role authz model (includes API-only PARTNER)', () => {
    expect(members(ALL_ROLES)).toEqual([
      'ADMIN',
      'OPERATOR_OWNER',
      'OPERATOR_STAFF',
      'PARTNER',
      'PLATFORM_ADMIN',
      'RENTER',
      'STAFF',
    ])
  })
})
