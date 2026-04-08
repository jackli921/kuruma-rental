import { describe, it, expect, afterEach } from 'vitest'
import { DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import { db, cleanupVehicles } from './setup'

const repo = new DrizzleVehicleRepository(db)
const createdIds: string[] = []

afterEach(async () => {
  await cleanupVehicles(createdIds)
  createdIds.length = 0
})

describe('DrizzleVehicleRepository', () => {
  it('create inserts and returns a vehicle with correct fields', async () => {
    const input = {
      name: 'Test Corolla',
      description: 'A test vehicle',
      seats: 5,
      transmission: 'AUTO' as const,
      fuelType: 'Gasoline',
      status: 'AVAILABLE' as const,
      bufferMinutes: 30,
      minRentalHours: 4,
      maxRentalHours: 72,
      advanceBookingHours: 24,
    }

    const vehicle = await repo.create(input)
    createdIds.push(vehicle.id)

    expect(vehicle.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(vehicle.name).toBe('Test Corolla')
    expect(vehicle.description).toBe('A test vehicle')
    expect(vehicle.seats).toBe(5)
    expect(vehicle.transmission).toBe('AUTO')
    expect(vehicle.fuelType).toBe('Gasoline')
    expect(vehicle.status).toBe('AVAILABLE')
    expect(vehicle.bufferMinutes).toBe(30)
    expect(vehicle.minRentalHours).toBe(4)
    expect(vehicle.maxRentalHours).toBe(72)
    expect(vehicle.advanceBookingHours).toBe(24)
    expect(vehicle.createdAt).toBeInstanceOf(Date)
    expect(vehicle.updatedAt).toBeInstanceOf(Date)
  })

  it('findById retrieves a created vehicle', async () => {
    const created = await repo.create({
      name: 'Findable Car',
      description: null,
      seats: 4,
      transmission: 'MANUAL',
      fuelType: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
    })
    createdIds.push(created.id)

    const found = await repo.findById(created.id)

    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
    expect(found!.name).toBe('Findable Car')
    expect(found!.description).toBeNull()
    expect(found!.seats).toBe(4)
    expect(found!.transmission).toBe('MANUAL')
    expect(found!.fuelType).toBeNull()
    expect(found!.status).toBe('AVAILABLE')
    expect(found!.bufferMinutes).toBe(60)
  })

  it('findById returns undefined for non-existent id', async () => {
    const found = await repo.findById('non-existent-id')
    expect(found).toBeUndefined()
  })

  it('findAll returns all vehicles and filters by status', async () => {
    const available = await repo.create({
      name: 'Available Car',
      description: null,
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
    })
    createdIds.push(available.id)

    const maintenance = await repo.create({
      name: 'Maintenance Car',
      description: null,
      seats: 4,
      transmission: 'MANUAL',
      fuelType: null,
      status: 'MAINTENANCE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
    })
    createdIds.push(maintenance.id)

    // findAll without filter should include both
    const all = await repo.findAll()
    const allIds = all.map((v) => v.id)
    expect(allIds).toContain(available.id)
    expect(allIds).toContain(maintenance.id)

    // findAll with status filter should only include matching
    const filtered = await repo.findAll({ status: 'MAINTENANCE' })
    const filteredIds = filtered.map((v) => v.id)
    expect(filteredIds).toContain(maintenance.id)
    expect(filteredIds).not.toContain(available.id)
  })

  it('update modifies specified fields and preserves others', async () => {
    const created = await repo.create({
      name: 'Original Name',
      description: 'Original desc',
      seats: 5,
      transmission: 'AUTO',
      fuelType: 'Gasoline',
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
    })
    createdIds.push(created.id)

    const updated = await repo.update(created.id, {
      name: 'Updated Name',
      seats: 7,
    })

    expect(updated).toBeDefined()
    expect(updated!.id).toBe(created.id)
    expect(updated!.name).toBe('Updated Name')
    expect(updated!.seats).toBe(7)
    // Preserved fields
    expect(updated!.description).toBe('Original desc')
    expect(updated!.transmission).toBe('AUTO')
    expect(updated!.fuelType).toBe('Gasoline')
    expect(updated!.status).toBe('AVAILABLE')
    expect(updated!.bufferMinutes).toBe(60)
    expect(updated!.createdAt).toBeInstanceOf(Date)
    expect(updated!.updatedAt).toBeInstanceOf(Date)
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.createdAt.getTime())
  })

  it('update returns undefined for non-existent id', async () => {
    const result = await repo.update('non-existent-id', { name: 'Nope' })
    expect(result).toBeUndefined()
  })

  it('softDelete sets status to RETIRED', async () => {
    const created = await repo.create({
      name: 'To Be Retired',
      description: null,
      seats: 4,
      transmission: 'AUTO',
      fuelType: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
    })
    createdIds.push(created.id)

    const retired = await repo.softDelete(created.id)

    expect(retired).toBeDefined()
    expect(retired!.id).toBe(created.id)
    expect(retired!.status).toBe('RETIRED')
    expect(retired!.name).toBe('To Be Retired')
    expect(retired!.updatedAt).toBeInstanceOf(Date)
    expect(retired!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.createdAt.getTime())

    // Verify persisted in DB
    const fromDb = await repo.findById(created.id)
    expect(fromDb!.status).toBe('RETIRED')
  })

  it('softDelete returns undefined for non-existent id', async () => {
    const result = await repo.softDelete('non-existent-id')
    expect(result).toBeUndefined()
  })
})
