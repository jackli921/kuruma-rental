import { operators, vehicles } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import { DEFAULT_DAILY_RATE_JPY, db } from './setup'

// #1230 slice 5b: the picker admin's vehicle narrowing, proven against real Postgres
// at the repo layer. A bypass admin (operatorReadScope `all`) narrows via
// VehicleFilters.operatorId; the gate applies it ONLY for an `all` scope, so a tenant
// operator passing a foreign id stays clamped (H2).
describe('vehicle findAll operator narrowing (#1230 slice 5b, Drizzle, real Postgres)', () => {
  const repo = new DrizzleVehicleRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `veh_narrow_a_${uniq}`
  const opBId = `veh_narrow_b_${uniq}`
  let vehAId: string
  let vehBId: string

  const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
  const opB: CallerContext = {
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId: opBId,
    bypassScope: false,
  }

  async function seedVehicle(opId: string, name: string): Promise<string> {
    const v = await repo.create(SYSTEM_CONTEXT, {
      operatorId: opId,
      classId: null,
      name,
      description: null,
      photos: [],
      seats: 5,
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
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    })
    return v.id
  }

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `veh-narrow-a-${uniq}`, name: 'Veh Narrow A' },
      { id: opBId, slug: `veh-narrow-b-${uniq}`, name: 'Veh Narrow B' },
    ])
    vehAId = await seedVehicle(opAId, 'Narrow Car A')
    vehBId = await seedVehicle(opBId, 'Narrow Car B')
  })

  afterAll(async () => {
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('an all-scope admin with no narrow sees both operators (control)', async () => {
    const { data } = await repo.findAll(admin)
    const ids = data.map((v) => v.id)
    expect(ids).toContain(vehAId)
    expect(ids).toContain(vehBId)
  })

  it('an all-scope admin narrows to just the requested operator', async () => {
    const { data } = await repo.findAll(admin, { operatorId: opAId })
    const ids = data.map((v) => v.id)
    expect(ids).toContain(vehAId)
    expect(ids).not.toContain(vehBId)
    expect(data.every((v) => v.operatorId === opAId)).toBe(true)
  })

  it('a tenant operator cannot widen via a foreign operatorId (H2)', async () => {
    const { data } = await repo.findAll(opB, { operatorId: opAId })
    expect(data.every((v) => v.operatorId === opBId)).toBe(true)
    expect(data.map((v) => v.id)).not.toContain(vehAId)
  })
})
