import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryBookingRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { VehicleBlockService } from '../../src/services/vehicle-block'
import type { Vehicle } from '../../src/stores'

// #1260: a platform-admin (or legacy STAFF/ADMIN) resolves `all` under
// operatorReadScope, so findById hands them ANY operator's vehicle by raw id.
// Block writes must therefore be bound to the operator the admin is acting as,
// or the "read-only preview" is enforced client-side only.
const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const opA: CallerContext = { userId: 'ua', role: 'OPERATOR_OWNER', operatorId: 'op-A' }

const input = {
  kind: 'MAINTENANCE' as const,
  reason: 'Annual shaken',
  startAt: '2026-07-01T09:00:00.000Z',
  endAt: '2026-07-01T17:00:00.000Z',
}

function vehicleInput(operatorId: string): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId,
    name: 'Car',
    classId: null,
    pickupLocationId: null,
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
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
  }
}

let vehicleRepo: InMemoryVehicleRepository
let blockRepo: InMemoryVehicleBlockRepository
let service: VehicleBlockService
let vehicleAId: string

beforeEach(async () => {
  vehicleRepo = new InMemoryVehicleRepository()
  blockRepo = new InMemoryVehicleBlockRepository()
  service = new VehicleBlockService(vehicleRepo, blockRepo, new InMemoryBookingRepository())
  const veh = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-A'))
  vehicleAId = veh.id
})

describe('VehicleBlockService.createBlock — acting-operator binding (#1260)', () => {
  it('rejects an admin who names no acting operator (422)', async () => {
    const result = await service.createBlock(admin, vehicleAId, input, undefined)
    expect(result).toMatchObject({ ok: false, status: 422 })
  })

  it('rejects an admin whose acting operator does not own the vehicle (404, no oracle)', async () => {
    const result = await service.createBlock(admin, vehicleAId, input, 'op-B')
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('creates the block when the admin acts as the owning operator (201)', async () => {
    const result = await service.createBlock(admin, vehicleAId, input, 'op-A')
    expect(result).toMatchObject({ ok: true, block: { operatorId: 'op-A', vehicleId: vehicleAId } })
  })

  it('still lets a tenant operator write without an acting id (regression)', async () => {
    const result = await service.createBlock(opA, vehicleAId, input)
    expect(result).toMatchObject({ ok: true, block: { operatorId: 'op-A' } })
  })
})

describe('VehicleBlockService.deleteBlock — acting-operator binding (#1260)', () => {
  async function seedBlock(): Promise<string> {
    const block = await blockRepo.create({
      operatorId: 'op-A',
      vehicleId: vehicleAId,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      kind: 'MAINTENANCE',
      reason: 'seed',
      notes: null,
      createdBy: 'seed',
    })
    return block.id
  }

  it('rejects an admin who names no acting operator (422)', async () => {
    const blockId = await seedBlock()
    const result = await service.deleteBlock(admin, vehicleAId, blockId, undefined)
    expect(result).toMatchObject({ ok: false, status: 422 })
    expect(await blockRepo.findById(blockId)).toBeDefined()
  })

  it('rejects an admin whose acting operator does not own the vehicle (404)', async () => {
    const blockId = await seedBlock()
    const result = await service.deleteBlock(admin, vehicleAId, blockId, 'op-B')
    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(await blockRepo.findById(blockId)).toBeDefined()
  })

  it('removes the block when the admin acts as the owning operator', async () => {
    const blockId = await seedBlock()
    const result = await service.deleteBlock(admin, vehicleAId, blockId, 'op-A')
    expect(result).toMatchObject({ ok: true })
    expect(await blockRepo.findById(blockId)).toBeUndefined()
  })
})
