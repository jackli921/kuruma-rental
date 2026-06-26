import { PLATFORM_ROLES, type UserRole } from '@kuruma/shared/auth/roles'

/**
 * Roles allowed into the platform admin portal (`/admin/*`). Re-exported from the
 * single source of truth @kuruma/shared/auth/roles (PLATFORM_ROLES) so the web
 * edge middleware and the API can't drift (#387). That module is pure data with
 * zero imports, so this module stays Edge-safe (no `next/headers`, no DB) —
 * verified: bundling @kuruma/shared/auth/roles pulls in no drizzle/postgres/jose.
 *
 * Deliberately NARROWER than business-roles.ts `BUSINESS_ROLES`: #487 tightened
 * it to the `PLATFORM_ADMIN` super-admin only — the legacy transitional
 * `STAFF`/`ADMIN` were revoked from platform access — and it never admitted the
 * tenant-scoped `OPERATOR_OWNER`/`OPERATOR_STAFF`. The admin portal is
 * cross-tenant platform ops (#462 §2.3), enforced by one edit in
 * @kuruma/shared, now shared by web + API.
 */
export const PLATFORM_ADMIN_ROLES = PLATFORM_ROLES

export function isPlatformAdmin(role: UserRole | undefined): boolean {
  return PLATFORM_ADMIN_ROLES.has(role ?? '')
}
