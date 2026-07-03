import type { BookingSource } from '@kuruma/shared/enums'
import type { ErrorCode } from '@kuruma/shared/lib/error-codes'
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
 * Resolve a bypass-only operator narrowing for an aggregate read (#407, picker
 * slice 4 — dashboard/fleet-overview). An `all`-scope caller (a bypass admin
 * using the operator-context picker) may narrow a cross-operator aggregate to a
 * single operator; every non-`all` caller drops a requested operatorId, so a
 * foreign `?operatorId=` can never widen their scope (the H2 invariant).
 *
 * Unlike {@link applyCrossOperatorReadScope}, a missing operatorId is NOT a 400:
 * these reads default to "all operators", so the absence of a pick is the
 * legitimate aggregate case. The strict config-list helper (throws
 * ScopeRequiredError) and this lenient one are deliberately different — config
 * lists were strict before the picker; these aggregate reads keep their working
 * no-param contract and only add narrowing.
 *
 * VOCABULARY (#1272) — the caller passes the scope resolver that matches its
 * read's privacy model, and the id is honored ONLY when that resolver returns
 * `all`. The aggregate reads pass {@link bookingReadScope} (private-read
 * vocabulary), under which only a true bypass admin is `all`; renter, partner,
 * and legacy STAFF/ADMIN map to non-`all` kinds, so their requested id drops
 * here. This closes the earlier echo trap: the helper used to key off
 * `operatorReadScope` (catalog vocabulary), which maps every non-operator role to
 * `all` and so echoed a renter's `?operatorId=` — safe only while the route
 * 403'd renters, but a latent leak for a future `bookingReadScope`-private
 * consumer (slices 5a/5b/6) that reused this helper without re-clamping. Now that
 * consumer passes its own scope resolver, so the vocabularies cannot disagree.
 */
export function narrowReadToOperator(
  ctx: CallerContext,
  requestedOperatorId: string | undefined,
  resolveScope: (ctx: CallerContext) => { kind: string },
): string | undefined {
  return resolveScope(ctx).kind === 'all' ? requestedOperatorId : undefined
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
 * Why a fleet WRITE is refused when a non-tenant caller has not bound itself to
 * the operator that owns the target (#1260):
 * - `operator-required` — no acting operatorId was supplied (mapped to 422).
 * - `not-in-scope`      — the acting operator does not own the target vehicle,
 *                         so from that context the target does not exist (404).
 */
export type FleetWriteDenial = { kind: 'operator-required' } | { kind: 'not-in-scope' }

/**
 * The core operator-binding denial (#1260): when a caller reached the target
 * through an UNSCOPED `all` read, it must name the operator it is acting as, and
 * that operator must own the target. Row/tenant-scoped callers pass through — the
 * repository read scope already clamped them, so `findById` never handed them a
 * foreign row. Whether a caller reads `all` is RESOURCE-specific, so each wrapper
 * resolves that and passes the boolean in.
 */
function operatorBindingDenial(
  readsAllOperators: boolean,
  targetOperatorId: string,
  actingOperatorId: string | undefined,
): FleetWriteDenial | null {
  if (!readsAllOperators) return null
  if (!actingOperatorId) return { kind: 'operator-required' }
  if (actingOperatorId !== targetOperatorId) return { kind: 'not-in-scope' }
  return null
}

/**
 * Bind a fleet WRITE to the operator the caller is acting as (#1260).
 *
 * A tenant operator (OPERATOR_*) is already clamped to its own tenant by the
 * repository read scope — `findById` returns undefined for a foreign vehicle —
 * so its write needs no acting-operator id and a stray one is ignored.
 *
 * Every other admitted caller (PLATFORM_ADMIN, and legacy STAFF/ADMIN) resolves
 * `all` under `operatorReadScope`, so `findById` hands them ANY operator's
 * vehicle by raw id. Keyed on `!isOperatorRole` (NOT `ctx.bypassScope`) because
 * #487 dropped legacy STAFF/ADMIN from the bypass set yet left them `all`-scoped
 * — bypass-keying would leave that pair able to write cross-tenant. Such a caller
 * must name the operator it picked, and that operator must own the target;
 * otherwise the client-side "read-only preview" would be its only protection.
 */
export function assertFleetWriteWithinOperator(
  ctx: CallerContext,
  targetOperatorId: string,
  actingOperatorId: string | undefined,
): FleetWriteDenial | null {
  return operatorBindingDenial(!isOperatorRole(ctx.role), targetOperatorId, actingOperatorId)
}

/**
 * Bind a booking lifecycle WRITE (status advance, cancel) to the operator the
 * caller picked (#1260). Bookings are PRIVATE: `bookingReadScope` maps only the
 * bypass tier (PLATFORM_ADMIN) to `all`; renters read their own, operators their
 * tenant, partners their sourced channel — all already clamped by `findById`. So
 * bind the write only for that `all` reader. Keyed on the resolved read scope, NOT
 * `!isOperatorRole` (the fleet key): `/cancel` has no route gate and admits
 * renters (self-cancel) and legacy STAFF/ADMIN — both renter-scoped for bookings —
 * who must never be forced to name an operator, and the fleet key would 422 them.
 */
export function assertBookingWriteWithinOperator(
  ctx: CallerContext,
  targetOperatorId: string,
  actingOperatorId: string | undefined,
): FleetWriteDenial | null {
  return operatorBindingDenial(
    bookingReadScope(ctx).kind === 'all',
    targetOperatorId,
    actingOperatorId,
  )
}

/**
 * Map a {@link FleetWriteDenial} to the shape a fleet-write service returns
 * (#1260). Wired to booking status writes today; the block/vehicle slices adopt
 * the same mapper so the refusal contract stays identical everywhere:
 * - operator-required -> 422 carrying the same OPERATOR_REQUIRED code the global
 *   OperatorRequiredError emits, so the web can discriminate "pick an operator".
 * - not-in-scope      -> 404 with the CALLER's own not-found message: from the
 *   acting operator's tenant the target simply does not exist (no existence
 *   oracle), so a booking's 404 reads 'Booking not found', a vehicle's 'Vehicle
 *   not found', indistinguishable from a truly-unknown id.
 */
export function fleetWriteDenialResult(
  denial: FleetWriteDenial,
  notFoundError: string,
): { ok: false; status: 422 | 404; error: string; code?: ErrorCode } {
  return denial.kind === 'operator-required'
    ? {
        ok: false,
        status: 422,
        error: 'operatorId is required: specify the operator to act as',
        code: 'OPERATOR_REQUIRED',
      }
    : { ok: false, status: 404, error: notFoundError }
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

/**
 * Resolve the operator whose TEAM the caller may read/manage (#1230 slice 6).
 *
 * Deliberately STRICTER than {@link resolveOperatorIdForWrite}: team data is
 * operator-internal, owner-tier, so a foreign operatorId is honored ONLY for
 * PRIVILEGED_ROLES (PLATFORM_ADMIN). It is an allowlist, not a bypass-first
 * denylist — operator role OR PRIVILEGED_ROLES pass; everyone else (renter,
 * PARTNER, legacy STAFF/ADMIN) falls into `else` and is denied, which is why no
 * explicit PARTNER branch is needed. Do NOT collapse this onto the write
 * resolver: it keys on `!isOperatorRole` and would honor legacy STAFF/ADMIN,
 * silently opening a cross-tenant team write (pinned by a route test).
 */
export function resolveTeamOperatorId(ctx: CallerContext, inputOperatorId?: string): string {
  if (isOperatorRole(ctx.role)) {
    if (!ctx.operatorId) throw new ForbiddenError('operator scope required')
    return ctx.operatorId // input IGNORED — an operator cannot act cross-tenant
  }
  if (PRIVILEGED_ROLES.has(ctx.role)) {
    if (inputOperatorId) return inputOperatorId // the `all` tier — honored ONLY here
    throw new OperatorRequiredError('operatorId is required: specify a target operator')
  }
  throw new ForbiddenError('operator scope required') // renter / partner / legacy
}
