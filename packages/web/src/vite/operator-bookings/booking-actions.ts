import type { OperatorBookingStatus } from '@/vite/operator-bookings/api'
import { VALID_BOOKING_TRANSITIONS } from '@kuruma/shared/db/schema'

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

/**
 * #616: derive the available actions from `status`. Status transitions come from
 * the real state machine (VALID_BOOKING_TRANSITIONS) so the buttons can't drift
 * from the backend; substitute and cancel follow their OWN backend rules rather
 * than the transitions map (substitute is not a status change; cancel is fee-
 * bearing and CONFIRMED-only), which is why this is not `transitions.includes(...)`.
 */
export function actionsFor(status: OperatorBookingStatus): BookingActions {
  const transitions = VALID_BOOKING_TRANSITIONS[status] ?? []
  return {
    markActive: transitions.includes('ACTIVE'),
    markCompleted: transitions.includes('COMPLETED'),
    substitute: status === 'CONFIRMED' || status === 'ACTIVE',
    cancel: status === 'CONFIRMED',
  }
}
