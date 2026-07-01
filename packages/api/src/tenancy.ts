import type { BookingSource } from '@kuruma/shared/enums'
import {
  type CallerContext,
  ForbiddenError,
  OperatorRequiredError,
  ScopeRequiredError,
  isOperatorRole,
} from './middleware/auth'

/**
 * The write-operator resolver injected into the write routes — so a route can
 * resolve the target tenant without importing a repository (layering boundary).
 */
export type ResolveWriteOperatorId = (
  ctx: CallerContext,
  inputOperatorId?: string,
) => Promise<string>

/**
 * How a scoped repository read should be filtered by operator:
 * - `all`      — non-tenant callers: bypass roles (PLATFORM_ADMIN, legacy
 *                STAFF/ADMIN/PARTNER) AND renters. Renters browse the
 *                cross-operator marketplace catalog, so they are NOT scoped.
 * - `operator` — tenant-scoped caller (OPERATOR_*); filter to this operatorId
 * - `none`     — an OPERATOR_* caller missing its operatorId: fail-closed
 *
 * Only OPERATOR_OWNER / OPERATOR_STAFF are tenant-scoped. Everyone else reads
 * across all operators (admins by privilege, renters by marketplace design).
 */
export type OperatorReadScope =
  | { kind: 'all' }
  | { kind: 'operator'; operatorId: string }
  | { kind: 'none' }

export function operatorReadScope(ctx: CallerContext): OperatorReadScope {
  if (!isOperatorRole(ctx.role)) return { kind: 'all' }
  if (ctx.operatorId) return { kind: 'operator', operatorId: ctx.operatorId }
  return { kind: 'none' }
}

/**
 * #1101: row-scope for the fleet-wide blocks read. Blocks are operator-internal
 * management data, so the route gates MANAGEMENT_READ_ROLES (RENTER/PARTNER → 403
 * before this runs). This resolver must be TOTAL over the gate's admitted set and
 * fail closed: MANAGEMENT_READ_ROLES (= BUSINESS_ROLES) also admits legacy
 * STAFF/ADMIN, and #487 removed them from SCOPE_BYPASS_ROLES, so they are neither
 * bypass nor isOperatorRole — they must read nothing. Do NOT copy
 * `operatorReadScope` (`!isOperatorRole → all`): that catalog pattern would leak
 * cross-tenant blocks to a legacy admin.
 *
 * PARTNER is branched to `none` BEFORE the bypass check (mirroring
 * `bookingReadScope`): a PARTNER key carries `bypassScope: true` via
 * SCOPE_BYPASS_ROLES, so a bypass-first resolver would hand Trip.com every
 * operator's blocks. The route gate 403s PARTNER today, but encoding the denial
 * here makes the resolver safe to reuse on a future route without the leak
 * shipping silently.
 */
export type VehicleBlockReadScope =
  | { kind: 'all' }
  | { kind: 'operator'; operatorId: string }
  | { kind: 'none' }

export function vehicleBlockReadScope(ctx: CallerContext): VehicleBlockReadScope {
  if (ctx.role === 'PARTNER') return { kind: 'none' } // never expose internal blocks to a channel
  if (ctx.bypassScope) return { kind: 'all' }
  if (isOperatorRole(ctx.role)) {
    return ctx.operatorId ? { kind: 'operator', operatorId: ctx.operatorId } : { kind: 'none' }
  }
  return { kind: 'none' } // in-gate but neither bypass nor tenant: read nothing
}

/**
 * The two transport-supplied knobs a cross-operator list read carries: an explicit
 * target `operatorId`, or `includeAll` to opt into reading every tenant at once.
 */
export type CrossOperatorRead = { operatorId?: string | undefined; includeAll: boolean }

/**
 * Adjudicate a scoped list read for an `all`-scope caller and return the filters
 * the repository should run with. Tenant-scoped (`operator`) and fail-closed
 * (`none`) callers are decided at the repo, so their filters pass through
 * untouched — this only governs the bypass/marketplace `all` scope.
 *
 * Lives in the service layer (audit M3) so the "bypass caller must scope
 * explicitly" invariant is enforced once, below the route. A route that lists
 * tenant-owned inventory can no longer leak every operator's rows by forgetting a
 * hand-rolled guard: omitting both knobs throws `ScopeRequiredError` (-> 400).
 */
export function applyCrossOperatorReadScope<F extends { operatorId?: string }>(
  ctx: CallerContext,
  read: CrossOperatorRead,
  filters: F,
): F {
  if (operatorReadScope(ctx).kind !== 'all') return filters
  if (!read.operatorId && !read.includeAll) throw new ScopeRequiredError()
  return read.operatorId ? { ...filters, operatorId: read.operatorId } : filters
}

/**
 * Resolve a bypass-only operator narrowing for an aggregate read (#407, picker
 * slice 4 — dashboard/fleet-overview). An `all`-scope caller (a bypass admin
 * using the operator-context picker) may narrow a cross-operator aggregate to a
 * single operator; every tenant-scoped caller ignores a requested operatorId, so
 * a foreign `?operatorId=` can never widen their scope (the H2 invariant).
 *
 * Unlike {@link applyCrossOperatorReadScope}, a missing operatorId is NOT a 400:
 * these reads default to "all operators", so the absence of a pick is the
 * legitimate aggregate case. The strict config-list helper (throws
 * ScopeRequiredError) and this lenient one are deliberately different — config
 * lists were strict before the picker; these aggregate reads keep their working
 * no-param contract and only add narrowing.
 *
 * AUTHORITY — this helper is an ECHO, not the scope gate. It reads
 * `operatorReadScope`, which maps every non-operator role (incl. RENTER/PARTNER)
 * to `all`, so it returns the requested id for those roles too. That is only safe
 * because each consumer independently re-gates: the route (MANAGEMENT_READ_ROLES
 * → 403) rejects renter/partner, and the repo re-clamps to its own tenant. A
 * future `bookingReadScope`-private endpoint (slices 5a/5b/6) must NOT trust this
 * id blindly — it must re-clamp with its own scope vocabulary, or the two
 * vocabularies disagree and a private read leaks. Reconcile before then: #1272.
 */
export function narrowReadToOperator(
  ctx: CallerContext,
  requestedOperatorId: string | undefined,
): string | undefined {
  return operatorReadScope(ctx).kind === 'all' ? requestedOperatorId : undefined
}

/**
 * How a booking read is scoped (#392, proposal §6.2). Unlike the public vehicle
 * catalog (`operatorReadScope` maps renters to `all`), bookings are private:
 * - `all`      — the platform admin tier (PLATFORM_ADMIN). Gated on
 *                `ctx.bypassScope`, NOT a role string (slice-4 [P1]).
 * - `partner`  — a PARTNER channel (Trip.com): only the bookings it sourced
 *                (`source = TRIP_COM`), across operators. NOT operators' DIRECT
 *                bookings — that was a cross-tenant leak (#1119). Checked before
 *                `bypassScope` because PARTNER still bypasses for OTHER reads
 *                (user search, threads) via `SCOPE_BYPASS_ROLES`.
 * - `operator` — OPERATOR_* caller: only this tenant's bookings.
 * - `renter`   — every other caller (RENTER): only their own bookings.
 * - `none`     — OPERATOR_* missing operatorId: fail-closed (read nothing).
 */
export type BookingReadScope =
  | { kind: 'all' }
  | { kind: 'partner'; source: BookingSource }
  | { kind: 'operator'; operatorId: string }
  | { kind: 'renter'; renterId: string }
  | { kind: 'none' }

// The single PARTNER role today IS Trip.com, so its channel is TRIP_COM. When a
// second partner is onboarded this 1:1 must move onto the verified caller
// identity (CallerContext.partnerSource, set in toCallerContext) — otherwise
// every partner would share one source and read each other's bookings (#1119
// follow-up). Named so that future change is one obvious edit, not a hunt.
const PARTNER_SOURCE: BookingSource = 'TRIP_COM'

export function bookingReadScope(ctx: CallerContext): BookingReadScope {
  if (ctx.role === 'PARTNER') return { kind: 'partner', source: PARTNER_SOURCE }
  if (ctx.bypassScope) return { kind: 'all' }
  if (isOperatorRole(ctx.role)) {
    return ctx.operatorId ? { kind: 'operator', operatorId: ctx.operatorId } : { kind: 'none' }
  }
  return { kind: 'renter', renterId: ctx.userId }
}

/**
 * Resolve the operatorId to stamp on a write (#401, #407):
 * - OPERATOR_OWNER / OPERATOR_STAFF write under their own tenant; missing
 *   operatorId fails closed. They cannot write for another operator, so an
 *   `inputOperatorId` is ignored.
 * - PLATFORM_ADMIN / legacy STAFF / ADMIN must name the target operator
 *   explicitly via `inputOperatorId`. Sole-operator inference is retired (#407):
 *   a missing operatorId is always rejected (`OperatorRequiredError` -> 422), so
 *   an admin write can never be silently misattributed and there is no
 *   read-then-write TOCTOU. The web supplies the operatorId in every regime —
 *   a hidden default when one operator exists, an explicit pick when 2+.
 */
export async function resolveOperatorIdForWrite(
  ctx: CallerContext,
  inputOperatorId: string | undefined,
): Promise<string> {
  if (isOperatorRole(ctx.role)) {
    if (!ctx.operatorId) throw new ForbiddenError('operator scope required')
    return ctx.operatorId
  }
  if (inputOperatorId) return inputOperatorId
  throw new OperatorRequiredError('operatorId is required: specify a target operator')
}
