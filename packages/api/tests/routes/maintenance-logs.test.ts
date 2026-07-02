import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT, type UserRole } from '../../src/middleware/auth'
import { InMemoryMaintenanceLogRepository } from '../../src/repositories/in-memory'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import type { RunInTransaction } from '../../src/repositories/types'
import { createMaintenanceLogRoutes } from '../../src/routes/maintenance-logs'
import { createVehicleRoutes } from '../../src/routes/vehicles'
import { MaintenanceService } from '../../src/services/maintenance'
import { VehicleService } from '../../src/services/vehicle'
import type { Vehicle } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'
import { TEST_OPERATOR_ID, testResolveWriteOperatorId } from '../helpers/operator'

let app: Hono
let maintenanceService: MaintenanceService

function validVehicleInput() {
  return {
    // #407: STAFF/ADMIN creates must name the operator (inference retired).
    operatorId: TEST_OPERATOR_ID,
    name: 'Toyota Corolla',
    seats: 5,
    transmission: 'AUTO' as const,
    bufferMinutes: 60,
    dailyRateJpy: 8000,
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
  }
}

async function createVehicle(input = validVehicleInput()) {
  const res = await app.request('/vehicles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await res.json()
  return body.data
}

async function patchStatus(id: string, status: string, reason?: string) {
  return app.request(`/vehicles/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, ...(reason != null ? { reason } : {}) }),
  })
}

function createInMemoryTransaction(
  vehicleRepo: InMemoryVehicleRepository,
  maintenanceLogRepo: InMemoryMaintenanceLogRepository,
): RunInTransaction {
  return async (fn) => fn({ vehicleRepo, maintenanceLogRepo })
}

describe('Maintenance Logs', () => {
  beforeEach(() => {
    const vehicleRepo = new InMemoryVehicleRepository()
    const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
    const runInTransaction = createInMemoryTransaction(vehicleRepo, maintenanceLogRepo)
    maintenanceService = new MaintenanceService(vehicleRepo, maintenanceLogRepo, runInTransaction)

    const vehicleService = new VehicleService(vehicleRepo, testResolveWriteOperatorId(), '')
    app = new Hono()
    // #1260: drive the status route as a tenant OPERATOR_OWNER so the acting-operator
    // write guard no-ops; admin-picker binding is covered by dedicated tests.
    app.use('*', testAuthMiddleware('operator-user', 'OPERATOR_OWNER', TEST_OPERATOR_ID))
    app.route('/', createVehicleRoutes(vehicleService, maintenanceService))
    app.route('/', createMaintenanceLogRoutes(maintenanceService))
  })

  describe('PATCH /vehicles/:id/status → MAINTENANCE', () => {
    it('creates a maintenance log when toggling to MAINTENANCE with reason', async () => {
      const vehicle = await createVehicle()

      const res = await patchStatus(vehicle.id, 'MAINTENANCE', 'Oil change needed')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data.status).toBe('MAINTENANCE')

      // Verify the log was created
      const logsRes = await app.request(`/vehicles/${vehicle.id}/maintenance-logs`)
      const logsBody = await logsRes.json()
      expect(logsBody.data).toHaveLength(1)
      expect(logsBody.data[0].reason).toBe('Oil change needed')
      expect(logsBody.data[0].vehicleId).toBe(vehicle.id)
      expect(logsBody.data[0].resolvedAt).toBeNull()
    })

    it('rejects toggling to MAINTENANCE without reason', async () => {
      const vehicle = await createVehicle()

      const res = await patchStatus(vehicle.id, 'MAINTENANCE')

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.success).toBe(false)
    })

    it('allows toggling to AVAILABLE without reason', async () => {
      const vehicle = await createVehicle()
      await patchStatus(vehicle.id, 'MAINTENANCE', 'Tire rotation')

      const res = await patchStatus(vehicle.id, 'AVAILABLE')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.status).toBe('AVAILABLE')
    })
  })

  describe('PATCH /vehicles/:id/status → AVAILABLE resolves log', () => {
    it('sets resolvedAt on the active log when toggling back to AVAILABLE', async () => {
      const vehicle = await createVehicle()
      await patchStatus(vehicle.id, 'MAINTENANCE', 'Brake inspection')

      await patchStatus(vehicle.id, 'AVAILABLE')

      const logsRes = await app.request(`/vehicles/${vehicle.id}/maintenance-logs`)
      const logsBody = await logsRes.json()
      expect(logsBody.data).toHaveLength(1)
      expect(logsBody.data[0].reason).toBe('Brake inspection')
      expect(logsBody.data[0].resolvedAt).not.toBeNull()
    })
  })

  describe('GET /vehicles/:vehicleId/maintenance-logs', () => {
    it('returns empty array for vehicle with no maintenance history', async () => {
      const vehicle = await createVehicle()

      const res = await app.request(`/vehicles/${vehicle.id}/maintenance-logs`)

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.data).toEqual([])
    })

    it('returns logs ordered most recent first', async () => {
      const vehicle = await createVehicle()

      await patchStatus(vehicle.id, 'MAINTENANCE', 'Oil change')
      await patchStatus(vehicle.id, 'AVAILABLE')
      await patchStatus(vehicle.id, 'MAINTENANCE', 'Brake pads')

      const res = await app.request(`/vehicles/${vehicle.id}/maintenance-logs`)
      const body = await res.json()

      expect(body.data).toHaveLength(2)
      expect(body.data[0].reason).toBe('Brake pads')
      expect(body.data[0].resolvedAt).toBeNull()
      expect(body.data[1].reason).toBe('Oil change')
      expect(body.data[1].resolvedAt).not.toBeNull()
    })
  })

  describe('MAINTENANCE → MAINTENANCE re-entry', () => {
    it('resolves the old log and creates a new one', async () => {
      const vehicle = await createVehicle()
      await patchStatus(vehicle.id, 'MAINTENANCE', 'Oil change')
      await patchStatus(vehicle.id, 'MAINTENANCE', 'New reason: brake pads')

      const logsRes = await app.request(`/vehicles/${vehicle.id}/maintenance-logs`)
      const logsBody = await logsRes.json()

      expect(logsBody.data).toHaveLength(2)
      // Most recent first
      expect(logsBody.data[0].reason).toBe('New reason: brake pads')
      expect(logsBody.data[0].resolvedAt).toBeNull()
      // Old one is resolved
      expect(logsBody.data[1].reason).toBe('Oil change')
      expect(logsBody.data[1].resolvedAt).not.toBeNull()
    })
  })

  // Contract test: verifies service logic returns 409 on status mismatch.
  // JS event loop serializes the InMemory calls — true DB-level concurrency
  // requires an integration test against Postgres with the conditional WHERE.
  describe('concurrent status toggle', () => {
    it('second toggle returns 409 when first already changed the status', async () => {
      const vehicle = await createVehicle()

      // Both requests race — fire concurrently
      const [res1, res2] = await Promise.all([
        patchStatus(vehicle.id, 'MAINTENANCE', 'Oil change'),
        patchStatus(vehicle.id, 'MAINTENANCE', 'Brake pads'),
      ])

      const statuses = [res1.status, res2.status].sort()
      // Exactly one succeeds, one gets 409
      expect(statuses).toEqual([200, 409])

      // Only one maintenance log should be active
      const logsRes = await app.request(`/vehicles/${vehicle.id}/maintenance-logs`)
      const logsBody = await logsRes.json()
      const activeLogs = logsBody.data.filter(
        (l: { resolvedAt: string | null }) => l.resolvedAt === null,
      )
      expect(activeLogs).toHaveLength(1)
    })
  })

  describe('transaction rollback', () => {
    it('reverts vehicle status when log transition fails', async () => {
      const vehicleRepo = new InMemoryVehicleRepository()
      const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()

      // Transaction that simulates rollback: snapshot state, run fn, restore on error
      const rollbackTransaction: RunInTransaction = async (fn) => {
        const snapshot = new Map([
          ...(vehicleRepo as unknown as { store: Map<string, unknown> }).store,
        ])
        try {
          return await fn({ vehicleRepo, maintenanceLogRepo })
        } catch (err) {
          ;(vehicleRepo as unknown as { store: Map<string, unknown> }).store.clear()
          for (const [k, v] of snapshot) {
            ;(vehicleRepo as unknown as { store: Map<string, unknown> }).store.set(k, v)
          }
          throw err
        }
      }

      // Sabotage transitionLogs to throw after vehicle update
      const originalTransition = maintenanceLogRepo.transitionLogs.bind(maintenanceLogRepo)
      let callCount = 0
      maintenanceLogRepo.transitionLogs = async (...args) => {
        callCount++
        if (callCount === 1) throw new Error('simulated DB failure')
        return originalTransition(...args)
      }

      const service = new MaintenanceService(vehicleRepo, maintenanceLogRepo, rollbackTransaction)
      const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
        operatorId: TEST_OPERATOR_ID,
        name: 'Test Car',
        classId: null,
        description: null,
        photos: [],
        seats: 5,
        transmission: 'AUTO',
        fuelType: 'GASOLINE',
        licensePlate: 'TEST-001',
        status: 'AVAILABLE',
        bufferMinutes: 60,
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
      })

      // Guard: snapshot must have captured the vehicle — if store field was renamed,
      // the snapshot would be empty and rollback silently does nothing.
      expect(await vehicleRepo.findById(SYSTEM_CONTEXT, vehicle.id)).toBeDefined()

      // toggleStatus should propagate the error from the transaction
      await expect(
        service.toggleStatus(
          SYSTEM_CONTEXT,
          vehicle.id,
          'MAINTENANCE',
          'Oil change',
          TEST_OPERATOR_ID,
        ),
      ).rejects.toThrow('simulated DB failure')

      // Vehicle status must remain AVAILABLE — rolled back
      const after = await vehicleRepo.findById(SYSTEM_CONTEXT, vehicle.id)
      expect(after?.status).toBe('AVAILABLE')
    })
  })

  describe('auth', () => {
    it('rejects RENTER role with 403', async () => {
      const renterApp = new Hono()
      renterApp.use('*', testAuthMiddleware('renter-user', 'RENTER'))
      const vehicleRepo = new InMemoryVehicleRepository()
      const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
      const runInTransaction = createInMemoryTransaction(vehicleRepo, maintenanceLogRepo)
      const maintenanceService = new MaintenanceService(
        vehicleRepo,
        maintenanceLogRepo,
        runInTransaction,
      )
      renterApp.route('/', createMaintenanceLogRoutes(maintenanceService))

      const res = await renterApp.request('/vehicles/some-id/maintenance-logs')

      expect(res.status).toBe(403)
    })
  })
})

// Operator tenant-scoping (#705). The maintenance-logs read is the last
// vehicle-management read still on the pre-#594 STAFF-only pattern. Admit
// tenant-scoped OPERATOR_* callers (MANAGEMENT_READ_ROLES) but bound each to
// their own fleet: a foreign-tenant vehicleId must resolve to [] (never a
// cross-tenant maintenance-history leak), while platform STAFF/ADMIN retain
// full read. RENTER / PARTNER stay rejected.
describe('GET /vehicles/:vehicleId/maintenance-logs — operator scoping', () => {
  type VehicleInput = Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>
  function vehicleInput(operatorId: string): VehicleInput {
    return {
      operatorId,
      name: 'Car',
      classId: null,
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
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

  let scopeVehicleRepo: InMemoryVehicleRepository
  let scopeMaintenanceLogRepo: InMemoryMaintenanceLogRepository

  function appAs(role: UserRole, operatorId?: string): Hono {
    const a = new Hono()
    a.use('*', testAuthMiddleware('caller', role, operatorId))
    const runInTransaction = createInMemoryTransaction(scopeVehicleRepo, scopeMaintenanceLogRepo)
    a.route(
      '/',
      createMaintenanceLogRoutes(
        new MaintenanceService(scopeVehicleRepo, scopeMaintenanceLogRepo, runInTransaction),
      ),
    )
    return a
  }

  // Seed one vehicle per operator, each with a distinct maintenance log.
  async function seedTenants(): Promise<{ aVehicleId: string; bVehicleId: string }> {
    const aVehicle = await scopeVehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-a'))
    const bVehicle = await scopeVehicleRepo.create(SYSTEM_CONTEXT, vehicleInput('op-b'))
    await scopeMaintenanceLogRepo.create({
      vehicleId: aVehicle.id,
      reason: 'A oil change',
      notes: null,
      costJpy: null,
      startedAt: new Date(),
      resolvedAt: null,
    })
    await scopeMaintenanceLogRepo.create({
      vehicleId: bVehicle.id,
      reason: 'B brake pads',
      notes: null,
      costJpy: null,
      startedAt: new Date(),
      resolvedAt: null,
    })
    return { aVehicleId: aVehicle.id, bVehicleId: bVehicle.id }
  }

  beforeEach(() => {
    scopeVehicleRepo = new InMemoryVehicleRepository()
    scopeMaintenanceLogRepo = new InMemoryMaintenanceLogRepository()
  })

  it('admits an OPERATOR_OWNER and returns only their own vehicle’s logs', async () => {
    const { aVehicleId } = await seedTenants()

    const res = await appAs('OPERATOR_OWNER', 'op-a').request(
      `/vehicles/${aVehicleId}/maintenance-logs`,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<{ reason: string }> }
    expect(body.data.map((l) => l.reason)).toEqual(['A oil change'])
  })

  it('returns [] when an OPERATOR_OWNER reads another tenant’s vehicleId', async () => {
    const { bVehicleId } = await seedTenants()

    const res = await appAs('OPERATOR_OWNER', 'op-a').request(
      `/vehicles/${bVehicleId}/maintenance-logs`,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: unknown[] }
    expect(body.success).toBe(true)
    expect(body.data).toEqual([])
  })

  it('isolates an OPERATOR_STAFF to their own tenant', async () => {
    const { aVehicleId, bVehicleId } = await seedTenants()

    const own = await appAs('OPERATOR_STAFF', 'op-b').request(
      `/vehicles/${bVehicleId}/maintenance-logs`,
    )
    const foreign = await appAs('OPERATOR_STAFF', 'op-b').request(
      `/vehicles/${aVehicleId}/maintenance-logs`,
    )

    expect(
      ((await own.json()) as { data: Array<{ reason: string }> }).data.map((l) => l.reason),
    ).toEqual(['B brake pads'])
    expect(((await foreign.json()) as { data: unknown[] }).data).toEqual([])
  })

  it('fails closed for an OPERATOR_* caller missing its operatorId', async () => {
    const { aVehicleId } = await seedTenants()

    const res = await appAs('OPERATOR_OWNER').request(`/vehicles/${aVehicleId}/maintenance-logs`)

    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: unknown[] }).data).toEqual([])
  })

  it('lets a platform STAFF read any tenant’s logs (bypass)', async () => {
    const { aVehicleId, bVehicleId } = await seedTenants()

    const a = await appAs('STAFF').request(`/vehicles/${aVehicleId}/maintenance-logs`)
    const b = await appAs('STAFF').request(`/vehicles/${bVehicleId}/maintenance-logs`)

    expect(
      ((await a.json()) as { data: Array<{ reason: string }> }).data.map((l) => l.reason),
    ).toEqual(['A oil change'])
    expect(
      ((await b.json()) as { data: Array<{ reason: string }> }).data.map((l) => l.reason),
    ).toEqual(['B brake pads'])
  })

  it('lets a PLATFORM_ADMIN read any tenant’s logs (bypass)', async () => {
    const { bVehicleId } = await seedTenants()

    const res = await appAs('PLATFORM_ADMIN').request(`/vehicles/${bVehicleId}/maintenance-logs`)

    expect(res.status).toBe(200)
    expect(
      ((await res.json()) as { data: Array<{ reason: string }> }).data.map((l) => l.reason),
    ).toEqual(['B brake pads'])
  })

  it('rejects a PARTNER (3rd-party API caller) with 403', async () => {
    const { aVehicleId } = await seedTenants()

    const res = await appAs('PARTNER').request(`/vehicles/${aVehicleId}/maintenance-logs`)

    expect(res.status).toBe(403)
  })
})
