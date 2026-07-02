// #1260 slice 4: bind vehicle writes to the picked operator. FLEET_WRITE_ROLES =
// BUSINESS_ROLES admits PLATFORM_ADMIN AND legacy STAFF/ADMIN; the vehicle catalog
// is read under operatorReadScope, where every one of those resolves `all`, so
// repo.findById/findByIds hands them ANY operator's vehicle by raw id. Each write
// must bind to the operator the caller is acting as, or the "read-only preview"
// is enforced client-side only. Unlike bookings, legacy STAFF/ADMIN are REACHABLE
// here (catalog read scope), so the `!isOperatorRole` keying is tested at the
// service level.

import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory'
import { VehicleService } from '../../src/services/vehicle'
import type { Vehicle } from '../../src/stores'
import { testResolveWriteOperatorId } from '../helpers/operator'

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
let service: VehicleService
let vehA: string // owned by op-A
let vehB: string // owned by op-B

beforeEach(async () => {
  repo = new InMemoryVehicleRepository()
  service = new VehicleService(repo, testResolveWriteOperatorId(), '')
  vehA = (await repo.create(SYSTEM_CONTEXT, vehicleInput('op-A'))).id
  vehB = (await repo.create(SYSTEM_CONTEXT, vehicleInput('op-B'))).id
})

describe('VehicleService.update — acting-operator binding (#1260)', () => {
  it('rejects an admin who names no acting operator (422 OPERATOR_REQUIRED)', async () => {
    const res = await service.update(admin, vehA, { name: 'Renamed' })
    expect(res).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_REQUIRED' })
    expect((await repo.findById(SYSTEM_CONTEXT, vehA))?.name).toBe('Car')
  })

  it('rejects an admin whose acting operator does not own the vehicle (404, no oracle)', async () => {
    const res = await service.update(admin, vehA, { name: 'Renamed' }, 'op-B')
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Vehicle not found' })
    expect((await repo.findById(SYSTEM_CONTEXT, vehA))?.name).toBe('Car')
  })

  it('updates when the admin acts as the owning operator', async () => {
    const res = await service.update(admin, vehA, { name: 'Renamed' }, 'op-A')
    expect(res).toMatchObject({ ok: true, vehicle: { name: 'Renamed' } })
  })

  // Mutation-resistance: keyed on !isOperatorRole, not bypassScope. A legacy STAFF
  // (bypassScope=false) is `all`-scoped here, so it reaches the guard and must be denied.
  it('denies a legacy STAFF (bypassScope=false) that names no acting operator (422)', async () => {
    const res = await service.update(legacyStaff, vehA, { name: 'Renamed' })
    expect(res).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_REQUIRED' })
  })

  it('ignores a stray acting id for a tenant operator (already clamped by read scope)', async () => {
    const res = await service.update(opA, vehA, { name: 'Renamed' }, 'op-else')
    expect(res).toMatchObject({ ok: true, vehicle: { name: 'Renamed' } })
  })
})

describe('VehicleService.softDelete — acting-operator binding (#1260)', () => {
  it('rejects an admin who names no acting operator (422), vehicle not retired', async () => {
    const res = await service.softDelete(admin, vehA)
    expect(res).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_REQUIRED' })
    expect((await repo.findById(SYSTEM_CONTEXT, vehA))?.status).not.toBe('RETIRED')
  })

  it('rejects an admin whose acting operator does not own the vehicle (404)', async () => {
    const res = await service.softDelete(admin, vehA, 'op-B')
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Vehicle not found' })
  })

  it('retires when the admin acts as the owning operator', async () => {
    const res = await service.softDelete(admin, vehA, 'op-A')
    expect(res).toMatchObject({ ok: true })
  })
})

describe('VehicleService.bulkUpdateStatus — acting-operator binding (#1260)', () => {
  it('rejects an admin who names no acting operator (422)', async () => {
    const res = await service.bulkUpdateStatus(admin, [vehA], 'MAINTENANCE')
    expect(res).toMatchObject({ ok: false, status: 422, code: 'OPERATOR_REQUIRED' })
  })

  // The batch guard: a cross-operator vehicle in the set is denied even when the
  // admin picked a valid operator for the others (no partial cross-tenant write).
  it('rejects the batch when it includes a vehicle outside the acting operator (404)', async () => {
    const res = await service.bulkUpdateStatus(admin, [vehA, vehB], 'MAINTENANCE', 'op-A')
    expect(res).toMatchObject({ ok: false, status: 404 })
    expect((await repo.findById(SYSTEM_CONTEXT, vehB))?.status).toBe('AVAILABLE')
  })

  it('updates when every vehicle belongs to the acting operator', async () => {
    const res = await service.bulkUpdateStatus(admin, [vehA], 'MAINTENANCE', 'op-A')
    expect(res).toMatchObject({ ok: true })
  })
})
