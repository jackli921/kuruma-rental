import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT, type UserRole } from '../../src/middleware/auth'
import {
  InMemoryVehicleBlockRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import { createVehicleBlockRoutes } from '../../src/routes/vehicle-blocks'
import { VehicleBlockService } from '../../src/services/vehicle-block'
import type { Vehicle } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'

type VehicleInput = Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>

function vehicleInput(operatorId: string): VehicleInput {
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

function appAs(role: UserRole, operatorId?: string): Hono {
  const a = new Hono()
  a.use('*', testAuthMiddleware('caller', role, operatorId))
  a.route('/', createVehicleBlockRoutes(new VehicleBlockService(vehicleRepo, blockRepo)))
  return a
}

function postBlock(app: Hono, vehicleId: string, body: unknown = validBody) {
  return app.request(`/vehicles/${vehicleId}/blocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vehicleRepo = new InMemoryVehicleRepository()
  blockRepo = new InMemoryVehicleBlockRepository()
})

describe('POST /vehicles/:vehicleId/blocks', () => {
  it('creates a block (201) with server-derived operatorId and createdBy', async () => {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))

    const res = await postBlock(appAs('OPERATOR_OWNER', 'op-a'), vehicle.id)

    expect(res.status).toBe(201)
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> }
    expect(body.success).toBe(true)
    expect(body.data).toMatchObject({
      operatorId: 'op-a',
      vehicleId: vehicle.id,
      createdBy: 'caller',
      kind: 'MAINTENANCE',
      reason: 'Annual shaken',
    })
  })

  it('returns 409 VEHICLE_BLOCK_OVERLAP for a window overlapping an existing block', async () => {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))
    const app = appAs('OPERATOR_OWNER', 'op-a')
    await postBlock(app, vehicle.id)

    const res = await postBlock(app, vehicle.id, {
      ...validBody,
      startAt: '2026-07-01T12:00:00.000Z',
      endAt: '2026-07-01T20:00:00.000Z',
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as { code?: string }
    expect(body.code).toBe('VEHICLE_BLOCK_OVERLAP')
  })

  it('returns 400 when endAt is not after startAt', async () => {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))

    const res = await postBlock(appAs('OPERATOR_OWNER', 'op-a'), vehicle.id, {
      ...validBody,
      endAt: validBody.startAt,
    })

    expect(res.status).toBe(400)
  })

  it('returns 404 when an operator targets another tenant’s vehicle', async () => {
    const foreign = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-b'))

    const res = await postBlock(appAs('OPERATOR_OWNER', 'op-a'), foreign.id)

    expect(res.status).toBe(404)
  })

  it('rejects a RENTER with 403', async () => {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))

    const res = await postBlock(appAs('RENTER'), vehicle.id)

    expect(res.status).toBe(403)
  })
})

describe('DELETE /vehicles/:vehicleId/blocks/:blockId', () => {
  async function seedBlock(operatorId: string): Promise<{ vehicleId: string; blockId: string }> {
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(operatorId))
    const block = await blockRepo.create({
      operatorId,
      vehicleId: vehicle.id,
      startAt: new Date('2026-07-01T09:00:00.000Z'),
      endAt: new Date('2026-07-01T17:00:00.000Z'),
      kind: 'MAINTENANCE',
      reason: 'Annual shaken',
      notes: null,
      createdBy: 'seed',
    })
    return { vehicleId: vehicle.id, blockId: block.id }
  }

  it('removes a block the operator owns (200)', async () => {
    const { vehicleId, blockId } = await seedBlock('op-a')

    const res = await appAs('OPERATOR_OWNER', 'op-a').request(
      `/vehicles/${vehicleId}/blocks/${blockId}`,
      { method: 'DELETE' },
    )

    expect(res.status).toBe(200)
    expect(await blockRepo.findById(blockId)).toBeUndefined()
  })

  it('returns 404 for an unknown blockId', async () => {
    const { vehicleId } = await seedBlock('op-a')

    const res = await appAs('OPERATOR_OWNER', 'op-a').request(
      `/vehicles/${vehicleId}/blocks/${crypto.randomUUID()}`,
      { method: 'DELETE' },
    )

    expect(res.status).toBe(404)
  })

  it('does not let another operator delete the block (404, defence-in-depth)', async () => {
    const { blockId } = await seedBlock('op-a')
    const bVehicle = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-b'))

    const res = await appAs('OPERATOR_OWNER', 'op-b').request(
      `/vehicles/${bVehicle.id}/blocks/${blockId}`,
      { method: 'DELETE' },
    )

    expect(res.status).toBe(404)
    expect(await blockRepo.findById(blockId)).toBeDefined()
  })

  it('rejects a PARTNER with 403', async () => {
    const { vehicleId, blockId } = await seedBlock('op-a')

    const res = await appAs('PARTNER').request(`/vehicles/${vehicleId}/blocks/${blockId}`, {
      method: 'DELETE',
    })

    expect(res.status).toBe(403)
  })
})
