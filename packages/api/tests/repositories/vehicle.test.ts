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
    status: 'ACTIVE' as const,
    bufferMinutes: 60,
    minRentalHours: 1,
    maxRentalHours: 168,
    advanceBookingHours: 24,
    dailyRateJpy: 5000,
    hourlyRateJpy: 1000,
    ...overrides,
  }
}

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
