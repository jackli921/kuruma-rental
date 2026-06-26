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

export function bookingReadScope(ctx: CallerContext): BookingReadScope {
  if (ctx.role === 'PARTNER') return { kind: 'partner', source: 'TRIP_COM' }
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
