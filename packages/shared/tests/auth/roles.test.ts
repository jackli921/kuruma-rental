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

  it('PLATFORM_ROLES = PLATFORM_ADMIN only — legacy STAFF/ADMIN revoked (#487)', () => {
    expect(members(PLATFORM_ROLES)).toEqual(['PLATFORM_ADMIN'])
  })

  it('MANAGEMENT_BASE_ROLES keeps STAFF/ADMIN — NOT narrowed by #487 (now diverges from PLATFORM_ROLES)', () => {
    expect(members(MANAGEMENT_BASE_ROLES)).toEqual(['ADMIN', 'PLATFORM_ADMIN', 'STAFF'])
    // The whole point of the split, now realized: #487 tightened PLATFORM_ROLES
    // without dragging the business-management base with it.
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

  it('SCOPE_BYPASS_ROLES and PRIVILEGED_ROLES = PARTNER + PLATFORM_ADMIN — legacy STAFF/ADMIN revoked (#487), distinct instances', () => {
    const expected = ['PARTNER', 'PLATFORM_ADMIN']
    expect(members(SCOPE_BYPASS_ROLES)).toEqual(expected)
    expect(members(PRIVILEGED_ROLES)).toEqual(expected)
    // #487 dropped legacy STAFF/ADMIN from cross-tenant bypass + privileged reads;
    // PARTNER (Trip.com) stays. Same members today, but kept as distinct instances
    // because they gate different things (bypass flag vs direct cross-tenant reads)
    // and may still diverge later (e.g. PARTNER dropped for message threads).
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
