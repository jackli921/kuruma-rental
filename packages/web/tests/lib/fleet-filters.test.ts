import { filterVehicles, sortVehicles } from '@/lib/fleet-filters'
import type { VehicleData } from '@/lib/vehicle-api'
import { describe, expect, it } from 'vitest'

function makeVehicle(overrides: Partial<VehicleData> = {}): VehicleData {
  return {
    id: crypto.randomUUID(),
    name: 'Toyota Prius',
    description: null,
    photos: [],
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('filterVehicles', () => {
  describe('name search', () => {
    it('matches substring case-insensitively for English names', () => {
      const vehicles = [
        makeVehicle({ name: 'Toyota Prius' }),
        makeVehicle({ name: 'Honda Civic' }),
        makeVehicle({ name: 'Nissan Leaf' }),
      ]

      const result = filterVehicles(vehicles, { search: 'toyota' })

      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('Toyota Prius')
    })

    it('matches substring in Japanese names', () => {
      const vehicles = [
        makeVehicle({ name: 'トヨタ プリウス' }),
        makeVehicle({ name: 'ホンダ シビック' }),
        makeVehicle({ name: '日産 リーフ' }),
      ]

      const result = filterVehicles(vehicles, { search: 'トヨタ' })

      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('トヨタ プリウス')
    })

    it('matches substring in Chinese names', () => {
      const vehicles = [
        makeVehicle({ name: '丰田普锐斯' }),
        makeVehicle({ name: '本田思域' }),
        makeVehicle({ name: '日产聆风' }),
      ]

      const result = filterVehicles(vehicles, { search: '丰田' })

      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('丰田普锐斯')
    })

    it('returns all vehicles when search is empty', () => {
      const vehicles = [makeVehicle({ name: 'Toyota Prius' }), makeVehicle({ name: 'Honda Civic' })]

      const result = filterVehicles(vehicles, { search: '' })

      expect(result).toHaveLength(2)
    })
  })

  describe('status filter', () => {
    it('returns only vehicles matching the allowed statuses', () => {
      const vehicles = [
        makeVehicle({ name: 'A', status: 'AVAILABLE' }),
        makeVehicle({ name: 'B', status: 'MAINTENANCE' }),
        makeVehicle({ name: 'C', status: 'RETIRED' }),
      ]

      const result = filterVehicles(vehicles, {
        statuses: ['AVAILABLE', 'MAINTENANCE'],
      })

      expect(result.map((v) => v.status).sort()).toEqual(['AVAILABLE', 'MAINTENANCE'])
    })

    it('returns all vehicles when statuses filter is empty', () => {
      const vehicles = [makeVehicle({ status: 'AVAILABLE' }), makeVehicle({ status: 'RETIRED' })]

      const result = filterVehicles(vehicles, { statuses: [] })

      expect(result).toHaveLength(2)
    })
  })

  describe('transmission filter', () => {
    it('filters by allowed transmissions', () => {
      const vehicles = [
        makeVehicle({ name: 'A', transmission: 'AUTO' }),
        makeVehicle({ name: 'B', transmission: 'MANUAL' }),
        makeVehicle({ name: 'C', transmission: 'AUTO' }),
      ]

      const result = filterVehicles(vehicles, { transmissions: ['AUTO'] })

      expect(result).toHaveLength(2)
      expect(result.every((v) => v.transmission === 'AUTO')).toBe(true)
    })
  })

  describe('seats range filter', () => {
    it('returns only vehicles within the seats range (inclusive)', () => {
      const vehicles = [
        makeVehicle({ name: 'Kei', seats: 4 }),
        makeVehicle({ name: 'Sedan', seats: 5 }),
        makeVehicle({ name: 'Van', seats: 8 }),
      ]

      const result = filterVehicles(vehicles, { seatsMin: 5, seatsMax: 7 })

      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('Sedan')
    })
  })

  describe('combined filters', () => {
    it('applies AND logic across all filter dimensions', () => {
      const vehicles = [
        makeVehicle({ name: 'Toyota Prius', transmission: 'AUTO', seats: 5, status: 'AVAILABLE' }),
        makeVehicle({ name: 'Toyota Hiace', transmission: 'AUTO', seats: 8, status: 'AVAILABLE' }),
        makeVehicle({ name: 'Toyota MR2', transmission: 'MANUAL', seats: 2, status: 'AVAILABLE' }),
        makeVehicle({ name: 'Honda Civic', transmission: 'AUTO', seats: 5, status: 'MAINTENANCE' }),
      ]

      const result = filterVehicles(vehicles, {
        search: 'toyota',
        statuses: ['AVAILABLE'],
        transmissions: ['AUTO'],
        seatsMin: 4,
        seatsMax: 6,
      })

      expect(result).toHaveLength(1)
      expect(result[0]?.name).toBe('Toyota Prius')
    })
  })
})

describe('sortVehicles', () => {
  it('sorts by name ascending with locale-aware comparison', () => {
    const vehicles = [
      makeVehicle({ name: 'Toyota Prius' }),
      makeVehicle({ name: 'Honda Civic' }),
      makeVehicle({ name: 'Nissan Leaf' }),
    ]

    const result = sortVehicles(vehicles, 'name-asc')

    expect(result.map((v) => v.name)).toEqual(['Honda Civic', 'Nissan Leaf', 'Toyota Prius'])
  })

  it('sorts by name descending', () => {
    const vehicles = [makeVehicle({ name: 'Honda Civic' }), makeVehicle({ name: 'Toyota Prius' })]

    const result = sortVehicles(vehicles, 'name-desc')

    expect(result.map((v) => v.name)).toEqual(['Toyota Prius', 'Honda Civic'])
  })

  it('sorts by seats ascending', () => {
    const vehicles = [
      makeVehicle({ name: 'Van', seats: 8 }),
      makeVehicle({ name: 'Kei', seats: 4 }),
      makeVehicle({ name: 'Sedan', seats: 5 }),
    ]

    const result = sortVehicles(vehicles, 'seats-asc')

    expect(result.map((v) => v.seats)).toEqual([4, 5, 8])
  })

  it('sorts by seats descending', () => {
    const vehicles = [
      makeVehicle({ name: 'Kei', seats: 4 }),
      makeVehicle({ name: 'Van', seats: 8 }),
    ]

    const result = sortVehicles(vehicles, 'seats-desc')

    expect(result.map((v) => v.seats)).toEqual([8, 4])
  })

  it('does not mutate the input array', () => {
    const vehicles = [makeVehicle({ name: 'B' }), makeVehicle({ name: 'A' })]
    const originalOrder = vehicles.map((v) => v.name)

    sortVehicles(vehicles, 'name-asc')

    expect(vehicles.map((v) => v.name)).toEqual(originalOrder)
  })

  // Utilization + price sort orders were added for the owner-facing
  // fleet overview list (#52). They operate on FleetVehicleOverviewData
  // (utilization) or on VehicleData's pricing columns (price).
  it('sorts by utilization descending, treating missing utilization as 0', () => {
    const a = { ...makeVehicle({ name: 'A' }), utilization: 10 }
    const b = { ...makeVehicle({ name: 'B' }), utilization: 72 }
    const c = { ...makeVehicle({ name: 'C' }), utilization: 42 }

    const result = sortVehicles([a, b, c], 'utilization-desc')

    expect(result.map((v) => v.name)).toEqual(['B', 'C', 'A'])
  })

  it('sorts by price ascending, using dailyRateJpy when present', () => {
    const a = makeVehicle({ name: 'Cheap', dailyRateJpy: 5000 })
    const b = makeVehicle({ name: 'Expensive', dailyRateJpy: 12000 })
    const c = makeVehicle({ name: 'Mid', dailyRateJpy: 8000 })

    const result = sortVehicles([a, b, c], 'price-asc')

    expect(result.map((v) => v.name)).toEqual(['Cheap', 'Mid', 'Expensive'])
  })

  it('sorts by price descending', () => {
    const a = makeVehicle({ name: 'Cheap', dailyRateJpy: 5000 })
    const b = makeVehicle({ name: 'Expensive', dailyRateJpy: 12000 })

    const result = sortVehicles([a, b], 'price-desc')

    expect(result.map((v) => v.name)).toEqual(['Expensive', 'Cheap'])
  })

  it('falls back to hourlyRateJpy for price sorting when dailyRateJpy is null', () => {
    const a = makeVehicle({ name: 'HourlyOnly', dailyRateJpy: null, hourlyRateJpy: 1500 })
    const b = makeVehicle({ name: 'BothSet', dailyRateJpy: 6000, hourlyRateJpy: 800 })

    const result = sortVehicles([a, b], 'price-asc')

    // BothSet uses 6000 (daily), HourlyOnly uses 1500 (hourly) — so HourlyOnly first.
    expect(result.map((v) => v.name)).toEqual(['HourlyOnly', 'BothSet'])
  })
})
