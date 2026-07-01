import { describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import { VehicleService } from '../../src/services/vehicle'
import type { Vehicle } from '../../src/stores'
import { testResolveWriteOperatorId } from '../helpers/operator'

// #1230 slice 5b: the vehicle catalog is PUBLIC (operatorReadScope maps renters and
// partners to `all`), so the picker narrow must gate on the platform tier explicitly.
// A renter/partner passing ?operatorId= is NOT narrowed — they still read the whole
// catalog; only a PLATFORM_ADMIN narrows.
const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
const renter: CallerContext = { userId: 'r', role: 'RENTER' }
const partner: CallerContext = { userId: 'p', role: 'PARTNER', bypassScope: true }
const opA: CallerContext = { userId: 'ua', role: 'OPERATOR_OWNER', operatorId: 'op-A' }

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

async function service(): Promise<VehicleService> {
  const repo = new InMemoryVehicleRepository()
  await repo.create(SYSTEM_CONTEXT, vehicleInput('op-A', 'Car A'))
  await repo.create(SYSTEM_CONTEXT, vehicleInput('op-B', 'Car B'))
  return new VehicleService(repo, testResolveWriteOperatorId(), '')
}

describe('VehicleService.findAll — privileged-tier picker narrow (#1230 slice 5b)', () => {
  it('narrows a PLATFORM_ADMIN to the requested operator', async () => {
    const { total, data } = await (await service()).findAll(admin, {}, 'op-A')
    expect(total).toBe(1)
    expect(data.map((v) => v.operatorId)).toEqual(['op-A'])
  })

  it('does NOT narrow a renter — the public catalog stays whole', async () => {
    const { total } = await (await service()).findAll(renter, {}, 'op-A')
    expect(total).toBe(2)
  })

  it('does NOT narrow a partner', async () => {
    const { total } = await (await service()).findAll(partner, {}, 'op-A')
    expect(total).toBe(2)
  })

  it('does NOT narrow legacy STAFF or ADMIN (not the platform tier)', async () => {
    const staff: CallerContext = { userId: 's', role: 'STAFF' }
    const legacyAdmin: CallerContext = { userId: 'a2', role: 'ADMIN' }
    expect((await (await service()).findAll(staff, {}, 'op-A')).total).toBe(2)
    expect((await (await service()).findAll(legacyAdmin, {}, 'op-A')).total).toBe(2)
  })

  it('a tenant operator cannot widen via a foreign operatorId', async () => {
    const { total, data } = await (await service()).findAll(opA, {}, 'op-B')
    expect(total).toBe(1)
    expect(data.map((v) => v.operatorId)).toEqual(['op-A'])
  })
})
