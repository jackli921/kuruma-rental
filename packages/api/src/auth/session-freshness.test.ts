import { describe, expect, it } from 'vitest'

import { isStaleOperatorSession } from './session-freshness'

// #939: a deactivated operator member keeps a valid JWT until it expires (<=7d),
// because verifyAndMap is pure crypto with no DB read. The fix re-reads the
// authoritative users projection (which deactivateMember clears to RENTER/null)
// and rejects the token when it no longer matches. These tests pin the pure
// match rule the auth boundary consults.
describe('isStaleOperatorSession', () => {
  const staffToken = { role: 'OPERATOR_STAFF', operatorId: 'op_best' } as const

  it('is fresh when the projection still matches the token role + operator', () => {
    expect(
      isStaleOperatorSession(staffToken, { role: 'OPERATOR_STAFF', operatorId: 'op_best' }),
    ).toBe(false)
  })

  it('is stale when the projection was cleared to a plain renter (deactivated)', () => {
    // deactivateMember -> users.clearOperatorAccess: role RENTER, operatorId null.
    expect(isStaleOperatorSession(staffToken, { role: 'RENTER', operatorId: null })).toBe(true)
  })

  it('is stale when the operatorId still set but no longer the token tenant', () => {
    expect(
      isStaleOperatorSession(staffToken, { role: 'OPERATOR_STAFF', operatorId: 'op_other' }),
    ).toBe(true)
  })

  it('is stale when the role changed within the same tenant (owner <-> staff)', () => {
    // A role change must force re-auth so the new token carries the new role.
    expect(
      isStaleOperatorSession(staffToken, { role: 'OPERATOR_OWNER', operatorId: 'op_best' }),
    ).toBe(true)
  })

  it('is stale when the operator ITSELF was deactivated, even though role + operatorId still match (#1088)', () => {
    // Operator-level cascade (distinct from #939 per-member deactivation): the member's
    // users row is UNCHANGED (still OPERATOR_STAFF + op_best), but the whole operator was
    // soft-deactivated. The boundary enriches the projection with the operator's
    // deactivatedAt so every member is revoked on their next request.
    expect(
      isStaleOperatorSession(staffToken, {
        role: 'OPERATOR_STAFF',
        operatorId: 'op_best',
        operatorDeactivatedAt: new Date('2026-06-26T00:00:00.000Z'),
      }),
    ).toBe(true)
  })

  it('is fresh when the operator is active (operatorDeactivatedAt null) and the projection matches (#1088)', () => {
    expect(
      isStaleOperatorSession(staffToken, {
        role: 'OPERATOR_STAFF',
        operatorId: 'op_best',
        operatorDeactivatedAt: null,
      }),
    ).toBe(false)
  })

  it('does not flag a missing projection row (deactivation keeps the row; hard-delete is out of scope)', () => {
    // clearOperatorAccess never deletes — a deactivated member still has a row
    // (caught by the mismatch cases above). A truly absent row is a hard-deleted
    // user, left to token expiry rather than failing closed here.
    expect(isStaleOperatorSession(staffToken, undefined)).toBe(false)
  })

  it('never flags a non-operator token, even against a missing projection', () => {
    // Renters/admins are not revoked through this path; the boundary must not
    // consult the DB for them, and the predicate must agree it is never stale.
    expect(isStaleOperatorSession({ role: 'RENTER' }, undefined)).toBe(false)
    expect(isStaleOperatorSession({ role: 'PLATFORM_ADMIN' }, undefined)).toBe(false)
  })
})
