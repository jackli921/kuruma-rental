import { PLATFORM_ROLES } from '@kuruma/shared/auth/roles'

/**
 * Roles allowed into the platform admin portal (`/admin/*`). Re-exported from the
 * single source of truth @kuruma/shared/auth/roles (PLATFORM_ROLES) so the web
 * edge middleware and the API can't drift (#387). That module is pure data with
 * zero imports, so this module stays Edge-safe (no `next/headers`, no DB) —
 * verified: bundling @kuruma/shared/auth/roles pulls in no drizzle/postgres/jose.
 *
 * Deliberately NARROWER than business-roles.ts `BUSINESS_ROLES`: it admits the
 * `PLATFORM_ADMIN` super-admin and the legacy transitional `STAFF`/`ADMIN`
 * (schema.ts:23 — "no new users get them"), but NOT the tenant-scoped
 * `OPERATOR_OWNER`/`OPERATOR_STAFF`. The admin portal is cross-tenant platform
 * ops (#462 §2.3). #487 tightens this to `PLATFORM_ADMIN`-only via one edit in
 * @kuruma/shared, now shared by web + API.
 */
export const PLATFORM_ADMIN_ROLES = PLATFORM_ROLES

export function isPlatformAdmin(role: string | undefined): boolean {
  return PLATFORM_ADMIN_ROLES.has(role ?? '')
}
