/**
 * Cross-operator oversight filters for the platform-admin booking surface
 * (#1092). Extracted from the `types.ts` barrel to keep it under the file-size
 * cap (mirrors the consent/payment/review split); re-exported from there.
 *
 * UNSCOPED by design — there is no CallerContext here: `findForAdmin` reads
 * across every tenant, so `AdminBookingService` is the authz chokepoint (it
 * calls `requirePlatformAdmin` BEFORE this method, mirroring how
 * `paymentEvents.listSucceeded` backs the platform-only revenue report).
 *
 * `renterIds` is a pre-resolved customer filter (the service maps a name/email
 * search to renter ids via UserRepository, never the repo). `bookingCode` is a
 * case-insensitive substring match. An empty `renterIds`/`status` is "match
 * nothing" — the service supplies an absent (not empty) filter to mean "any".
 */
export interface AdminBookingFilters {
  operatorId?: string
  bookingCode?: string
  status?: string
  renterIds?: string[]
  from?: Date
  to?: Date
  limit?: number
  cursor?: string
}
