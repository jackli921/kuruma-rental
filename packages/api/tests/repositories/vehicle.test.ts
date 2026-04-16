import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import type { Vehicle } from '../../src/stores'

function vehicleInput(overrides?: Partial<Vehicle>) {
  return {
    name: 'Test Car',
    description: 'A test vehicle',
    photos: ['photo.jpg'],
    seats: 4,
    transmission: 'AUTOMATIC' as const,
    fuelType: 'GASOLINE' as const,
    licensePlate: null,
    status: 'ACTIVE' as const,
    bufferMinutes: 60,
    minRentalHours: 1,
    maxRentalHours: 168,
    advanceBookingHours: 24,
    dailyRateJpy: 5000,
    hourlyRateJpy: 1000,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    ...overrides,
  }
}

describe('VehicleRepository.findAll pagination', () => {
  let repo: InMemoryVehicleRepository

  beforeEach(async () => {
    repo = new InMemoryVehicleRepository()
    await repo.create(vehicleInput({ name: 'Car A' }))
    await repo.create(vehicleInput({ name: 'Car B' }))
    await repo.create(vehicleInput({ name: 'Car C' }))
  })

  it('returns paginated data with total count', async () => {
    const result = await repo.findAll({ limit: 2, offset: 0 })

    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(3)
    expect(result.data[0]!.name).toBe('Car A')
    expect(result.data[1]!.name).toBe('Car B')
  })

  it('returns correct page with offset', async () => {
    const result = await repo.findAll({ limit: 2, offset: 2 })

    expect(result.data).toHaveLength(1)
    expect(result.data[0]!.name).toBe('Car C')
    expect(result.total).toBe(3)
  })

  it('returns all items when no limit/offset given', async () => {
    const result = await repo.findAll()

    expect(result.data).toHaveLength(3)
    expect(result.total).toBe(3)
  })

  it('applies status filter before pagination', async () => {
    // Retire Car B
    const all = await repo.findAll()
    await repo.softDelete(all.data[1]!.id)

    const result = await repo.findAll({ status: 'RETIRED', limit: 10, offset: 0 })

    expect(result.data).toHaveLength(1)
    expect(result.data[0]!.name).toBe('Car B')
    expect(result.total).toBe(1)
  })

  it('returns empty data when offset exceeds total', async () => {
    const result = await repo.findAll({ limit: 10, offset: 100 })

    expect(result.data).toHaveLength(0)
    expect(result.total).toBe(3)
  })
})

describe('VehicleRepository.findByIds', () => {
  let repo: InMemoryVehicleRepository

  beforeEach(() => {
    repo = new InMemoryVehicleRepository()
  })

  it('returns empty array for empty input', async () => {
    const result = await repo.findByIds([])
    expect(result).toEqual([])
  })

  it('returns matching vehicles for given IDs', async () => {
    const v1 = await repo.create(vehicleInput({ name: 'Car A' }))
    const v2 = await repo.create(vehicleInput({ name: 'Car B' }))
    await repo.create(vehicleInput({ name: 'Car C' }))

    const result = await repo.findByIds([v1.id, v2.id])

    expect(result).toHaveLength(2)
    const names = result.map((v) => v.name).sort()
    expect(names).toEqual(['Car A', 'Car B'])
  })

  it('skips IDs that do not exist', async () => {
    const v1 = await repo.create(vehicleInput({ name: 'Car A' }))

    const result = await repo.findByIds([v1.id, 'nonexistent-id'])

    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Car A')
  })
})
