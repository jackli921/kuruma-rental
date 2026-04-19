import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import type { Vehicle } from '../../src/stores'

const staffCtx: CallerContext = SYSTEM_CONTEXT
const renterCtx: CallerContext = { userId: 'renter-1', role: 'RENTER' }

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
    await repo.create(staffCtx, vehicleInput({ name: 'Car A' }))
    await repo.create(staffCtx, vehicleInput({ name: 'Car B' }))
    await repo.create(staffCtx, vehicleInput({ name: 'Car C' }))
  })

  it('returns paginated data with total count', async () => {
    const result = await repo.findAll(staffCtx, { limit: 2, offset: 0 })

    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(3)
    expect(result.data[0]!.name).toBe('Car A')
    expect(result.data[1]!.name).toBe('Car B')
  })

  it('returns correct page with offset', async () => {
    const result = await repo.findAll(staffCtx, { limit: 2, offset: 2 })

    expect(result.data).toHaveLength(1)
    expect(result.data[0]!.name).toBe('Car C')
    expect(result.total).toBe(3)
  })

  it('returns all items when no limit/offset given', async () => {
    const result = await repo.findAll(staffCtx)

    expect(result.data).toHaveLength(3)
    expect(result.total).toBe(3)
  })

  it('applies status filter before pagination', async () => {
    // Retire Car B
    const all = await repo.findAll(staffCtx)
    await repo.softDelete(staffCtx, all.data[1]!.id)

    const result = await repo.findAll(staffCtx, { status: 'RETIRED', limit: 10, offset: 0 })

    expect(result.data).toHaveLength(1)
    expect(result.data[0]!.name).toBe('Car B')
    expect(result.total).toBe(1)
  })

  it('returns empty data when offset exceeds total', async () => {
    const result = await repo.findAll(staffCtx, { limit: 10, offset: 100 })

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
    const result = await repo.findByIds(staffCtx, [])
    expect(result).toEqual([])
  })

  it('returns matching vehicles for given IDs', async () => {
    const v1 = await repo.create(staffCtx, vehicleInput({ name: 'Car A' }))
    const v2 = await repo.create(staffCtx, vehicleInput({ name: 'Car B' }))
    await repo.create(staffCtx, vehicleInput({ name: 'Car C' }))

    const result = await repo.findByIds(staffCtx, [v1.id, v2.id])

    expect(result).toHaveLength(2)
    const names = result.map((v) => v.name).sort()
    expect(names).toEqual(['Car A', 'Car B'])
  })

  it('skips IDs that do not exist', async () => {
    const v1 = await repo.create(staffCtx, vehicleInput({ name: 'Car A' }))

    const result = await repo.findByIds(staffCtx, [v1.id, 'nonexistent-id'])

    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Car A')
  })
})

// Issue #329: defence in depth — VehicleRepository mutations must reject
// non-STAFF callers even if a route forgets the STAFF_ROLES gate. Read
// paths stay unrestricted so the public renter catalog can pass
// SYSTEM_CONTEXT for aggregate queries.
describe('VehicleRepository CallerContext enforcement', () => {
  let repo: InMemoryVehicleRepository
  let vehicle: Vehicle

  beforeEach(async () => {
    repo = new InMemoryVehicleRepository()
    vehicle = await repo.create(staffCtx, vehicleInput({ name: 'Guarded' }))
  })

  it('allows staff to create', async () => {
    const created = await repo.create(staffCtx, vehicleInput({ name: 'OK' }))
    expect(created.name).toBe('OK')
  })

  it('rejects renter calling create', async () => {
    await expect(repo.create(renterCtx, vehicleInput({ name: 'Blocked' }))).rejects.toThrow(
      /staff|forbidden/i,
    )
  })

  it('rejects renter calling update', async () => {
    await expect(repo.update(renterCtx, vehicle.id, { seats: 7 })).rejects.toThrow(
      /staff|forbidden/i,
    )
  })

  it('rejects renter calling softDelete', async () => {
    await expect(repo.softDelete(renterCtx, vehicle.id)).rejects.toThrow(/staff|forbidden/i)
  })

  it('rejects renter calling bulkUpdateStatus', async () => {
    await expect(repo.bulkUpdateStatus(renterCtx, [vehicle.id], 'MAINTENANCE')).rejects.toThrow(
      /staff|forbidden/i,
    )
  })

  it('rejects renter calling appendPhotos', async () => {
    await expect(
      repo.appendPhotos(renterCtx, vehicle.id, ['https://example.com/p.jpg'], 10),
    ).rejects.toThrow(/staff|forbidden/i)
  })

  it('rejects renter calling removePhotoByUrl', async () => {
    await expect(repo.removePhotoByUrl(renterCtx, vehicle.id, 'photo.jpg')).rejects.toThrow(
      /staff|forbidden/i,
    )
  })

  it('allows renter to read (findAll, findById, findByIds)', async () => {
    const all = await repo.findAll(renterCtx)
    expect(all.data.length).toBeGreaterThan(0)

    const byId = await repo.findById(renterCtx, vehicle.id)
    expect(byId?.id).toBe(vehicle.id)

    const byIds = await repo.findByIds(renterCtx, [vehicle.id])
    expect(byIds).toHaveLength(1)
  })
})
