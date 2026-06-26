import { BUSINESS_ROLES as SHARED_BUSINESS_ROLES, type UserRole } from '@kuruma/shared/auth/roles'

/**
 * Roles allowed into the business portal (`/manage/*`). Re-exported from the
 * single source of truth @kuruma/shared/auth/roles (BUSINESS_ROLES) so the web
 * edge middleware and the API can't drift (#387) — a user the API lets manage
 * fleet must be the same user the web portal lets in, otherwise operator staff
 * get redirected away from a page the API would happily serve. The shared module
 * is pure data with zero imports, so this module stays Edge-safe (no
 * `next/headers`, no DB).
 *
 * Members: legacy STAFF/ADMIN, the PLATFORM_ADMIN super-admin, and the
 * tenant-scoped OPERATOR_OWNER/OPERATOR_STAFF (epic #385). Mirrors the API's
 * FLEET_WRITE_ROLES (which now also aliases the shared BUSINESS_ROLES).
 */
export const BUSINESS_ROLES = SHARED_BUSINESS_ROLES

export function isBusinessRole(role: UserRole | undefined): boolean {
  return BUSINESS_ROLES.has(role ?? '')
}
