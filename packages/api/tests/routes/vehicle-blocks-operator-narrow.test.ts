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

const RANGE = '?from=2026-07-01T00:00:00.000Z&to=2026-07-02T00:00:00.000Z'

let vehicleRepo: InMemoryVehicleRepository
let blockRepo: InMemoryVehicleBlockRepository
let bookingRepo: InMemoryBookingRepository

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
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
  }
}

function appAs(role: UserRole, operatorId?: string): Hono {
  const a = new Hono()
  a.use('*', testAuthMiddleware('caller', role, operatorId))
  a.route(
    '/',
    createVehicleBlockRoutes(new VehicleBlockService(vehicleRepo, blockRepo, bookingRepo)),
  )
  return a
}

async function seedBlock(operatorId: string, vehicleId: string): Promise<void> {
  await blockRepo.create({
    operatorId,
    vehicleId,
    startAt: new Date('2026-07-01T09:00:00Z'),
    endAt: new Date('2026-07-01T17:00:00Z'),
    kind: 'MAINTENANCE',
    reason: 'shaken',
    notes: null,
    createdBy: 'u',
  })
}

beforeEach(async () => {
  vehicleRepo = new InMemoryVehicleRepository()
  blockRepo = new InMemoryVehicleBlockRepository()
  bookingRepo = new InMemoryBookingRepository()
  const va = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))
  const vb = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-b'))
  await seedBlock('op-a', va.id)
  await seedBlock('op-b', vb.id)
})

describe('GET /vehicle-blocks — picker operator narrowing (#1230 slice 5b)', () => {
  it('narrows a PLATFORM_ADMIN to ?operatorId=', async () => {
    const res = await appAs('PLATFORM_ADMIN').request(`/vehicle-blocks${RANGE}&operatorId=op-a`)
    const body = (await res.json()) as { data: Array<{ operatorId: string }> }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.operatorId).toBe('op-a')
  })

  it('a PLATFORM_ADMIN with no pick sees both operators', async () => {
    const res = await appAs('PLATFORM_ADMIN').request(`/vehicle-blocks${RANGE}`)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(2)
  })

  it('a tenant operator ignores a foreign ?operatorId=', async () => {
    const res = await appAs('OPERATOR_OWNER', 'op-a').request(
      `/vehicle-blocks${RANGE}&operatorId=op-b`,
    )
    const body = (await res.json()) as { data: Array<{ operatorId: string }> }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.operatorId).toBe('op-a')
  })

  it('legacy STAFF is admitted by the route gate but reads nothing (scope none), ?operatorId= cannot widen', async () => {
    const res = await appAs('STAFF').request(`/vehicle-blocks${RANGE}&operatorId=op-a`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(0)
  })
})
