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
 * report, and the platform-staff route gates (aliased as STAFF_ROLES in the API:
 * customers, documents, maintenance logs, vehicle photos, etc.). PLATFORM_ADMIN
 * is now the SOLE platform-staff role.
 *
 * #487 tightened THIS set to `{PLATFORM_ADMIN}`, revoking the legacy transitional
 * STAFF/ADMIN from every platform-staff gate at once. Kept a SEPARATE instance
 * from {@link MANAGEMENT_BASE_ROLES} precisely so this did NOT strip legacy admins
 * from business management — the two policies move independently. Do NOT merge.
 * #487 also tightened {@link SCOPE_BYPASS_ROLES} / {@link PRIVILEGED_ROLES} to
 * `{PARTNER, PLATFORM_ADMIN}`, so legacy STAFF/ADMIN no longer bypass operator
 * scope or read cross-tenant private data either — the revocation is complete.
 */
export const PLATFORM_ROLES = roleSet('PLATFORM_ADMIN')

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
 * Owner-tier writes — operator-profile money-flow fields, currently
 * `preAuthHandoffUrl` (#903). Business management MINUS the OPERATOR_STAFF role:
 * one staff edit could redirect every renter's pre-auth pay-at-pickup handoff to
 * a phishing page, so the field is gated to the operator OWNER (plus the platform
 * tier, which can already act on any tenant). Composed from MANAGEMENT_BASE_ROLES
 * so it tracks the platform/legacy base automatically. Do NOT add OPERATOR_STAFF.
 */
export const OPERATOR_OWNER_WRITE_ROLES = union(MANAGEMENT_BASE_ROLES, roleSet('OPERATOR_OWNER'))

/**
 * Cross-tenant read bypass — the platform tier PLUS PARTNER. Drives
 * `CallerContext.bypassScope`. NOTE (#1119): bookings are NO LONGER part of this
 * bypass for PARTNER — a Trip.com key reads only its own channel
 * (`bookingReadScope` -> `partner`, source=TRIP_COM), not operators' DIRECT
 * bookings. PARTNER stays in this set as a SCOPE-GATE marker (its presence tells
 * `bookingReadScope` to take the per-source path), but it no longer unlocks any
 * other cross-tenant private read: the directory/messaging surfaces now gate on
 * {@link PRIVILEGED_ROLES} (PLATFORM_ADMIN-only since #1168), and `customer.ts`
 * was switched to that predicate too. Distinct instance from PRIVILEGED_ROLES —
 * the two now have genuinely different membership.
 */
export const SCOPE_BYPASS_ROLES = roleSet('PARTNER', 'PLATFORM_ADMIN')

/**
 * Roles permitted to read cross-tenant PRIVATE data (message threads, message
 * bodies, the user-id->name directory, the customer search table). PLATFORM_ADMIN
 * ONLY. #1168 dropped PARTNER: a Trip.com booking channel has no private-data use
 * case, and those routes gate on `requireUser` only — keeping PARTNER here let a
 * partner key enumerate every tenant's threads and users (the leak class #1119
 * closed for bookings). PARTNER's lone cross-tenant read, its own bookings, is
 * scoped in `bookingReadScope` via {@link SCOPE_BYPASS_ROLES}, NOT here.
 */
export const PRIVILEGED_ROLES = roleSet('PLATFORM_ADMIN')
