/**
 * Per-operator metrics & compliance roll-up (#1120) for the platform-owner
 * operators page. Composed by OperatorSummaryService from existing repos — it has
 * no schema of its own. PLATFORM_ADMIN-only; one operator at a time.
 */
export interface OperatorComplianceSummary {
  readonly operatorId: string
  readonly name: string
  /** Live (non-RETIRED) vehicles owned by this operator. */
  readonly vehicleCount: number
  /** Vehicles with a missing or already-expired shaken/insurance certificate — needs action now. */
  readonly vehiclesNeedingDocs: number
  /** Vehicles still in-date but with shaken/insurance expiring within EXPIRY_SOON_DAYS. */
  readonly vehiclesExpiringSoon: number
  /** Bookings for this operator, excluding CANCELLED (never-served rows). */
  readonly totalBookings: number
  /** CONFIRMED/ACTIVE bookings whose pickup (startAt) is still in the future. */
  readonly upcomingBookings: number
  /** ISO timestamp of the most recent compliance alert sent for this operator, or null. */
  readonly lastComplianceAlertAt: string | null
}

/**
 * Vehicle-side roll-up over an operator's live (non-RETIRED) fleet, classified by
 * the single compliance seam (`computeExpiryStatus`). The two attention buckets
 * are mutually exclusive — a vehicle with a missing/expired certificate is counted
 * in `needingDocs` only, never also in `expiringSoon`.
 */
export interface VehicleComplianceCounts {
  total: number
  needingDocs: number
  expiringSoon: number
}

/** Booking-side roll-up for one operator, mirroring the operator-overview semantics. */
export interface OperatorBookingCounts {
  /** Bookings for the operator, excluding CANCELLED. */
  total: number
  /** CONFIRMED/ACTIVE bookings whose pickup (startAt) is still in the future. */
  upcoming: number
}
