import type { BookingStatus } from '../enums'

/**
 * One booking row in a #1102 "today" dispatch bucket. Minimal by design — the
 * panel resolves the vehicle *name* from the already-loaded fleet query via
 * `vehicleId`, so only the renter name is joined server-side. Dates are ISO 8601
 * strings (JSON has no Date). `renterName` is null for a walk-in.
 */
export interface TodayBookingRow {
  id: string
  bookingCode: string
  status: BookingStatus
  /** ISO 8601 (UTC). */
  startAt: string
  /** ISO 8601 (UTC). The contractual dropoff — NOT the turnaround-padded
   *  effectiveEndAt; overdue keys off this. */
  endAt: string
  /** The fulfilling car, or null for a class-only booking not yet assigned. */
  vehicleId: string | null
  renterName: string | null
}

/**
 * The #1102 daily-operations buckets, computed server-side (JST). Each is a
 * capped array (≤ `TODAY_BUCKET_CAP`) so the panel can render clickable rows;
 * the header count is the array length (they must agree — see acceptance).
 */
export interface TodayBuckets {
  /** CONFIRMED bookings whose pickup (startAt) is today (JST), soonest first. */
  pickups: TodayBookingRow[]
  /** ACTIVE bookings whose return (endAt) is today (JST), soonest first. */
  returns: TodayBookingRow[]
  /** ACTIVE bookings whose contractual endAt is already past, most-late first. */
  overdue: TodayBookingRow[]
}

/** Cap on each today-bucket array. A 40-50 car fleet never fills a bucket; the
 *  cap is a safety bound, with a "see all" deep-link to the filtered list. */
export const TODAY_BUCKET_CAP = 50

/**
 * Operator dashboard overview (#524). Tenant-scoped headline counts for the
 * operator landing screen — distinct from the platform-wide `DashboardStats`
 * (X-API-Key, all tenants). Every figure is scoped to the calling operator;
 * bypass roles (PLATFORM_ADMIN / legacy STAFF/ADMIN) see the platform aggregate.
 */
export interface OperatorOverview {
  /** Bookings for this operator, excluding CANCELLED (never-served rows). */
  totalBookings: number
  /** Vehicles owned by this operator with status='AVAILABLE'. */
  activeVehicles: number
  /** CONFIRMED/ACTIVE bookings whose pickup (startAt) is still in the future. */
  upcomingBookings: number
  /** #1102 daily dispatch board: today's pickups / returns / overdue. */
  today: TodayBuckets
}
