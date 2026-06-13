import type { OperatorBookingStatus } from '@/vite/operator-bookings/api'

/** Which operator actions the trip-detail panel offers for a given status. */
export interface BookingActions {
  /** CONFIRMED → ACTIVE (pickup). */
  markActive: boolean
  /** ACTIVE → COMPLETED (return). */
  markCompleted: boolean
  /** Swap the assigned car (CONFIRMED | ACTIVE — substitute()'s own gate). */
  substitute: boolean
  /** Cancel with a fee tier (CONFIRMED-only — POST /cancel 409s on ACTIVE). */
  cancel: boolean
}

// Local mirror of the booking state machine's forward transitions. Deliberately
// NOT imported from @kuruma/shared/db/schema: that module's *value* exports
// (VALID_BOOKING_TRANSITIONS) live alongside 16 pgTable() definitions with no
// /*#__PURE__*/ annotations, so a value-import drags drizzle-orm + pg-core into
// the browser bundle (web ships no DB layer). The parity test in
// booking-actions.test.ts imports the schema map (node-only) and asserts this
// stays in sync, so the schema remains the source of truth if a transition changes.
export const OPERATOR_BOOKING_TRANSITIONS: Record<OperatorBookingStatus, OperatorBookingStatus[]> =
  {
    CONFIRMED: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  }

/**
 * #616: derive the available actions from `status`. Status transitions mirror the
 * real state machine (OPERATOR_BOOKING_TRANSITIONS, parity-tested against the
 * schema) so the buttons can't drift from the backend; substitute and cancel
 * follow their OWN backend rules rather than the transitions map (substitute is
 * not a status change; cancel is fee-bearing and CONFIRMED-only), which is why
 * this is not `transitions.includes(...)` for those two.
 */
export function actionsFor(status: OperatorBookingStatus): BookingActions {
  const transitions = OPERATOR_BOOKING_TRANSITIONS[status] ?? []
  return {
    markActive: transitions.includes('ACTIVE'),
    markCompleted: transitions.includes('COMPLETED'),
    substitute: status === 'CONFIRMED' || status === 'ACTIVE',
    cancel: status === 'CONFIRMED',
  }
}
