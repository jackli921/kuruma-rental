import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { type CallerContext, ForbiddenError, isOperatorRole } from './middleware/auth'

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
 * Resolve the operatorId to stamp on a write. TRANSITIONAL (slice 1, #386):
 * - OPERATOR_OWNER / OPERATOR_STAFF must write under their own tenant; missing
 *   operatorId fails closed. They cannot write on behalf of another operator,
 *   so an `inputOperatorId` is ignored for them.
 * - PLATFORM_ADMIN / legacy STAFF / ADMIN may pass an explicit operatorId, else
 *   fall back to the seeded Best Car Rental operator so the existing owner
 *   create-flow keeps working until operator-portal write paths land.
 *
 * Once admin create endpoints take an explicit operatorId, drop the fallback.
 */
export function resolveOperatorIdForWrite(ctx: CallerContext, inputOperatorId?: string): string {
  if (isOperatorRole(ctx.role)) {
    if (!ctx.operatorId) throw new ForbiddenError('operator scope required')
    return ctx.operatorId
  }
  return inputOperatorId ?? BEST_CAR_RENTAL_OPERATOR_ID
}
