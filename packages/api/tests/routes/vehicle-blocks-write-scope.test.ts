import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT, type UserRole } from '../../src/middleware/auth'
import {
  InMemoryBookingRepository,
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { createVehicleBlockRoutes } from '../../src/routes/vehicle-blocks'
import { VehicleBlockService } from '../../src/services/vehicle-block'
import type { Vehicle } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

// #1260: the "admin gets a read-only preview" property was enforced client-side
// only; the write API let a platform-admin mutate any operator's blocks by raw
// vehicleId. Writes now require the picked ?operatorId= and bind to it.

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

const validBody = {
  kind: 'MAINTENANCE',
  reason: 'Annual shaken',
  startAt: '2026-07-01T09:00:00.000Z',
  endAt: '2026-07-01T17:00:00.000Z',
}

let vehicleRepo: InMemoryVehicleRepository
let blockRepo: InMemoryVehicleBlockRepository
let bookingRepo: InMemoryBookingRepository

function appAs(role: UserRole, operatorId?: string): Hono {
  const a = new Hono()
  a.use('*', testAuthMiddleware('caller', role, operatorId))
  a.route(
    '/',
    createVehicleBlockRoutes(new VehicleBlockService(vehicleRepo, blockRepo, bookingRepo)),
  )
  return a
}

function postBlock(app: Hono, vehicleId: string, query = '') {
  return app.request(`/vehicles/${vehicleId}/blocks${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validBody),
  })
}

beforeEach(() => {
  vehicleRepo = new InMemoryVehicleRepository()
  blockRepo = new InMemoryVehicleBlockRepository()
  bookingRepo = new InMemoryBookingRepository()
})

describe('POST /vehicles/:vehicleId/blocks — admin acting-operator (#1260)', () => {
  it('rejects a platform-admin with no ?operatorId= (422)', async () => {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))
    const res = await postBlock(appAs('PLATFORM_ADMIN'), vehicle.id)
    expect(res.status).toBe(422)
  })

  it('rejects a platform-admin whose ?operatorId= does not own the vehicle (404)', async () => {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))
    const res = await postBlock(appAs('PLATFORM_ADMIN'), vehicle.id, '?operatorId=op-b')
    expect(res.status).toBe(404)
  })

  it('creates the block when the admin acts as the owning operator (201)', async () => {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))
    const res = await postBlock(appAs('PLATFORM_ADMIN'), vehicle.id, '?operatorId=op-a')
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { operatorId: string } }
    expect(body.data.operatorId).toBe('op-a')
  })

  it('ignores ?operatorId= for a tenant operator — it stays clamped to its own tenant', async () => {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))
    // A tenant operator passing a foreign ?operatorId= must not be able to widen
    // scope; its own read scope still binds it, so this simply succeeds on its car.
    const res = await postBlock(appAs('OPERATOR_OWNER', 'op-a'), vehicle.id, '?operatorId=op-b')
    expect(res.status).toBe(201)
  })
})

describe('DELETE /vehicles/:vehicleId/blocks/:blockId — admin acting-operator (#1260)', () => {
  async function seedBlock(operatorId: string): Promise<{ vehicleId: string; blockId: string }> {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(operatorId))
    const block = await blockRepo.create({
      operatorId,
      vehicleId: vehicle.id,
      startAt: new Date(validBody.startAt),
      endAt: new Date(validBody.endAt),
      kind: 'MAINTENANCE',
      reason: 'seed',
      notes: null,
      createdBy: 'seed',
    })
    return { vehicleId: vehicle.id, blockId: block.id }
  }

  it('rejects a platform-admin with no ?operatorId= (422)', async () => {
    const { vehicleId, blockId } = await seedBlock('op-a')
    const res = await appAs('PLATFORM_ADMIN').request(`/vehicles/${vehicleId}/blocks/${blockId}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(422)
    expect(await blockRepo.findById(blockId)).toBeDefined()
  })

  it('rejects a platform-admin whose ?operatorId= does not own the vehicle (404)', async () => {
    const { vehicleId, blockId } = await seedBlock('op-a')
    const res = await appAs('PLATFORM_ADMIN').request(
      `/vehicles/${vehicleId}/blocks/${blockId}?operatorId=op-b`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(404)
    expect(await blockRepo.findById(blockId)).toBeDefined()
  })

  it('removes the block when the admin acts as the owning operator (200)', async () => {
    const { vehicleId, blockId } = await seedBlock('op-a')
    const res = await appAs('PLATFORM_ADMIN').request(
      `/vehicles/${vehicleId}/blocks/${blockId}?operatorId=op-a`,
      { method: 'DELETE' },
    )
    expect(res.status).toBe(200)
    expect(await blockRepo.findById(blockId)).toBeUndefined()
  })
})
