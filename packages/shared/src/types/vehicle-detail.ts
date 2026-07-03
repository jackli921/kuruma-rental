// Vehicle detail DTO — enriches a Vehicle with booking, revenue, and
// utilization data for the owner-facing /manage/vehicles/[id] page.
// Computed per-request by the repository. See issue #53.

import type { BookingSource, BookingStatus } from '../enums'
import type { MaintenanceLogSummary } from './maintenance-log'
import type { VehicleBase } from './vehicle'

export interface VehicleDetailBooking {
  id: string
  startAt: Date
  endAt: Date
  renterName: string | null
  source: BookingSource
  // Deliberate subset of BookingStatus: only in-flight bookings surface as "upcoming".
  status: Extract<BookingStatus, 'CONFIRMED' | 'ACTIVE'>
}

export interface DailyUtilization {
  date: string // YYYY-MM-DD
  bookedHours: number
}

export interface VehicleDetail extends VehicleBase {
  // Issue #225: full maintenance history for the vehicle.
  maintenanceLogs: MaintenanceLogSummary[]

  upcomingBookings: VehicleDetailBooking[]
  revenueLast7d: number
  revenueLast30d: number
  revenueAllTime: number
  utilizationLast30Days: DailyUtilization[]
}
