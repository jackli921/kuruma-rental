import { operators, vehicleBlocks, vehicles } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleVehicleBlockRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { VehicleBlockService } from '../../src/services/vehicle-block'
import { DEFAULT_DAILY_RATE_JPY, db } from './setup'

// #1260: proven against real Postgres — a platform-admin resolves ANY operator's
// vehicle by raw id (operatorReadScope → all), so the block-write service must bind
// the write to the operator the admin is acting as. Without the guard the admin
// could create/remove a block on any operator's car despite the read-only web UI.
describe('VehicleBlockService write acting-operator binding (#1260, Drizzle)', () => {
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const blockRepo = new DrizzleVehicleBlockRepository(db)
  // The reverse block→booking conflict lookup is orthogonal here; no bookings exist.
  const service = new VehicleBlockService(vehicleRepo, blockRepo, {
    findActiveOverlappingForVehicle: async () => [],
  })

  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `blk_write_a_${uniq}`
  const opBId = `blk_write_b_${uniq}`
  const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }

  const input = {
    kind: 'MAINTENANCE' as const,
    reason: 'shaken',
    startAt: '2027-11-01T09:00:00.000Z',
    endAt: '2027-11-01T17:00:00.000Z',
  }

  let vehicleAId: string

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `blk-write-a-${uniq}`, name: 'Blk Write A' },
      { id: opBId, slug: `blk-write-b-${uniq}`, name: 'Blk Write B' },
    ])
    const v = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: opAId,
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
    vehicleAId = v.id
  })

  afterAll(async () => {
    await db.delete(vehicleBlocks).where(inArray(vehicleBlocks.operatorId, [opAId, opBId]))
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('confirms the precondition: an admin resolves the foreign vehicle by raw id (the hole)', async () => {
    const resolved = await vehicleRepo.findById(admin, vehicleAId)
    expect(resolved?.operatorId).toBe(opAId)
  })

  it('rejects an admin creating a block with no acting operator (422)', async () => {
    const result = await service.createBlock(admin, vehicleAId, input)
    expect(result).toMatchObject({ ok: false, status: 422 })
  })

  it('rejects an admin whose acting operator does not own the vehicle (404)', async () => {
    const result = await service.createBlock(admin, vehicleAId, input, opBId)
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('creates the block when the admin acts as the owning operator (op-A)', async () => {
    const result = await service.createBlock(admin, vehicleAId, input, opAId)
    expect(result).toMatchObject({ ok: true, block: { operatorId: opAId, vehicleId: vehicleAId } })
  })

  it('rejects an admin deleting a block with no acting operator, then removes it when acting as op-A', async () => {
    const created = await blockRepo.create({
      operatorId: opAId,
      vehicleId: vehicleAId,
      startAt: new Date('2027-12-01T09:00:00Z'),
      endAt: new Date('2027-12-01T17:00:00Z'),
      kind: 'MAINTENANCE',
      reason: 'to-remove',
      notes: null,
      createdBy: 'seed',
    })

    const denied = await service.deleteBlock(admin, vehicleAId, created.id)
    expect(denied).toMatchObject({ ok: false, status: 422 })
    expect(await blockRepo.findById(created.id)).toBeDefined()

    const removed = await service.deleteBlock(admin, vehicleAId, created.id, opAId)
    expect(removed).toMatchObject({ ok: true })
    expect(await blockRepo.findById(created.id)).toBeUndefined()
  })
})
