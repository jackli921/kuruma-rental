import { describe, expect, it } from 'vitest'

import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'
import { computeClassStats, hasActiveBookings } from '@/modules/classes/stats'

function makeOverview(
  overrides: Partial<FleetVehicleOverviewData> & { id: string; classId: string | null },
): FleetVehicleOverviewData {
  return {
    id: overrides.id,
    classId: overrides.classId,
    name: overrides.name ?? overrides.id,
    description: null,
    photos: [],
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    make: null,
    model: null,
    year: null,
    color: null,
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    utilization: 0,
    bookingCountLast30Days: 0,
    currentBooking: null,
    nextBooking: null,
    activeMaintenanceReason: null,
    ...overrides,
  } as FleetVehicleOverviewData
}

describe('computeClassStats', () => {
  it('returns zero counts when no vehicles belong to the class', () => {
    const vehicles = [
      makeOverview({ id: 'v1', classId: null }),
      makeOverview({ id: 'v2', classId: 'other-class' }),
    ]
    expect(computeClassStats('c1', vehicles)).toEqual({ carsCount: 0, activeBookingsCount: 0 })
  })

  it('counts vehicles in the class', () => {
    const vehicles = [
      makeOverview({ id: 'v1', classId: 'c1' }),
      makeOverview({ id: 'v2', classId: 'c1' }),
      makeOverview({ id: 'v3', classId: 'other' }),
    ]
    expect(computeClassStats('c1', vehicles).carsCount).toBe(2)
  })

  it('counts only vehicles in the class that have a currentBooking as active', () => {
    const booking = { startAt: '', endAt: '', renterName: null }
    const vehicles = [
      makeOverview({ id: 'v1', classId: 'c1', currentBooking: booking }),
      makeOverview({ id: 'v2', classId: 'c1' }), // no current booking
      makeOverview({ id: 'v3', classId: 'other', currentBooking: booking }), // different class
    ]
    expect(computeClassStats('c1', vehicles).activeBookingsCount).toBe(1)
  })

  it('ignores retired vehicles in active-bookings count but still counts cars', () => {
    const booking = { startAt: '', endAt: '', renterName: null }
    const vehicles = [
      makeOverview({ id: 'v1', classId: 'c1', status: 'RETIRED', currentBooking: booking }),
      makeOverview({ id: 'v2', classId: 'c1', currentBooking: booking }),
    ]
    const stats = computeClassStats('c1', vehicles)
    expect(stats.carsCount).toBe(2)
    expect(stats.activeBookingsCount).toBe(1)
  })
})

describe('hasActiveBookings', () => {
  it('returns true when activeBookingsCount > 0', () => {
    expect(hasActiveBookings({ carsCount: 2, activeBookingsCount: 1 })).toBe(true)
  })
  it('returns false when activeBookingsCount is 0', () => {
    expect(hasActiveBookings({ carsCount: 5, activeBookingsCount: 0 })).toBe(false)
  })
})
