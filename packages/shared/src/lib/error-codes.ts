/**
 * Single source of truth for envelope failure codes carried in the API
 * response `code` field (#941). The shared `ApiResponse` envelope types
 * `code?: ErrorCode`, so a producer (`fail(c, …, { code })` / `c.json`) and a
 * consumer (`body.code === '…'`, `ApiError.code`) agree at compile time — a
 * typo or rename surfaces as a `tsc` error, not a silently `undefined` code.
 *
 * Expand-only: add a code here, append `satisfies ErrorCode` at the emit site,
 * and pin it in `error-codes.test.ts`. YAGNI holds at this size — this is the
 * Rule-of-Three cleanup, done once.
 */
export const ERROR_CODES = [
  // Emitted directly at a route / error handler.
  'OPERATOR_REQUIRED',
  'DOCUMENT_VERIFICATION_REQUIRED',
  'CONSENT_REQUIRED',
  'INVALID_VEHICLE_CLASS',
  'CLASS_HAS_ACTIVE_BOOKINGS',
  'LOCATION_HAS_ACTIVE_BOOKINGS',
  // #1206: a booking is attempted against a soft-deactivated operator
  // (operators.deactivatedAt set); booking create 409s — the operator is not
  // accepting new bookings. Laundered onto the envelope via CreateBookingResult.code.
  'OPERATOR_DEACTIVATED',
  // #464: a CLASS_COMBO booking is accepted by the validator but combo creation
  // (inventory guard + rate-plan pricing) is not yet built — POST /bookings 501s.
  'NOT_IMPLEMENTED',
  // Laundered onto the booking-create envelope via `CreateBookingResult.code`
  // (booking-creation.ts → bookings.ts `fail(c, …, { code: createResult.code })`):
  // pricing (`@kuruma/shared/lib/pricing`) and rental-rule (`…/lib/rental-rules`)
  // checks. `CreateBookingResult.code` is narrowed to `ErrorCode`, so a new one
  // can't reach the wire without being listed here.
  'INVALID_DURATION',
  'NO_RATES_SET',
  'RENTAL_RULE_ADVANCE_BOOKING',
  'RENTAL_RULE_START_IN_PAST',
  'RENTAL_RULE_MIN_DURATION',
  'RENTAL_RULE_MAX_DURATION',
  // §5.3 (#916): the rental ends after the vehicle's shaken/insurance expires.
  'VEHICLE_DOCS_EXPIRE_BEFORE_RETURN',
  // #464 2d.3 CLASS_COMBO submit codes:
  //  NO_COMBO_RATE_SET — the (operator, class, pickupLocation) triple has no
  //   ACTIVE class rate plan, so the deal isn't published; combo create 400s.
  //  CLASS_COMBO_SOLD_OUT — class fleet supply for the requested window is
  //   already consumed by overlapping bookings (SPECIFIC + combo both count
  //   via classId + pickupLocationId); combo create 409s.
  'NO_COMBO_RATE_SET',
  'CLASS_COMBO_SOLD_OUT',
  // #1101: a SPECIFIC booking overlaps a scheduled vehicle block (maintenance /
  // out-of-service / manual hold) on the assigned car over its turnaround-
  // inclusive window; create 409s.
  'VEHICLE_BLOCKED',
  // #1101: an operator schedules a vehicle block whose window overlaps an
  // existing block on the same car (the vehicle_blocks_no_overlap GiST EXCLUDE);
  // block create 409s. Distinct from VEHICLE_BLOCKED (a booking hitting a block).
  'VEHICLE_BLOCK_OVERLAP',
  // #1196: an operator schedules a vehicle block whose window overlaps a
  // CONFIRMED/ACTIVE booking on the same car (turnaround-inclusive) — the reverse
  // of VEHICLE_BLOCKED. Block create 409s rather than silently taking a car with a
  // live booking off the calendar (the renter still shows up).
  'BLOCK_BOOKING_CONFLICT',
  // #464 assign: operator assigns a concrete car to a CLASS_COMBO float.
  //  NOT_A_COMBO         — target booking is not a CLASS_COMBO (e.g. a SPECIFIC booking)
  //  INVALID_STATUS      — booking is in a terminal status (CANCELLED / COMPLETED)
  //  VEHICLE_UNAVAILABLE — the assigned car is already booked for the window (exclusion)
  //  USE_ASSIGN_FOR_COMBO — substitute() called on a CLASS_COMBO; use assignVehicle instead
  'NOT_A_COMBO',
  'INVALID_STATUS',
  'VEHICLE_UNAVAILABLE',
  'USE_ASSIGN_FOR_COMBO',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]
