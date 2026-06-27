import { STAFF_ROLES, isOperatorRole } from '../auth/roles'
import type { CallerContext } from '../middleware/auth'
import type { Booking } from '../stores'

// Raw request fields the actor policy reads. A subset of CreateBookingInput —
// kept local so the policy is a pure function with no dependency on the full
// (discriminated-union) command shape.
export interface BookingActorRequest {
  // The renter a manual booker is booking for; absent for self-serve.
  renterId?: string
  // The source the caller asked for; only honored for manual bookers.
  source: Booking['source']
  // An inline walk-in customer; only honored for manual bookers (#589 1c).
  walkInCustomer?: { name: string; phone: string }
}

// The booking command's resolved actor: who the booking is for, its source, and
// (when applicable) the walk-in to create. renterId is always concrete here.
export interface ResolvedBookingActor {
  renterId: string
  source: Booking['source']
  walkInCustomer?: { name: string; phone: string }
}

/**
 * #1108 (audit M4): "who may book on behalf of whom, and force source=MANUAL" is
 * domain authz, not a route concern (SRP — a route may *reject* on role, but the
 * moment it *rewrites the payload* on role, that belongs to the service). Pure
 * and Hono-free so it is unit-testable in isolation; `BookingCreationService.create`
 * calls it and trusts the result.
 *
 * #589: STAFF and OPERATOR_* are "manual bookers" — they may book on behalf of a
 * renter (renterId) and set source=MANUAL. An operator's renterId is authorized
 * downstream against its OWN customer scope (scope-first, no user-table probe —
 * preserving the #396/#475 enumeration defense). Everyone else (renters,
 * api-key PARTNER callers) books as themselves with source forced to DIRECT, so
 * a non-manual caller can't bypass advance-booking-hours via MANUAL nor register
 * a walk-in (#589 1c).
 */
export function resolveBookingActor(
  ctx: Pick<CallerContext, 'userId' | 'role'>,
  request: BookingActorRequest,
): ResolvedBookingActor {
  const isManualBooker = STAFF_ROLES.has(ctx.role) || isOperatorRole(ctx.role)
  const renterId = isManualBooker && request.renterId ? request.renterId : ctx.userId
  const source = isManualBooker ? request.source : 'DIRECT'
  const walkInCustomer = isManualBooker ? request.walkInCustomer : undefined
  // Omit walkInCustomer entirely when absent (exactOptionalPropertyTypes forbids
  // an explicit `walkInCustomer: undefined`).
  return walkInCustomer ? { renterId, source, walkInCustomer } : { renterId, source }
}
