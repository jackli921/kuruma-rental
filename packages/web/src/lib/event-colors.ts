// Booking status union, mirrored from @kuruma/shared's bookingStatusEnum. Kept
// as a local literal (like vite/operator-bookings/api.ts) so this web helper
// stays free of a runtime dependency on the Drizzle schema module.
type BookingStatus = 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'

export const STATUS_CLASS: Record<BookingStatus, string> = {
  CONFIRMED: 'rbc-event--confirmed',
  ACTIVE: 'rbc-event--active',
  COMPLETED: 'rbc-event--completed',
  CANCELLED: 'rbc-event--cancelled',
}
