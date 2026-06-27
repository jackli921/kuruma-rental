import { OPERATOR_ROLES, PLATFORM_ROLES } from '@kuruma/shared/auth/roles'

import type { CallerContext } from './context'
import { FLEET_WRITE_ROLES, MANAGEMENT_READ_ROLES, OPERATOR_OWNER_WRITE_ROLES } from './roles'

/**
 * Thrown by repo-layer guards when a non-authorised caller hits a
 * protected method. The global error handler maps this to a 403 response
 * so a bypassed route-level gate surfaces as a policy denial, not a 500.
 */
export class ForbiddenError extends Error {
  readonly name = 'ForbiddenError'
  constructor(message = 'Forbidden') {
    super(message)
  }
}

/**
 * Thrown when a non-operator caller (PLATFORM_ADMIN / legacy STAFF / ADMIN) tries
 * to create tenant-owned inventory without naming a target operator, and the
 * target cannot be inferred (zero or 2+ operators exist). Replaces the old
 * silent Best-Car-Rental default (#401) so a legacy admin write can no longer be
 * misattributed once a second operator exists. Mapped to 422 by the global
 * handler — the request is well-formed but missing a required `operatorId`.
 */
export class OperatorRequiredError extends Error {
  readonly name = 'OperatorRequiredError'
  constructor(message = 'operatorId is required') {
    super(message)
  }
}

/**
 * Thrown when an `all`-scope reader (PLATFORM_ADMIN / legacy STAFF / ADMIN, or a
 * renter — though the management routes gate renters out first) lists tenant-owned
 * inventory without naming a target operator or opting into `includeAll`. Without
 * this an accidental unscoped read returns every operator's private config — the
 * cross-tenant leak the 5 read routes used to each guard by hand. Mapped to 400 by
 * the global handler: the request is malformed (a required scope choice is absent).
 */
export class ScopeRequiredError extends Error {
  readonly name = 'ScopeRequiredError'
  constructor(message = 'operatorId or includeAll=true is required for cross-operator reads') {
    super(message)
  }
}

/**
 * Thrown when an operator self-service action names an id that does not resolve
 * within the caller's own tenant — an unknown invite/member, or one already in a
 * terminal state. Mapped to 404 by the global handler. Because every #904 path is
 * operator-scoped, a foreign-tenant id is indistinguishable from a missing one, so
 * this doubles as the cross-tenant seal (no existence oracle).
 */
export class NotFoundError extends Error {
  readonly name = 'NotFoundError'
  constructor(message = 'Not found') {
    super(message)
  }
}

/**
 * Thrown when a request is well-formed and authorized but conflicts with current
 * state: revoking the last active operator owner (would lock the tenant out), or
 * inviting an email that already has a pending invite. Mapped to 409 by the global
 * handler, surfacing `err.message` so the web can show the specific reason.
 */
export class ConflictError extends Error {
  readonly name = 'ConflictError'
  constructor(message = 'Conflict') {
    super(message)
  }
}

/**
 * Repo-layer read guard for operator-private config. Must be called BEFORE
 * `operatorReadScope(ctx)`, because that helper maps every non-operator role —
 * including RENTER — to `{kind:'all'}` (the vehicle catalog is public). Without
 * this seal a renter or PARTNER could read every operator's insurance/fees
 * config. Throws `ForbiddenError` (-> 403) for RENTER / PARTNER (slice-4 [P0]).
 */
export function requireManagementRead(ctx: CallerContext): void {
  if (!MANAGEMENT_READ_ROLES.has(ctx.role)) {
    throw new ForbiddenError('management read scope required')
  }
}

/**
 * Gate for PLATFORM-level reads that span every operator — the #462 admin
 * revenue tab. Admits only the platform tier (`PLATFORM_ROLES` = {PLATFORM_ADMIN}
 * after #487), the exact set the web `_admin` portal admits. References
 * PLATFORM_ROLES directly (not the STAFF_ROLES alias) so #487's tightening of
 * PLATFORM_ROLES → {PLATFORM_ADMIN} narrows this gate automatically. Deliberately
 * EXCLUDES OPERATOR_* (a tenant must never see another partner's revenue) and
 * RENTER / PARTNER. Narrower than `bypassScope`, which also covers PARTNER
 * (Trip.com) — a 3rd-party caller must not read revenue.
 */
export function requirePlatformRead(ctx: CallerContext): void {
  if (!PLATFORM_ROLES.has(ctx.role)) {
    throw new ForbiddenError('platform admin scope required')
  }
}

/**
 * Repo-layer guard for fleet mutation methods. Admits STAFF roles and
 * tenant-scoped operators (`FLEET_WRITE_ROLES`); a tenant-scoped caller missing
 * its operatorId fails closed via `requireOperatorScope`. Defence in depth
 * against a route forgetting its gate (issue #329). The caller's tenant is
 * enforced by the repository's operator predicate, so an admitted operator can
 * only mutate its own vehicles. `SYSTEM_CONTEXT` (PLATFORM_ADMIN) passes.
 */
export function requireFleetWriteScope(ctx: CallerContext): void {
  if (!FLEET_WRITE_ROLES.has(ctx.role)) {
    throw new ForbiddenError('fleet write scope required')
  }
  requireOperatorScope(ctx)
}

/**
 * Guard for owner-tier writes to operator money-flow fields (`preAuthHandoffUrl`,
 * #903). Admits `OPERATOR_OWNER_WRITE_ROLES` (the operator OWNER plus the
 * platform/legacy base) and EXCLUDES OPERATOR_STAFF — a staff edit could redirect
 * every renter's pre-auth payment handoff to a phishing page (the #386 http(s)
 * refine blocks `javascript:`/`ftp:` but NOT `https://attacker.example`). A
 * tenant-scoped owner missing its operatorId still fails closed via
 * `requireOperatorScope`. Throws `ForbiddenError` (-> 403). Call AFTER the
 * load-then-authorize 404 check so a foreign id never reveals a 403.
 */
export function requireOperatorOwnerWrite(ctx: CallerContext): void {
  if (!OPERATOR_OWNER_WRITE_ROLES.has(ctx.role)) {
    throw new ForbiddenError('operator owner scope required')
  }
  requireOperatorScope(ctx)
}

/**
 * Repo-layer guard for operator-scoped paths. Throws `ForbiddenError` if a
 * tenant-scoped caller (OPERATOR_*) reached a scoped method without an
 * operatorId — a fail-closed defence against a token that lost its tenant claim.
 */
export function requireOperatorScope(ctx: CallerContext): void {
  if (OPERATOR_ROLES.has(ctx.role) && !ctx.operatorId) {
    throw new ForbiddenError('operator scope required')
  }
}

/**
 * Guard for platform-admin-only paths (operator bootstrap, proposal §9 item 23).
 * Only PLATFORM_ADMIN passes — legacy STAFF/ADMIN do NOT, since operator
 * creation is a platform-governance action, not a fleet-management one.
 * `SYSTEM_CONTEXT` (role PLATFORM_ADMIN) passes.
 */
export function requirePlatformAdmin(ctx: CallerContext): void {
  if (ctx.role !== 'PLATFORM_ADMIN') {
    throw new ForbiddenError('PLATFORM_ADMIN role required')
  }
}
