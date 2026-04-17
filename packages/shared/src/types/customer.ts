// Customer = aggregated view of a user who has booked at least once. Read-only
// surface for the /manage/customers owner workflow. Computed per-request; not
// denormalized. See issue #43.

export interface Customer {
  id: string
  name: string | null
  // null for phone-only walk-in customers created via /customers/quick-create
  email: string | null
  language: string
  country: string | null
  bookingCount: number
  lastBookingAt: string // ISO timestamp — most recent booking.startAt
  totalSpent: number // JPY; sum of booking.totalPrice where status = 'COMPLETED'
}

export interface CustomerBookingSummary {
  id: string
  vehicleId: string
  vehicleName: string | null
  startAt: string
  endAt: string
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  totalPrice: number | null
}

export interface CustomerWithBookings extends Customer {
  bookings: CustomerBookingSummary[]
}

export type CustomerSort = 'lastBookingAt' | 'bookingCount' | 'name'
