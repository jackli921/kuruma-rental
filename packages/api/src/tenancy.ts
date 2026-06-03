import {
  type CallerContext,
  ForbiddenError,
  OperatorRequiredError,
  isOperatorRole,
} from './middleware/auth'

/**
 * Narrow read capability the write-operator resolver needs: the id of the only
 * operator, or null when there is not exactly one (zero or 2+). Implemented by
 * `OperatorRepository`; injected so the resolver stays a pure policy function.
 */
export interface OperatorLookup {
  findSoleId(): Promise<string | null>
}

/**
 * The write-operator resolver bound to a concrete `OperatorLookup` at the
 * composition root and injected into the write routes — so a route can resolve
 * the target tenant without importing a repository (layering boundary).
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
 * Resolve the operatorId to stamp on a write (#401):
 * - OPERATOR_OWNER / OPERATOR_STAFF write under their own tenant; missing
 *   operatorId fails closed. They cannot write for another operator, so an
 *   `inputOperatorId` is ignored.
 * - PLATFORM_ADMIN / legacy STAFF / ADMIN must name the target operator — either
 *   explicitly via `inputOperatorId`, or implicitly when exactly one operator
 *   exists (single-tenant inference). Zero or 2+ operators with no explicit id
 *   is ambiguous and rejected (`OperatorRequiredError` -> 422), so a legacy
 *   admin write can never be silently misattributed once operator #2 exists.
 *   Replaces the old hardcoded Best-Car-Rental fallback.
 */
export async function resolveOperatorIdForWrite(
  ctx: CallerContext,
  inputOperatorId: string | undefined,
  operators: OperatorLookup,
): Promise<string> {
  if (isOperatorRole(ctx.role)) {
    if (!ctx.operatorId) throw new ForbiddenError('operator scope required')
    return ctx.operatorId
  }
  if (inputOperatorId) return inputOperatorId
  const soleOperatorId = await operators.findSoleId()
  if (soleOperatorId) return soleOperatorId
  throw new OperatorRequiredError(
    'operatorId is required: specify a target operator (zero or multiple operators exist)',
  )
}
