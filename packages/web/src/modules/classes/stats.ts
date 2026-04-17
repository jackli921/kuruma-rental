import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'

export interface ClassStats {
  carsCount: number
  activeBookingsCount: number
}

/**
 * Derive per-class stats from the fleet overview data that the owner page
 * already fetches. Keeps us from adding a new API endpoint: the relationship
 * is `vehicles.classId -> vehicle_classes.id`, and `currentBooking` is the
 * fleet-overview signal for "an active/ongoing booking right now".
 *
 * A RETIRED vehicle with a stale currentBooking is excluded from the
 * active-bookings count — we only want live rentals on active fleet cars.
 */
export function computeClassStats(
  classId: string,
  vehicles: readonly FleetVehicleOverviewData[],
): ClassStats {
  const inClass = vehicles.filter((v) => v.classId === classId)
  const carsCount = inClass.length
  const activeBookingsCount = inClass.filter(
    (v) => v.currentBooking != null && v.status !== 'RETIRED',
  ).length
  return { carsCount, activeBookingsCount }
}

export function hasActiveBookings(stats: ClassStats): boolean {
  return stats.activeBookingsCount > 0
}
