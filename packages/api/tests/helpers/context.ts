import type { CallerContext } from '../../src/middleware/auth'

// Reusable CallerContext builders for real-DB integration tests (#654). Pure —
// no DB — so any test (S3/S4 journeys included) can scope a repository/service
// call to a given actor without re-declaring the inline `ctxFor` shape.

/** Operator-owner context scoped to one tenant. Drives `operatorId` read scope. */
export function operatorCtx(operatorId: string): CallerContext {
  return { userId: 'owner', role: 'OPERATOR_OWNER', operatorId, bypassScope: false }
}

/**
 * Renter context. A RENTER has no `operatorId` claim (tenant-less); the booking
 * API forces `renterId = ctx.userId` for non-staff, so reads are renter-scoped.
 */
export function renterCtx(renterId: string): CallerContext {
  return { userId: renterId, role: 'RENTER', bypassScope: false }
}
