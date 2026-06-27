import type { BookingStatus } from '../enums'

/**
 * Platform-admin cross-operator booking oversight (#1092, epic #1075 slice 6).
 *
 * The platform owner searches/inspects ANY booking across every operator. The
 * renter-facing booking DTO (`web/.../bookings/api.ts`) deliberately omits
 * `operatorId` and carries no operator/customer identity, so it cannot answer
 * "which operator owns this row and who booked it" — this admin projection adds
 * exactly that. Served ONLY by `GET /admin/bookings`, which is gated to
 * PLATFORM_ADMIN (the service re-asserts the gate); PARTNER is excluded (the
 * un-gated `GET /bookings` PARTNER exposure is tracked separately as #1119).
 *
 * This is the WIRE contract the API returns and the web consumes — web cannot
 * import the Drizzle schema, so the shape lives here. Dates are ISO 8601 strings
 * (JSON has no Date); amounts are whole JPY.
 */
export interface AdminBookingDto {
  id: string
  bookingCode: string
  status: BookingStatus
  /** Owning tenant + its display name, joined in for the oversight table. */
  operatorId: string
  operatorName: string
  /** The customer who booked. `renterName`/`renterEmail` may be null (walk-in). */
  renterId: string
  renterName: string | null
  renterEmail: string | null
  pickupLocationId: string
  dropoffLocationId: string
  /** ISO 8601 (UTC). */
  startAt: string
  endAt: string
  effectiveEndAt: string
  /** Whole JPY; null until priced/snapshotted. */
  totalPrice: number | null
  /** ISO 8601 (UTC). When the booking was created — the list sort key. */
  createdAt: string
}

/**
 * Response body of `GET /admin/bookings` (newest first, cursor-paginated).
 * `nextCursor` is the opaque `<createdAtIso>_<id>` handle for the next page, or
 * null when the last page has been reached.
 */
export interface AdminBookingsResponse {
  bookings: AdminBookingDto[]
  nextCursor: string | null
}
