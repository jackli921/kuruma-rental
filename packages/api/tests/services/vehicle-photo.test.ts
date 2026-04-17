import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import { InMemoryPhotoStorage } from '../../src/repositories/in-memory/photo-storage'
import type { PhotoStorage } from '../../src/repositories/types'
import { VehiclePhotoService } from '../../src/services/vehicle-photo'
import type { Vehicle } from '../../src/stores'

function vehicleInput(overrides?: Partial<Vehicle>) {
  return {
    name: 'Test',
    description: null,
    photos: [] as string[],
    seats: 4,
    transmission: 'AUTO' as const,
    fuelType: 'GASOLINE',
    licensePlate: null,
    status: 'AVAILABLE' as const,
    bufferMinutes: 60,
    minRentalHours: 1,
    maxRentalHours: 168,
    advanceBookingHours: 24,
    classId: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 5000,
    hourlyRateJpy: 1000,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
    ...overrides,
  }
}

describe('VehiclePhotoService.deleteByUrl', () => {
  let repo: InMemoryVehicleRepository
  let storage: InMemoryPhotoStorage
  let service: VehiclePhotoService
  let vehicleId: string

  beforeEach(async () => {
    repo = new InMemoryVehicleRepository()
    storage = new InMemoryPhotoStorage()
    service = new VehiclePhotoService(repo, storage)
    const v = await repo.create(vehicleInput({ photos: ['a.jpg', 'b.jpg'] }))
    vehicleId = v.id
  })

  it('returns 400 when url query param is empty', async () => {
    const result = await service.deleteByUrl(vehicleId, '')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(400)
    expect(result.error).toBe('url query parameter required')
  })

  it('returns 404 when url is not in vehicle.photos', async () => {
    const result = await service.deleteByUrl(vehicleId, 'not-here.jpg')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(404)
    expect(result.error).toBe('Photo not found')
  })

  it('removes the url and returns remaining count', async () => {
    const result = await service.deleteByUrl(vehicleId, 'a.jpg')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.deletedUrl).toBe('a.jpg')
    expect(result.remaining).toBe(1)

    const after = await repo.findById(vehicleId)
    expect(after?.photos).toEqual(['b.jpg'])
  })

  it('uses injected logger when storage cleanup fails', async () => {
    const warnings: unknown[][] = []
    const logger = {
      warn: (...args: unknown[]) => {
        warnings.push(args)
      },
    }
    const failingStorage: PhotoStorage = {
      put: storage.put.bind(storage),
      delete: async () => {
        throw new Error('R2 down')
      },
    }
    const svc = new VehiclePhotoService(repo, failingStorage, logger)

    const result = await svc.deleteByUrl(vehicleId, 'a.jpg')

    expect(result.ok).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.[0]).toMatch(/cleanup failed/i)
  })
})
