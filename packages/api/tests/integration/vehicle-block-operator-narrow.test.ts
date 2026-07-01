import { operators, vehicleBlocks, vehicles } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleVehicleBlockRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { DEFAULT_DAILY_RATE_JPY, db } from './setup'

// #1230 slice 5b: the picker admin's block narrowing, proven against real Postgres.
describe('vehicle-block findOverlappingInRange operator narrowing (#1230 slice 5b, Drizzle)', () => {
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const blockRepo = new DrizzleVehicleBlockRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `blk_narrow_a_${uniq}`
  const opBId = `blk_narrow_b_${uniq}`
  const FROM = new Date('2027-11-01T00:00:00Z')
  const TO = new Date('2027-11-02T00:00:00Z')

  const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }

  async function seed(opId: string): Promise<void> {
    const v = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: opId,
      classId: null,
      name: 'Blk Car',
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
    await blockRepo.create({
      operatorId: opId,
      vehicleId: v.id,
      startAt: new Date('2027-11-01T09:00:00Z'),
      endAt: new Date('2027-11-01T17:00:00Z'),
      kind: 'MAINTENANCE',
      reason: 'shaken',
      notes: null,
      createdBy: 'u',
    })
  }

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `blk-narrow-a-${uniq}`, name: 'Blk Narrow A' },
      { id: opBId, slug: `blk-narrow-b-${uniq}`, name: 'Blk Narrow B' },
    ])
    await seed(opAId)
    await seed(opBId)
  })

  afterAll(async () => {
    await db.delete(vehicleBlocks).where(inArray(vehicleBlocks.operatorId, [opAId, opBId]))
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('an all-scope admin narrows to just the requested operator', async () => {
    const rows = await blockRepo.findOverlappingInRange(admin, FROM, TO, opAId)
    expect(rows.every((b) => b.operatorId === opAId)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('an all-scope admin with no narrow sees both operators', async () => {
    const rows = await blockRepo.findOverlappingInRange(admin, FROM, TO)
    const ops = new Set(rows.map((b) => b.operatorId))
    expect(ops.has(opAId)).toBe(true)
    expect(ops.has(opBId)).toBe(true)
  })
})
