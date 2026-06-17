import type { calculateCancellationFee } from '@kuruma/shared/lib/cancellation-policy'
import type { CallerContext } from '../middleware/auth'
import type { Booking } from '../stores'

// Fields common to every booking regardless of fulfillment mode (#464). The
// mode-specific id — requestedVehicleId (SPECIFIC) or classId (CLASS_COMBO) —
// lives on the discriminated members below.
interface CreateBookingCommon {
  pickupLocationId: string
  dropoffLocationId: string
  insuranceOptionId?: string | null
  // Selected paid add-on ids (#460). Required at the service boundary (the
  // validator defaults it to []); the route forwards parsed.data.addOnIds.
  addOnIds: string[]
  // The booking's renter — the route always fills it: the authenticated caller for
  // a self-serve booking, or a target renter for a staff/operator manual booking.
  // For a walk-in (#589 1c) it is ignored: walkInCustomer takes over and the
  // service creates + uses a fresh renter instead.
  renterId: string
  // #589 1c: operator walk-in — create a fresh renter (name + phone, no email)
  // and book for them. The service resolves this to the concrete renterId it uses.
  walkInCustomer?: { name: string; phone: string }
  startAt: Date
  endAt: Date
  source: Booking['source']
  externalId?: string | null
  notes?: string | null
  idempotencyKey?: string | null
  // #613: renter ticked the liability-disclaimer (免责声明) checkbox at checkout.
  // Required for renter self-serve bookings (enforced by caller role in `create`);
  // staff/manual bookings are exempt. The server stamps the timestamp + version.
  disclaimerAccepted?: boolean
}

// #464: the two fulfillment modes as a discriminated union (over optional id bags
// — see typescript.md). The route builds the right member from the validated body.
//  - SPECIFIC (slice 6, #392): the renter books a CONCRETE vehicle chosen in the
//    storefront. operatorId / classId / assignedVehicleId / totalPrice are all
//    server-derived from that vehicle — never client fields (proposal §6.2, §4.1).
//  - CLASS_COMBO (#464 slice 2): the renter books a vehicle CLASS at a pickup
//    location; no car is chosen at book time (the booking "floats"). The server
//    derives operatorId from the location and prices off the class rate plan.
export type CreateBookingInput =
  | (CreateBookingCommon & { fulfillmentMode: 'SPECIFIC'; requestedVehicleId: string })
  | (CreateBookingCommon & { fulfillmentMode: 'CLASS_COMBO'; classId: string })

export type CreateBookingResult =
  | { ok: true; booking: Booking; status?: 200 }
  | {
      ok: false
      status: 400 | 403 | 409
      error: string | Record<string, string[]>
      code?: string
      details?: { required: number; actual: number }
    }

/**
 * Optional pre-transaction authorization gate (#459). When injected, `create`
 * runs it after idempotency replay and before the booking transaction; a denial
 * short-circuits with 403. BookingService stays decoupled from the document
 * domain — it only knows "there may be a gate" (DIP).
 */
export type BookingVerificationGate = (
  ctx: CallerContext,
  input: CreateBookingInput,
) => Promise<
  { ok: true } | { ok: false; status: 403; error: string; code: 'DOCUMENT_VERIFICATION_REQUIRED' }
>

export type SubstituteResult =
  | { ok: true; booking: Booking }
  | { ok: false; status: 400 | 404 | 409; error: string }

export type StatusTransitionResult =
  | { ok: true; booking: Booking }
  | { ok: false; status: 400 | 404 | 409; error: string }

export type CancelResult =
  | {
      ok: true
      booking: Booking
      cancellation: ReturnType<typeof calculateCancellationFee>
    }
  | { ok: false; status: 404 | 409; error: string }
