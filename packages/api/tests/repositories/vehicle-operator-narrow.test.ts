import { describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryVehicleRepository } from '../../src/repositories/in-memory/vehicle'
import type { Vehicle } from '../../src/stores'

// #1230 slice 5b: a picker admin (operatorReadScope `all`) narrows the vehicle
// list to one operator via VehicleFilters.operatorId. The gate applies the id
// ONLY in the `all` branch, so a tenant operator's own scope always wins.
const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
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

async function seedTwoOperators(): Promise<InMemoryVehicleRepository> {
  const repo = new InMemoryVehicleRepository()
  await repo.create(SYSTEM_CONTEXT, vehicleInput('op-A', 'Car A'))
  await repo.create(SYSTEM_CONTEXT, vehicleInput('op-B', 'Car B'))
  return repo
}

describe('vehicle findAll operator narrowing (#1230 slice 5b, repo gate)', () => {
  it('narrows an all-scope admin to the requested operator', async () => {
    const repo = await seedTwoOperators()
    const { data, total } = await repo.findAll(admin, { operatorId: 'op-A' })
    expect(total).toBe(1)
    expect(data.map((v) => v.operatorId)).toEqual(['op-A'])
  })

  it('an all-scope admin with no narrow sees both operators (control)', async () => {
    const repo = await seedTwoOperators()
    const { total } = await repo.findAll(admin)
    expect(total).toBe(2)
  })

  it('a tenant operator ignores a foreign operatorId (base scope wins, H2)', async () => {
    const repo = await seedTwoOperators()
    const { data, total } = await repo.findAll(opA, { operatorId: 'op-B' })
    expect(total).toBe(1)
    expect(data.map((v) => v.operatorId)).toEqual(['op-A'])
  })

  it('a scoped operator with no operatorId (none scope) sees nothing', async () => {
    const repo = await seedTwoOperators()
    const noneCtx: CallerContext = { userId: 'no', role: 'OPERATOR_OWNER' }
    const { total } = await repo.findAll(noneCtx, { operatorId: 'op-A' })
    expect(total).toBe(0)
  })
})
