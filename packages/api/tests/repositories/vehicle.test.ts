import { describe, expect, it } from 'vitest'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'

const vehicleData = {
  name: 'Test Car',
  description: 'A test vehicle',
  photos: ['photo.jpg'],
  seats: 5,
  transmission: 'AUTO' as const,
  fuelType: 'Gasoline',
  status: 'AVAILABLE' as const,
  bufferMinutes: 60,
  minRentalHours: null,
  maxRentalHours: null,
  advanceBookingHours: null,
  dailyRateJpy: 10000,
  hourlyRateJpy: null,
}

describe('VehicleRepository.findByIds', () => {
  it('returns vehicles matching the given IDs', async () => {
    const repo = new InMemoryVehicleRepository()
    const v1 = await repo.create({ ...vehicleData, name: 'Car A' })
    const v2 = await repo.create({ ...vehicleData, name: 'Car B' })
    await repo.create({ ...vehicleData, name: 'Car C' })

    const result = await repo.findByIds([v1.id, v2.id])

    expect(result).toHaveLength(2)
    expect(result.map((v) => v.name).sort()).toEqual(['Car A', 'Car B'])
  })

  it('returns empty array for empty input', async () => {
    const repo = new InMemoryVehicleRepository()
    const result = await repo.findByIds([])
    expect(result).toEqual([])
  })

  it('skips IDs that do not exist', async () => {
    const repo = new InMemoryVehicleRepository()
    const v1 = await repo.create(vehicleData)

    const result = await repo.findByIds([v1.id, 'nonexistent-id'])

    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe(v1.id)
  })
})
