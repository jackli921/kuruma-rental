import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'
import type { VehicleClassData } from '@/modules/classes'
import { groupVehiclesByClass } from '@/modules/vehicles/grouping'
import { describe, expect, it } from 'vitest'

function makeClass(overrides: Partial<VehicleClassData> = {}): VehicleClassData {
  return {
    id: 'class-1',
    name: 'Compact',
    slug: 'compact',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO',
    fuelType: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    sortOrder: 0,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeVehicle(overrides: Partial<FleetVehicleOverviewData> = {}): FleetVehicleOverviewData {
  return {
    id: 'v-1',
    name: 'Corolla',
    description: null,
    make: 'Toyota',
    model: 'Corolla',
    year: 2022,
    color: 'White',
    seats: 5,
    transmission: 'AUTO',
    fuelType: 'Gasoline',
    licensePlate: '1234',
    bufferMinutes: 60,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    minRentalHours: 4,
    maxRentalHours: 72,
    advanceBookingHours: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    status: 'AVAILABLE',
    classId: null,
    photos: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    utilization: 0,
    bookingCountLast30Days: 0,
    currentBooking: null,
    nextBooking: null,
    activeMaintenanceReason: null,
    ...overrides,
  }
}

describe('groupVehiclesByClass', () => {
  it('returns empty array when there are no vehicles', () => {
    const result = groupVehiclesByClass([], [])
    expect(result).toEqual([])
  })

  it('groups vehicles under their assigned class', () => {
    const compact = makeClass({ id: 'c1', name: 'Compact', sortOrder: 0 })
    const suv = makeClass({ id: 'c2', name: 'SUV', sortOrder: 1 })
    const v1 = makeVehicle({ id: 'v1', classId: 'c1' })
    const v2 = makeVehicle({ id: 'v2', classId: 'c2' })
    const v3 = makeVehicle({ id: 'v3', classId: 'c1' })

    const result = groupVehiclesByClass([v1, v2, v3], [compact, suv])

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      classId: 'c1',
      className: 'Compact',
      vehicles: [v1, v3],
    })
    expect(result[1]).toMatchObject({
      classId: 'c2',
      className: 'SUV',
      vehicles: [v2],
    })
  })

  it('places vehicles with null classId into an Unassigned group at the end', () => {
    const compact = makeClass({ id: 'c1', name: 'Compact', sortOrder: 0 })
    const v1 = makeVehicle({ id: 'v1', classId: 'c1' })
    const v2 = makeVehicle({ id: 'v2', classId: null })

    const result = groupVehiclesByClass([v1, v2], [compact])

    expect(result).toHaveLength(2)
    expect(result[0]?.classId).toBe('c1')
    expect(result[1]).toMatchObject({
      classId: null,
      vehicles: [v2],
    })
  })

  it('places vehicles whose classId does not match any class into Unassigned', () => {
    const compact = makeClass({ id: 'c1', name: 'Compact' })
    const orphan = makeVehicle({ id: 'v1', classId: 'deleted-class-id' })

    const result = groupVehiclesByClass([orphan], [compact])

    expect(result).toHaveLength(1)
    expect(result[0]?.classId).toBeNull()
    expect(result[0]?.vehicles).toEqual([orphan])
  })

  it('preserves class sortOrder ordering', () => {
    const b = makeClass({ id: 'cb', name: 'B', sortOrder: 2 })
    const a = makeClass({ id: 'ca', name: 'A', sortOrder: 0 })
    const c = makeClass({ id: 'cc', name: 'C', sortOrder: 1 })
    const va = makeVehicle({ id: 'v1', classId: 'ca' })
    const vb = makeVehicle({ id: 'v2', classId: 'cb' })
    const vc = makeVehicle({ id: 'v3', classId: 'cc' })

    const result = groupVehiclesByClass([vb, va, vc], [b, a, c])

    expect(result.map((g) => g.className)).toEqual(['A', 'C', 'B'])
  })

  it('omits empty groups for classes with no vehicles', () => {
    const compact = makeClass({ id: 'c1', name: 'Compact' })
    const suv = makeClass({ id: 'c2', name: 'SUV' })
    const v1 = makeVehicle({ id: 'v1', classId: 'c1' })

    const result = groupVehiclesByClass([v1], [compact, suv])

    expect(result).toHaveLength(1)
    expect(result[0]?.classId).toBe('c1')
  })
})
