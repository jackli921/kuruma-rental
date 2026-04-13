import { Hono } from 'hono'
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryMaintenanceLogRepository } from '../../src/repositories/in-memory'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import { createMaintenanceLogRoutes } from '../../src/routes/maintenance-logs'
import { createVehicleRoutes } from '../../src/routes/vehicles'
import { MaintenanceService } from '../../src/services/maintenance'
import { testAuthMiddleware } from '../helpers/auth'

let app: Hono

function validVehicleInput() {
  return {
    name: 'Toyota Corolla',
    seats: 5,
    transmission: 'AUTO' as const,
    bufferMinutes: 60,
    dailyRateJpy: 8000,
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

describe('Maintenance Logs', () => {
  beforeEach(() => {
    const vehicleRepo = new InMemoryVehicleRepository()
    const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
    const maintenanceService = new MaintenanceService(vehicleRepo, maintenanceLogRepo)

    app = new Hono()
    app.use('*', testAuthMiddleware('staff-user', 'STAFF'))
    app.route('/', createVehicleRoutes(vehicleRepo, maintenanceService))
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

  describe('auth', () => {
    it('rejects RENTER role with 403', async () => {
      const renterApp = new Hono()
      renterApp.use('*', testAuthMiddleware('renter-user', 'RENTER'))
      const vehicleRepo = new InMemoryVehicleRepository()
      const maintenanceLogRepo = new InMemoryMaintenanceLogRepository()
      const maintenanceService = new MaintenanceService(vehicleRepo, maintenanceLogRepo)
      renterApp.route('/', createMaintenanceLogRoutes(maintenanceService))

      const res = await renterApp.request('/vehicles/some-id/maintenance-logs')

      expect(res.status).toBe(403)
    })
  })
})
