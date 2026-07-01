import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import { SYSTEM_CONTEXT, type UserRole } from '../../src/middleware/auth'
import {
  InMemoryMaintenanceLogRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { RunInTransaction } from '../../src/repositories/types'
import { createVehicleRoutes } from '../../src/routes/vehicles'
import { MaintenanceService } from '../../src/services/maintenance'
import { VehicleService } from '../../src/services/vehicle'
import type { Vehicle } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'
import { testResolveWriteOperatorId } from '../helpers/operator'

const OP_A = 'operator-aaaaaaaa'
const OP_B = 'operator-bbbbbbbb'

function vehicleInput(
  operatorId: string,
  name: string,
): Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    operatorId,
    name,
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

async function seedRepo(): Promise<InMemoryVehicleRepository> {
  const repo = new InMemoryVehicleRepository()
  await repo.create(SYSTEM_CONTEXT, vehicleInput(OP_A, 'Car A'))
  await repo.create(SYSTEM_CONTEXT, vehicleInput(OP_B, 'Car B'))
  return repo
}

function mountRead(repo: InMemoryVehicleRepository, role: UserRole, operatorId?: string): Hono {
  const logRepo = new InMemoryMaintenanceLogRepository()
  const runInTransaction: RunInTransaction = async (fn) =>
    fn({ vehicleRepo: repo, maintenanceLogRepo: logRepo })
  const maintenanceService = new MaintenanceService(repo, logRepo, runInTransaction)
  const vehicleService = new VehicleService(repo, testResolveWriteOperatorId(), '')
  const a = new Hono()
  setupGlobalHandlers(a)
  a.use('*', testAuthMiddleware(`${role}-user`, role, operatorId))
  a.route('/', createVehicleRoutes(vehicleService, maintenanceService))
  return a
}

describe('GET /vehicles — picker operator narrowing (#1230 slice 5b)', () => {
  it('narrows a PLATFORM_ADMIN to ?operatorId=', async () => {
    const res = await mountRead(await seedRepo(), 'PLATFORM_ADMIN').request(
      `/vehicles?operatorId=${OP_A}`,
    )
    const body = (await res.json()) as { success: boolean; data: Array<{ operatorId: string }> }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.operatorId).toBe(OP_A)
  })

  it('ignores ?operatorId= for a renter (public catalog stays whole)', async () => {
    const res = await mountRead(await seedRepo(), 'RENTER').request(`/vehicles?operatorId=${OP_A}`)
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(2)
  })

  it('ignores ?operatorId= for a tenant operator (its own scope wins)', async () => {
    const res = await mountRead(await seedRepo(), 'OPERATOR_OWNER', OP_A).request(
      `/vehicles?operatorId=${OP_B}`,
    )
    const body = (await res.json()) as { data: Array<{ operatorId: string }> }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.operatorId).toBe(OP_A)
  })

  it('treats an empty ?operatorId= as no narrow', async () => {
    const res = await mountRead(await seedRepo(), 'PLATFORM_ADMIN').request('/vehicles?operatorId=')
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toHaveLength(2)
  })
})
