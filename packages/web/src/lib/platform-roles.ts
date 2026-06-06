/**
 * Roles allowed into the platform admin portal (`/admin/*`). Single source of
 * truth imported by the edge middleware and the `(admin)` layout.
 *
 * Deliberately NARROWER than `business-roles.ts` `BUSINESS_ROLES`: it admits the
 * `PLATFORM_ADMIN` super-admin and the legacy transitional `STAFF`/`ADMIN`
 * (schema.ts:23 — "no new users get them"), but NOT the tenant-scoped
 * `OPERATOR_OWNER`/`OPERATOR_STAFF`. Operators run a single tenant; the admin
 * portal is cross-tenant platform ops (#462 §2.3). Tightening to
 * `PLATFORM_ADMIN`-only later is one edit to this constant.
 *
 * Keep this module dependency-free (no `next/headers`, no DB) so the Edge
 * middleware can import it.
 */
export const PLATFORM_ADMIN_ROLES: ReadonlySet<string> = new Set([
  'PLATFORM_ADMIN',
  'STAFF',
  'ADMIN',
])

export function isPlatformAdmin(role: string | undefined): boolean {
  return PLATFORM_ADMIN_ROLES.has(role ?? '')
}
