// Vehicle detail DTO — enriches a Vehicle with booking, revenue, and
// utilization data for the owner-facing /manage/vehicles/[id] page.
// Computed per-request by the repository. See issue #53.

import type { MaintenanceLogSummary } from './maintenance-log'

export interface VehicleDetailBooking {
  id: string
  startAt: Date
  endAt: Date
  renterName: string | null
  source: 'DIRECT' | 'TRIP_COM' | 'MANUAL' | 'OTHER'
  status: 'CONFIRMED' | 'ACTIVE'
}

export interface DailyUtilization {
  date: string // YYYY-MM-DD
  bookedHours: number
}

export interface VehicleDetail {
  id: string
  name: string
  description: string | null
  photos: string[]
  seats: number
  transmission: 'AUTO' | 'MANUAL'
  fuelType: string | null
  licensePlate: string | null
  status: 'AVAILABLE' | 'MAINTENANCE' | 'RETIRED'
  bufferMinutes: number
  minRentalHours: number | null
  maxRentalHours: number | null
  advanceBookingHours: number | null
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
  shakenExpiryDate: string | null
  insuranceExpiryDate: string | null
  createdAt: Date
  updatedAt: Date

  // Issue #225: full maintenance history for the vehicle.
  maintenanceLogs: MaintenanceLogSummary[]

  upcomingBookings: VehicleDetailBooking[]
  revenueLast7d: number
  revenueLast30d: number
  revenueAllTime: number
  utilizationLast30Days: DailyUtilization[]
}
