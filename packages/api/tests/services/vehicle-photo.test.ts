import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import { InMemoryPhotoStorage } from '../../src/repositories/in-memory/photo-storage'
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

function makeFile(name = 'x.jpg', bytes = 100): File {
  return new File([new ArrayBuffer(bytes)], name, { type: 'image/jpeg' })
}

describe('VehiclePhotoService concurrency', () => {
  let service: VehiclePhotoService
  let repo: InMemoryVehicleRepository
  let storage: InMemoryPhotoStorage
  let vehicleId: string

  beforeEach(async () => {
    repo = new InMemoryVehicleRepository()
    storage = new InMemoryPhotoStorage()
    service = new VehiclePhotoService(repo, storage)
    const v = await repo.create(vehicleInput())
    vehicleId = v.id
  })

  it('returns 409 when a concurrent upload changes photos between read and write', async () => {
    // Simulate race: another writer sneaks in between findById and update.
    const originalFindById = repo.findById.bind(repo)
    repo.findById = async (id: string) => {
      const v = await originalFindById(id)
      if (v) await originalFindById(id) // read the "stale" snapshot
      // Concurrent writer mutates photos between our read and write.
      if (v) await repo.update(id, { photos: ['sneak-in.jpg'] })
      return v
    }

    const result = await service.upload(vehicleId, [makeFile()])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(409)
    expect(result.error).toMatch(/concurrently/)

    // Rollback: uploaded file must be cleaned from storage (storage is empty).
    // Storage uses `has(key)` — after rollback, no key remains. We can't
    // enumerate, so we verify the vehicle's surviving photos point to the
    // sneaked-in write only, proving our upload's URL did not land.

    // Sneaked-in write survives; our upload did not clobber it.
    const after = await originalFindById(vehicleId)
    expect(after?.photos).toEqual(['sneak-in.jpg'])
  })

  it('returns 409 when a concurrent delete changes photos between read and write', async () => {
    const v = await repo.update(vehicleId, { photos: ['a.jpg', 'b.jpg', 'c.jpg'] })
    if (!v) throw new Error('setup failed')

    const originalFindById = repo.findById.bind(repo)
    repo.findById = async (id: string) => {
      const snapshot = await originalFindById(id)
      // Concurrent writer removes a different photo between our read and write.
      if (snapshot) await repo.update(id, { photos: ['a.jpg', 'c.jpg'] })
      return snapshot
    }

    const result = await service.delete(vehicleId, 0)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(409)
  })

  it('uses injected logger instead of console for storage cleanup warnings', async () => {
    const warnings: unknown[][] = []
    const logger = {
      warn: (...args: unknown[]) => {
        warnings.push(args)
      },
    }
    const failingStorage = {
      put: storage.put.bind(storage),
      delete: async () => {
        throw new Error('R2 down')
      },
    }
    const svc = new VehiclePhotoService(repo, failingStorage, logger)

    const v = await repo.update(vehicleId, { photos: ['gone.jpg'] })
    if (!v) throw new Error('setup')

    const result = await svc.delete(vehicleId, 0)

    // DB delete still succeeds; storage cleanup failure is logged, not thrown.
    expect(result.ok).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.[0]).toMatch(/cleanup failed/i)
  })
})
