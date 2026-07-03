// #1260 slice 4: bind the vehicle status write (PATCH /vehicles/:id/status ->
// MaintenanceService.toggleStatus) to the picked operator. The route gate is
// FLEET_WRITE_ROLES = BUSINESS_ROLES, which admits PLATFORM_ADMIN AND legacy
// STAFF/ADMIN; every one resolves `all` under operatorReadScope, so
// vehicleRepo.findById hands them ANY operator's vehicle by raw id. Mirrors
// VehicleService.update — legacy STAFF/ADMIN are reachable, so the `!isOperatorRole`
// keying is pinned at the service level.

import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  InMemoryMaintenanceLogRepository,
  InMemoryVehicleRepository,
} from '../../src/repositories/in-memory'
import type { RunInTransaction } from '../../src/repositories/types'
import { MaintenanceService } from '../../src/services/maintenance'
import type { Vehicle } from '../../src/stores'

const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
// #487 dropped legacy STAFF from SCOPE_BYPASS_ROLES (bypassScope=false) yet left it
// `all`-scoped by operatorReadScope — the exact pair a bypass-keyed guard would miss.
const legacyStaff: CallerContext = { userId: 's', role: 'STAFF', bypassScope: false }
const opA: CallerContext = { userId: 'ua', role: 'OPERATOR_OWNER', operatorId: 'op-A' }

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

let repo: InMemoryVehicleRepository
let service: MaintenanceService
let vehA: string // owned by op-A

beforeEach(async () => {
  repo = new InMemoryVehicleRepository()
  const logRepo = new InMemoryMaintenanceLogRepository()
  const runInTransaction: RunInTransaction = async (fn) =>
    fn({ vehicleRepo: repo, maintenanceLogRepo: logRepo })
  service = new MaintenanceService(repo, logRepo, runInTransaction)
  vehA = (await repo.create(SYSTEM_CONTEXT, vehicleInput('op-A'))).id
})

describe('MaintenanceService.toggleStatus — acting-operator binding (#1260)', () => {
  it('rejects an admin who names no acting operator (422 OPERATOR_REQUIRED), no status change', async () => {
    const res = await service.toggleStatus(admin, vehA, 'MAINTENANCE', 'Service')
    expect(res).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_REQUIRED' })
    expect((await repo.findById(SYSTEM_CONTEXT, vehA))?.status).toBe('AVAILABLE')
  })

  it('rejects an admin whose acting operator does not own the vehicle (404, no oracle)', async () => {
    const res = await service.toggleStatus(admin, vehA, 'MAINTENANCE', 'Service', 'op-B')
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Vehicle not found' })
    expect((await repo.findById(SYSTEM_CONTEXT, vehA))?.status).toBe('AVAILABLE')
  })

  it('toggles when the admin acts as the owning operator', async () => {
    const res = await service.toggleStatus(admin, vehA, 'MAINTENANCE', 'Service', 'op-A')
    expect(res).toMatchObject({ ok: true, vehicle: { status: 'MAINTENANCE' } })
  })

  // Mutation-resistance: keyed on !isOperatorRole, not bypassScope. A legacy STAFF
  // (bypassScope=false) is `all`-scoped here, so it reaches the guard and must be denied.
  it('denies a legacy STAFF (bypassScope=false) that names no acting operator (422)', async () => {
    const res = await service.toggleStatus(legacyStaff, vehA, 'MAINTENANCE', 'Service')
    expect(res).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_REQUIRED' })
  })

  it('ignores a stray acting id for a tenant operator (already clamped by read scope)', async () => {
    const res = await service.toggleStatus(opA, vehA, 'MAINTENANCE', 'Service', 'op-else')
    expect(res).toMatchObject({ ok: true, vehicle: { status: 'MAINTENANCE' } })
  })
})
