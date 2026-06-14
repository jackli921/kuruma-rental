import {
  ALL_ROLES,
  BUSINESS_ROLES,
  OPERATOR_ROLES,
  PLATFORM_ROLES,
  type UserRole,
} from '@kuruma/shared/auth/roles'

// Role identifiers + membership sets are single-sourced in @kuruma/shared/auth/
// roles (edge-safe, zero-import) so the API and the web edge middleware can't
// drift (#387). Re-exported here so the existing API import surface is unchanged.
// PARTNER is API-key-only (3rd-party callers), not a DB role; OPERATOR_* and
// PLATFORM_ADMIN are the marketplace roles (epic #385) and exist in the DB enum.
export type { UserRole }
export { PRIVILEGED_ROLES } from '@kuruma/shared/auth/roles'

export interface AuthUser {
  id: string
  role: UserRole
  // Tenant the caller belongs to. Present for OPERATOR_* roles; absent for
  // renters, platform admins, and legacy privileged roles.
  operatorId?: string
}

/** True for tenant-scoped roles (OPERATOR_OWNER / OPERATOR_STAFF). */
export function isOperatorRole(role: UserRole): boolean {
  return OPERATOR_ROLES.has(role)
}

export function isValidRole(value: string): value is UserRole {
  return ALL_ROLES.has(value)
}

export function isAuthUser(v: unknown): v is AuthUser {
  return (
    typeof v === 'object' &&
    v !== null &&
    'id' in v &&
    typeof (v as AuthUser).id === 'string' &&
    'role' in v &&
    isValidRole((v as AuthUser).role)
  )
}

/**
 * Consumer-facing aliases of the single-sourced sets in @kuruma/shared/auth/roles.
 * The names are kept so the ~25 existing route/repo gates import unchanged, but
 * the platform tier (STAFF_ROLES → PLATFORM_ROLES) is now a SEPARATE set from the
 * business tier (FLEET_WRITE/MANAGEMENT_READ → BUSINESS_ROLES). That split lets
 * #487 tighten platform-admin access (PLATFORM_ROLES → {PLATFORM_ADMIN}) without
 * touching business management — which it now has.
 *
 * STAFF_ROLES: platform-staff tier (no operators) — PLATFORM_ADMIN only (legacy
 * STAFF / ADMIN revoked by #487).
 * FLEET_WRITE_ROLES / MANAGEMENT_READ_ROLES: the platform base PLUS tenant
 * operators; each admitted operator is still bounded to its own tenant by the
 * repository's operator predicate (#386 F2 / #397), and RENTER / PARTNER are
 * excluded so operator-private config (insurance/fees) never leaks (slice-4 [P0]).
 * These INTENTIONALLY alias BUSINESS_ROLES, not PLATFORM_ROLES: #487 narrows the
 * platform tier only, so do NOT "harmonize" these onto PLATFORM_ROLES — that
 * would silently strip tenant operators from fleet management.
 */
export const STAFF_ROLES = PLATFORM_ROLES
export const FLEET_WRITE_ROLES = BUSINESS_ROLES
export const MANAGEMENT_READ_ROLES = BUSINESS_ROLES
