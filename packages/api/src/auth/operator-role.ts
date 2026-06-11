import type { OperatorRole } from '@kuruma/shared/validators/provider-invite'

import type { UserRole } from '../middleware/auth'

// #521 §4 — project an operator membership/invite `operator_role` onto the
// `users.role` enum that the JWT reads (Decision 1: the membership row is the
// source of truth, `users.role`/`operatorId` are its single-active projection).
//
// The mapping is identity today, but it MUST go through this table: `satisfies
// Record<OperatorRole, UserRole>` makes a future rename or removal of either
// enum member a COMPILE error here, instead of silently writing a bad row to
// `users`. The projection write at grant time goes through this function.
const OPERATOR_ROLE_TO_USER_ROLE = {
  OPERATOR_OWNER: 'OPERATOR_OWNER',
  OPERATOR_STAFF: 'OPERATOR_STAFF',
} satisfies Record<OperatorRole, UserRole>

export function operatorRoleToUserRole(role: OperatorRole): UserRole {
  return OPERATOR_ROLE_TO_USER_ROLE[role]
}
