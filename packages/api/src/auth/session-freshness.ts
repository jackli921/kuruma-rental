import { type UserRole, isOperatorRole } from './roles'

/**
 * Instant session revocation for deactivated operator members (#939).
 *
 * `verifyAndMap` (auth/jwt.ts) is pure crypto — it never re-checks the DB — so an
 * operator JWT keeps its `role`/`operatorId` claims for the full <=7d TTL even
 * after the owner deactivates the member. `deactivateMember` (services/operator-
 * team.ts) clears the authoritative `users` projection to RENTER/null, so the fix
 * is to re-read that projection at the auth boundary and reject any operator token
 * that no longer matches it. This module is the pure match rule; the boundary
 * supplies the projection and gates the DB read behind `isOperatorRole`.
 */

/** The token's authorization claims a deactivation must be able to revoke. */
export interface OperatorSessionClaims {
  readonly role: UserRole
  readonly operatorId?: string
}

/** The authoritative users-projection fields the JWT was minted from. Mirrors the
 *  `User` row shape (`operatorId` optional/nullable for renters + admins), plus the
 *  member's operator `deactivatedAt` — enriched by the boundary (#1088), not a users
 *  column — so an operator-level deactivation cascades to every member. */
export interface UserProjection {
  readonly role: UserRole
  readonly operatorId?: string | null
  readonly operatorDeactivatedAt?: Date | null
}

/**
 * True when an operator-role token no longer matches the live users projection —
 * the member was deactivated, moved tenant, or had their role changed — so the
 * token must be rejected (forcing a re-auth that mints fresh claims).
 *
 * Non-operator tokens are never stale here: renters/admins are not revoked through
 * this path, and the auth boundary skips the DB read for them entirely.
 */
export function isStaleOperatorSession(
  claims: OperatorSessionClaims,
  projection: UserProjection | undefined,
): boolean {
  if (!isOperatorRole(claims.role)) return false
  // SECURITY: this is the fail-OPEN branch. It is safe ONLY because no flow deletes a
  // users row today — clearOperatorAccess KEEPS the row (role→RENTER, operatorId→null),
  // so a deactivated member is always caught by the mismatch branches below. A missing
  // row is therefore only a hard-deleted user (out of #939 scope) or a fabricated
  // service token that carries no users row; revoking those is left to token expiry
  // rather than failing closed here. If a hard-delete flow is ever added, revisit this
  // branch — it must fail CLOSED for deleted operators.
  if (!projection) return false
  if (projection.role !== claims.role) return true
  // #1088 operator-level cascade: the member projection can still match (role +
  // operatorId unchanged) yet the whole operator was soft-deactivated. Revoke the
  // token so every member of a deactivated operator must re-auth on next request.
  if (projection.operatorDeactivatedAt != null) return true
  return (projection.operatorId ?? undefined) !== claims.operatorId
}
