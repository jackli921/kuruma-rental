import {
  type CallerContext,
  ForbiddenError,
  OperatorRequiredError,
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
 * How a booking read is scoped (#392, proposal §6.2). Unlike the public vehicle
 * catalog (`operatorReadScope` maps renters to `all`), bookings are private:
 * - `all`      — bypass callers (PLATFORM_ADMIN / legacy STAFF/ADMIN/PARTNER).
 *                Gated on `ctx.bypassScope`, NOT a role string (slice-4 [P1]).
 * - `operator` — OPERATOR_* caller: only this tenant's bookings.
 * - `renter`   — every other caller (RENTER): only their own bookings.
 * - `none`     — OPERATOR_* missing operatorId: fail-closed (read nothing).
 */
export type BookingReadScope =
  | { kind: 'all' }
  | { kind: 'operator'; operatorId: string }
  | { kind: 'renter'; renterId: string }
  | { kind: 'none' }

export function bookingReadScope(ctx: CallerContext): BookingReadScope {
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
