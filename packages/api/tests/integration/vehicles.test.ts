import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { afterEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import { DEFAULT_DAILY_RATE_JPY, cleanupVehicles, db } from './setup'

const repo = new DrizzleVehicleRepository(db)
const createdIds: string[] = []

afterEach(async () => {
  await cleanupVehicles(createdIds)
  createdIds.length = 0
})

describe('DrizzleVehicleRepository', () => {
  it('create inserts and returns a vehicle with correct fields', async () => {
    const input = {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      name: 'Test Corolla',
      description: 'A test vehicle',
      seats: 5,
      transmission: 'AUTO' as const,
      fuelType: 'Gasoline',
      licensePlate: null,
      status: 'AVAILABLE' as const,
      minRentalHours: 4,
      maxRentalHours: 72,
      advanceBookingHours: 24,
      dailyRateJpy: 8000,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    }

    const vehicle = await repo.create(SYSTEM_CONTEXT, input)
    createdIds.push(vehicle.id)

    expect(vehicle.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(vehicle.name).toBe('Test Corolla')
    expect(vehicle.description).toBe('A test vehicle')
    expect(vehicle.seats).toBe(5)
    expect(vehicle.transmission).toBe('AUTO')
    expect(vehicle.fuelType).toBe('Gasoline')
    expect(vehicle.status).toBe('AVAILABLE')
    expect(vehicle.minRentalHours).toBe(4)
    expect(vehicle.maxRentalHours).toBe(72)
    expect(vehicle.advanceBookingHours).toBe(24)
    expect(vehicle.dailyRateJpy).toBe(8000)
    expect(vehicle.createdAt).toBeInstanceOf(Date)
    expect(vehicle.updatedAt).toBeInstanceOf(Date)
  })

  it('findById retrieves a created vehicle', async () => {
    const created = await repo.create(SYSTEM_CONTEXT, {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      name: 'Findable Car',
      description: null,
      seats: 4,
      transmission: 'MANUAL',
      fuelType: null,
      licensePlate: null,
      status: 'AVAILABLE',
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    })
    createdIds.push(created.id)

    const found = await repo.findById(SYSTEM_CONTEXT, created.id)

    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
    expect(found!.name).toBe('Findable Car')
    expect(found!.description).toBeNull()
    expect(found!.seats).toBe(4)
    expect(found!.transmission).toBe('MANUAL')
    expect(found!.fuelType).toBeNull()
    expect(found!.status).toBe('AVAILABLE')
  })

  it('findById returns undefined for non-existent id', async () => {
    const found = await repo.findById(SYSTEM_CONTEXT, 'non-existent-id')
    expect(found).toBeUndefined()
  })

  it('findAll returns all vehicles and filters by status', async () => {
    const available = await repo.create(SYSTEM_CONTEXT, {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      name: 'Available Car',
      description: null,
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: null,
      status: 'AVAILABLE',
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    })
    createdIds.push(available.id)

    const maintenance = await repo.create(SYSTEM_CONTEXT, {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      name: 'Maintenance Car',
      description: null,
      seats: 4,
      transmission: 'MANUAL',
      fuelType: null,
      licensePlate: null,
      status: 'MAINTENANCE',
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    })
    createdIds.push(maintenance.id)

    // findAll without filter should include both
    const { data: all } = await repo.findAll(SYSTEM_CONTEXT)
    const allIds = all.map((v) => v.id)
    expect(allIds).toContain(available.id)
    expect(allIds).toContain(maintenance.id)

    // findAll with status filter should only include matching
    const { data: filtered } = await repo.findAll(SYSTEM_CONTEXT, { status: 'MAINTENANCE' })
    const filteredIds = filtered.map((v) => v.id)
    expect(filteredIds).toContain(maintenance.id)
    expect(filteredIds).not.toContain(available.id)
  })

  it('update modifies specified fields and preserves others', async () => {
    const created = await repo.create(SYSTEM_CONTEXT, {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      name: 'Original Name',
      description: 'Original desc',
      seats: 5,
      transmission: 'AUTO',
      fuelType: 'Gasoline',
      licensePlate: null,
      status: 'AVAILABLE',
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    })
    createdIds.push(created.id)

    const updated = await repo.update(SYSTEM_CONTEXT, created.id, {
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
    expect(updated!.createdAt).toBeInstanceOf(Date)
    expect(updated!.updatedAt).toBeInstanceOf(Date)
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.createdAt.getTime())
  })

  it('update returns undefined for non-existent id', async () => {
    const result = await repo.update(SYSTEM_CONTEXT, 'non-existent-id', { name: 'Nope' })
    expect(result).toBeUndefined()
  })

  it('softDelete sets status to RETIRED', async () => {
    const created = await repo.create(SYSTEM_CONTEXT, {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      name: 'To Be Retired',
      description: null,
      seats: 4,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: null,
      status: 'AVAILABLE',
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    })
    createdIds.push(created.id)

    const retired = await repo.softDelete(SYSTEM_CONTEXT, created.id)

    expect(retired).toBeDefined()
    expect(retired!.id).toBe(created.id)
    expect(retired!.status).toBe('RETIRED')
    expect(retired!.name).toBe('To Be Retired')
    expect(retired!.updatedAt).toBeInstanceOf(Date)
    expect(retired!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.createdAt.getTime())

    // Verify persisted in DB
    const fromDb = await repo.findById(SYSTEM_CONTEXT, created.id)
    expect(fromDb!.status).toBe('RETIRED')
  })

  it('softDelete returns undefined for non-existent id', async () => {
    const result = await repo.softDelete(SYSTEM_CONTEXT, 'non-existent-id')
    expect(result).toBeUndefined()
  })
})
