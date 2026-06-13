/**
 * Canonical authorization role model — the SINGLE SOURCE OF TRUTH for role
 * identifiers and membership sets, consumed by BOTH the API (CF Workers) and the
 * web edge middleware (CF Pages). Kills the web/api mirror-drift bug class (#387)
 * and de-overloads the platform tier from the business-management base so #487
 * ("revoke legacy STAFF/ADMIN platform-admin access") becomes a one-line edit.
 *
 * PURE DATA, ZERO IMPORTS — this is load-bearing: importing `@kuruma/shared/auth/
 * roles` must never pull in drizzle / jose / node:crypto, or it breaks the Next
 * edge middleware. Reach it only via the dedicated subpath export, never the
 * package barrel (which re-exports the DB layer). The DB enum `roleEnum` in
 * db/schema.ts is the persistence mirror (6 roles, no PARTNER); it deliberately
 * differs from this authz model (7 roles) and cannot be reused here.
 */

export type UserRole =
  | 'RENTER'
  | 'STAFF'
  | 'ADMIN'
  | 'PARTNER'
  | 'OPERATOR_OWNER'
  | 'OPERATOR_STAFF'
  | 'PLATFORM_ADMIN'

// Typed on UserRole for definition-time safety (a typo'd member fails to compile),
// but returned as ReadonlySet<string> so both callers can membership-test a raw
// session/JWT string with no cast: the API passes a UserRole, web passes a string.
const roleSet = (...roles: readonly UserRole[]): ReadonlySet<string> => new Set(roles)
const union = (...sets: readonly ReadonlySet<string>[]): ReadonlySet<string> =>
  new Set(sets.flatMap((s) => [...s]))

/** Every valid authz role (includes API-only PARTNER). Used for JWT role validation. */
export const ALL_ROLES = roleSet(
  'RENTER',
  'STAFF',
  'ADMIN',
  'PARTNER',
  'OPERATOR_OWNER',
  'OPERATOR_STAFF',
  'PLATFORM_ADMIN',
)

/** Tenant-scoped operators. They NEVER bypass operator scope (proposal §6.2). */
export const OPERATOR_ROLES = roleSet('OPERATOR_OWNER', 'OPERATOR_STAFF')

/**
 * Platform-admin tier — the cross-tenant admin portal (`/admin/*`), the revenue
 * report, and the platform-staff route gates. PLATFORM_ADMIN is the sanctioned
 * super-admin; legacy STAFF/ADMIN are transitional equivalents.
 *
 * #487 tightens THIS set to `{PLATFORM_ADMIN}`. Kept a SEPARATE instance from
 * {@link MANAGEMENT_BASE_ROLES} (identical members today) precisely so that
 * tightening does not also strip legacy admins from business management — the two
 * policies must move independently. Do NOT merge them.
 */
export const PLATFORM_ROLES = roleSet('STAFF', 'ADMIN', 'PLATFORM_ADMIN')

/**
 * Base of the business-management tier (fleet write + operator-private config
 * read), before adding tenant operators. Separate instance from
 * {@link PLATFORM_ROLES} on purpose (see above).
 */
export const MANAGEMENT_BASE_ROLES = roleSet('STAFF', 'ADMIN', 'PLATFORM_ADMIN')

/**
 * Full business tier admitted to the operator portal (`/manage/*`) and fleet
 * read/write: the management base PLUS tenant operators. Composed so it tracks
 * {@link MANAGEMENT_BASE_ROLES} automatically.
 */
export const BUSINESS_ROLES = union(MANAGEMENT_BASE_ROLES, OPERATOR_ROLES)

/**
 * Cross-tenant read bypass — the platform tier PLUS PARTNER (Trip.com reads
 * bookings across tenants). Drives `CallerContext.bypassScope`. A distinct
 * instance from {@link PRIVILEGED_ROLES} (same members today) because the two gate
 * different things and may diverge under #487.
 */
export const SCOPE_BYPASS_ROLES = roleSet('STAFF', 'ADMIN', 'PARTNER', 'PLATFORM_ADMIN')

/**
 * Roles permitted to read cross-tenant private data (message threads, user lists).
 * Platform tier PLUS PARTNER. Distinct instance from {@link SCOPE_BYPASS_ROLES}.
 */
export const PRIVILEGED_ROLES = roleSet('STAFF', 'ADMIN', 'PARTNER', 'PLATFORM_ADMIN')
