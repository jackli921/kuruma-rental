import { describe, expect, it } from 'vitest'
import {
  ALL_ROLES,
  BUSINESS_ROLES,
  MANAGEMENT_BASE_ROLES,
  OPERATOR_OWNER_WRITE_ROLES,
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

  it('OPERATOR_OWNER_WRITE_ROLES = BUSINESS_ROLES minus OPERATOR_STAFF (owner-tier money-flow writes — #903)', () => {
    expect(members(OPERATOR_OWNER_WRITE_ROLES)).toEqual([
      'ADMIN',
      'OPERATOR_OWNER',
      'PLATFORM_ADMIN',
      'STAFF',
    ])
    // OPERATOR_STAFF is the one business role excluded — it must not redirect the
    // renter-facing pre-auth payment handoff.
    expect(OPERATOR_OWNER_WRITE_ROLES.has('OPERATOR_STAFF')).toBe(false)
    expect(BUSINESS_ROLES.has('OPERATOR_STAFF')).toBe(true)
  })

  it('SCOPE_BYPASS_ROLES = PARTNER + PLATFORM_ADMIN — PARTNER keeps the bypass flag (its bookings are scoped per-consumer, #1119)', () => {
    expect(members(SCOPE_BYPASS_ROLES)).toEqual(['PARTNER', 'PLATFORM_ADMIN'])
  })

  it('PRIVILEGED_ROLES = PLATFORM_ADMIN only — PARTNER dropped (#1168), the divergence #487 anticipated', () => {
    // #1168: PARTNER (Trip.com) is a booking channel with no cross-tenant
    // private-data use case. It was conflated with the platform admin tier in
    // PRIVILEGED_ROLES, which gated full reads of messages, threads, and the user
    // directory — a reachable cross-tenant leak (those routes gate on requireUser
    // only). PARTNER's one cross-tenant read, its own bookings, is scoped in
    // bookingReadScope (#1119) via the still-PARTNER SCOPE_BYPASS_ROLES, NOT here.
    expect(members(PRIVILEGED_ROLES)).toEqual(['PLATFORM_ADMIN'])
    expect(PRIVILEGED_ROLES.has('PARTNER')).toBe(false)
    expect(SCOPE_BYPASS_ROLES.has('PARTNER')).toBe(true)
    // Still distinct instances — now with genuinely different membership.
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
