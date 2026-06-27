import type { BookingSource } from '@kuruma/shared/enums'
import {
  type CallerContext,
  ForbiddenError,
  OperatorRequiredError,
  PRIVILEGED_ROLES,
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
 * How a thread/message read is scoped (#1205). Threads are private, like bookings
 * (not the public catalog), but scoped by *participant membership* for renters
 * rather than by an owner id:
 * - `all`         — PLATFORM_ADMIN only. Gated on `PRIVILEGED_ROLES`, NOT
 *                   `ctx.bypassScope`: a PARTNER carries `bypassScope` for
 *                   bookings/user-search, but must NOT read operators' threads —
 *                   gating on bypassScope here would re-open the leak #1168 closed.
 * - `operator`    — OPERATOR_* caller: only threads where `operatorId` matches.
 *                   Replaces the fail-closed `rejectOperatorContextUntilScoped`
 *                   gate that un-gated the operator side (#1205, slice 2).
 * - `participant` — every other caller (RENTER / PARTNER / legacy): only threads
 *                   they participate in. Unchanged from before.
 * - `none`        — OPERATOR_* missing operatorId: fail-closed (read nothing).
 */
export type ThreadReadScope =
  | { kind: 'all' }
  | { kind: 'operator'; operatorId: string }
  | { kind: 'participant'; userId: string }
  | { kind: 'none' }

export function threadReadScope(ctx: CallerContext): ThreadReadScope {
  if (PRIVILEGED_ROLES.has(ctx.role)) return { kind: 'all' }
  if (isOperatorRole(ctx.role)) {
    return ctx.operatorId ? { kind: 'operator', operatorId: ctx.operatorId } : { kind: 'none' }
  }
  return { kind: 'participant', userId: ctx.userId }
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
