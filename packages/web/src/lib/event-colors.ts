import type { CalendarBooking } from './calendar'

type BookingStatus = CalendarBooking['status']

export const STATUS_CLASS: Record<BookingStatus, string> = {
  CONFIRMED: 'rbc-event--confirmed',
  ACTIVE: 'rbc-event--active',
  COMPLETED: 'rbc-event--completed',
  CANCELLED: 'rbc-event--cancelled',
}
