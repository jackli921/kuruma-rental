import { describe, expect, it } from 'vitest'

import { operatorRoleToUserRole } from '../../src/auth/operator-role'

// #521 §4: the membership/invite `operator_role` is projected onto `users.role`
// at grant time. The mapping is identity today, but it MUST go through a typed
// table so a future rename of either enum is a compile error, not a silent bad
// row. These tests pin the runtime values; the compile-time guard is the
// `satisfies Record<OperatorRole, UserRole>` in the implementation.
describe('operatorRoleToUserRole', () => {
  it('projects OPERATOR_OWNER onto the matching user role', () => {
    expect(operatorRoleToUserRole('OPERATOR_OWNER')).toBe('OPERATOR_OWNER')
  })

  it('projects OPERATOR_STAFF onto the matching user role', () => {
    expect(operatorRoleToUserRole('OPERATOR_STAFF')).toBe('OPERATOR_STAFF')
  })
})
