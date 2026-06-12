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
}
