/**
 * Roles allowed into the business portal (`/manage/*`). Single source of truth
 * imported by the edge middleware, the `(business)` layout, and `view-mode`.
 *
 * Mirrors the API's `FLEET_WRITE_ROLES` (STAFF_ROLES + OPERATOR_ROLES): legacy
 * STAFF/ADMIN, the PLATFORM_ADMIN super-admin, and the tenant-scoped
 * OPERATOR_OWNER/OPERATOR_STAFF (epic #385). A user the API lets manage fleet
 * must be the same user the web portal lets in — otherwise operator staff get
 * redirected away from a page the API would happily serve (#387).
 *
 * Keep this module dependency-free (no `next/headers`, no DB) so the Edge
 * middleware can import it.
 */
export const BUSINESS_ROLES: ReadonlySet<string> = new Set([
  'STAFF',
  'ADMIN',
  'PLATFORM_ADMIN',
  'OPERATOR_OWNER',
  'OPERATOR_STAFF',
])

export function isBusinessRole(role: string | undefined): boolean {
  return BUSINESS_ROLES.has(role ?? '')
}
