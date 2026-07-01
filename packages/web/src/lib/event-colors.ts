import type { BookingStatus, VehicleBlockKind } from '@kuruma/shared/enums'

export const STATUS_CLASS: Record<BookingStatus, string> = {
  CONFIRMED: 'rbc-event--confirmed',
  ACTIVE: 'rbc-event--active',
  COMPLETED: 'rbc-event--completed',
  CANCELLED: 'rbc-event--cancelled',
}

// #1101: scheduled-block bands. Deliberately muted/neutral and visually distinct
// from the status palette above so a block never reads as a booking on the calendar.
export const BLOCK_KIND_CLASS: Record<VehicleBlockKind, string> = {
  MAINTENANCE: 'rbc-event--block-maintenance',
  OUT_OF_SERVICE: 'rbc-event--block-out-of-service',
  MANUAL: 'rbc-event--block-manual',
}

// Tailwind dot color per status, shared by the calendar sidebar swatch and the
// quick-view card dot. Tracks STATUS_CLASS / calendar-theme.css so a status's
// color homes change together.
export const STATUS_DOT: Record<BookingStatus, string> = {
  CONFIRMED: 'bg-blue-500',
  ACTIVE: 'bg-green-500',
  COMPLETED: 'bg-gray-400',
  CANCELLED: 'bg-red-500',
}
