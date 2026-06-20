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
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]
