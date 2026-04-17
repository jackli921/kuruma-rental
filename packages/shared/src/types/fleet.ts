// Fleet overview DTO — enriches a Vehicle with the aggregated operational
// data the owner-facing /manage/vehicles list needs to answer "where is
// every car right now and which is making money" at a glance. Computed
// per-request by the repository; NOT denormalized into the vehicles
// table. See issue #52.

import type { VehicleBase } from './vehicle'

export interface FleetBookingSummary {
  startAt: Date
  endAt: Date
  renterName: string | null
}

export interface FleetVehicleOverview extends VehicleBase {
  // Utilization: fraction of hours booked in the last 30 days, expressed
  // as a percentage 0..100. CANCELLED bookings excluded. Buffer time is
  // NOT counted — only the renter-facing window (startAt..endAt).
  utilization: number

  // Number of non-CANCELLED bookings that touched the last 30 days.
  bookingCountLast30Days: number

  // The booking that is currently in progress, if `now` falls inside a
  // non-CANCELLED booking for this vehicle.
  currentBooking: FleetBookingSummary | null

  // The next non-CANCELLED booking whose startAt is in the future,
  // excluding any currentBooking.
  nextBooking: FleetBookingSummary | null

  // Issue #225: active maintenance reason (null when not in MAINTENANCE).
  activeMaintenanceReason: string | null
}
