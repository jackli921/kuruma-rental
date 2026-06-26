import type { CreateVehicleBlockInput } from '@kuruma/shared/validators/vehicle-block'
import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../middleware/auth'
import { InMemoryVehicleRepository } from '../repositories/in-memory/vehicle'
import { InMemoryVehicleBlockRepository } from '../repositories/in-memory/vehicle-block'
import type { Vehicle } from '../stores'
import { VehicleBlockService } from './vehicle-block'

let vehicleRepo: InMemoryVehicleRepository
let blockRepo: InMemoryVehicleBlockRepository
let service: VehicleBlockService

beforeEach(() => {
  vehicleRepo = new InMemoryVehicleRepository()
  blockRepo = new InMemoryVehicleBlockRepository()
  service = new VehicleBlockService(vehicleRepo, blockRepo)
})

function ctxFor(operatorId: string): CallerContext {
  return { userId: `user_${operatorId}`, role: 'OPERATOR_OWNER', operatorId }
}

function seedVehicle(operatorId: string): Promise<Vehicle> {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId,
    classId: null,
    pickupLocationId: null,
    name: 'Test Car',
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: null,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 8000,
    hourlyRateJpy: null,
    shakenExpiryDate: '2027-01-01',
    insuranceExpiryDate: '2027-01-01',
  })
}

function blockInput(overrides: Partial<CreateVehicleBlockInput> = {}): CreateVehicleBlockInput {
  return {
    kind: 'MAINTENANCE',
    reason: 'Annual shaken',
    startAt: '2026-07-01T09:00:00.000Z',
    endAt: '2026-07-01T17:00:00.000Z',
    ...overrides,
  }
}

describe('VehicleBlockService.createBlock', () => {
  it('stamps operatorId from the vehicle and createdBy from the caller, never client input', async () => {
    const vehicle = await seedVehicle('op_a')

    const result = await service.createBlock(ctxFor('op_a'), vehicle.id, blockInput())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.block.operatorId).toBe('op_a')
      expect(result.block.vehicleId).toBe(vehicle.id)
      expect(result.block.createdBy).toBe('user_op_a')
      expect(result.block.kind).toBe('MAINTENANCE')
      expect(result.block.startAt).toEqual(new Date('2026-07-01T09:00:00.000Z'))
      expect(result.block.endAt).toEqual(new Date('2026-07-01T17:00:00.000Z'))
      expect(result.block.notes).toBeNull()
    }
  })

  it('returns 404 when the vehicle does not exist', async () => {
    const result = await service.createBlock(ctxFor('op_a'), crypto.randomUUID(), blockInput())
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('returns 404 when an operator targets another tenant’s vehicle (scoped resolution)', async () => {
    const foreign = await seedVehicle('op_b')

    const result = await service.createBlock(ctxFor('op_a'), foreign.id, blockInput())

    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('returns 409 VEHICLE_BLOCKED when a block overlaps an existing one on the same vehicle', async () => {
    const vehicle = await seedVehicle('op_a')
    await service.createBlock(ctxFor('op_a'), vehicle.id, blockInput())

    const overlap = await service.createBlock(
      ctxFor('op_a'),
      vehicle.id,
      blockInput({
        startAt: '2026-07-01T12:00:00.000Z',
        endAt: '2026-07-01T20:00:00.000Z',
      }),
    )

    expect(overlap).toMatchObject({ ok: false, status: 409, code: 'VEHICLE_BLOCK_OVERLAP' })
  })

  it('allows an adjacent block (endAt === next startAt) — half-open ranges do not overlap', async () => {
    const vehicle = await seedVehicle('op_a')
    await service.createBlock(ctxFor('op_a'), vehicle.id, blockInput())

    const adjacent = await service.createBlock(
      ctxFor('op_a'),
      vehicle.id,
      blockInput({
        startAt: '2026-07-01T17:00:00.000Z',
        endAt: '2026-07-01T19:00:00.000Z',
      }),
    )

    expect(adjacent.ok).toBe(true)
  })
})

describe('VehicleBlockService.deleteBlock', () => {
  it('removes a block the operator owns', async () => {
    const vehicle = await seedVehicle('op_a')
    const created = await service.createBlock(ctxFor('op_a'), vehicle.id, blockInput())
    if (!created.ok) throw new Error('setup failed')

    const result = await service.deleteBlock(ctxFor('op_a'), vehicle.id, created.block.id)

    expect(result).toMatchObject({ ok: true })
    expect(await blockRepo.findById(created.block.id)).toBeUndefined()
  })

  it('returns 404 for an unknown blockId', async () => {
    const vehicle = await seedVehicle('op_a')
    const result = await service.deleteBlock(ctxFor('op_a'), vehicle.id, crypto.randomUUID())
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('returns 404 when a different operator tries to delete the block (operator-scoped, defence-in-depth)', async () => {
    const aVehicle = await seedVehicle('op_a')
    const bVehicle = await seedVehicle('op_b')
    const created = await service.createBlock(ctxFor('op_a'), aVehicle.id, blockInput())
    if (!created.ok) throw new Error('setup failed')

    const result = await service.deleteBlock(ctxFor('op_b'), bVehicle.id, created.block.id)

    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(await blockRepo.findById(created.block.id)).toBeDefined()
  })
})
