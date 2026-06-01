import { operators, vehicles } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, ForbiddenError, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzleMessageRepository,
  DrizzleThreadRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import type { Vehicle } from '../../src/stores'
import { DEFAULT_DAILY_RATE_JPY, db } from './setup'

// An OPERATOR_* caller scoped to one tenant must never observe another
// tenant's vehicles, and repos not yet operator-scoped in slice 1 (#386) must
// fail closed rather than leak across tenants. Exercised against real Postgres.

const operatorCtx: CallerContext = {
  userId: 'op-user',
  role: 'OPERATOR_OWNER',
  operatorId: 'op_a',
  bypassScope: false,
}

type Invocation = readonly [method: string, run: () => Promise<unknown>]

describe('booking/message/thread repos reject OPERATOR_* until scoped (Drizzle)', () => {
  const booking = new DrizzleBookingRepository(db)
  const thread = new DrizzleThreadRepository(db)
  const message = new DrizzleMessageRepository(db)

  const cases: ReadonlyArray<readonly [repoName: string, invocations: Invocation[]]> = [
    [
      'BookingRepository',
      [
        ['findAll', () => booking.findAll(operatorCtx)],
        ['findById', () => booking.findById(operatorCtx, 'b1')],
        ['findByIdempotencyKey', () => booking.findByIdempotencyKey(operatorCtx, 'k1')],
        // biome-ignore lint/suspicious/noExplicitAny: throwaway stub; guard throws first
        ['create', () => booking.create(operatorCtx, {} as any)],
        [
          'updateStatus',
          () => booking.updateStatus(operatorCtx, 'b1', { from: 'CONFIRMED', to: 'ACTIVE' }),
        ],
        [
          'cancel',
          () =>
            booking.cancel(operatorCtx, 'b1', {
              from: 'CONFIRMED',
              fee: 0,
              cancelledAt: new Date(),
            }),
        ],
      ],
    ],
    [
      'ThreadRepository',
      [
        ['findAll', () => thread.findAll(operatorCtx)],
        ['findById', () => thread.findById(operatorCtx, 't1')],
        ['findByIdempotencyKey', () => thread.findByIdempotencyKey(operatorCtx, 'k1')],
        ['create', () => thread.create(operatorCtx, null, ['u1'])],
        ['markAsRead', () => thread.markAsRead(operatorCtx, 't1')],
      ],
    ],
    [
      'MessageRepository',
      [
        ['findById', () => message.findById(operatorCtx, 'm1')],
        ['findByIdempotencyKey', () => message.findByIdempotencyKey(operatorCtx, 'k1')],
        ['create', () => message.create(operatorCtx, 't1', 'hi')],
        ['findByThreadId', () => message.findByThreadId(operatorCtx, 't1')],
      ],
    ],
  ]

  for (const [repoName, invocations] of cases) {
    describe(repoName, () => {
      it.each(invocations)('%s throws ForbiddenError naming the repo', async (_method, run) => {
        await expect(run()).rejects.toThrow(ForbiddenError)
        await expect(run()).rejects.toThrow(`${repoName} not yet operator-scoped`)
      })
    })
  }
})

describe('cross-operator vehicle isolation', () => {
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_iso_a_${uniq}`
  const opBId = `op_iso_b_${uniq}`
  const createdVehicleIds: string[] = []
  let vehicleA: Vehicle
  let vehicleB: Vehicle

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  const seedVehicle = (operatorId: string, name: string): Promise<Vehicle> =>
    vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId,
      classId: null,
      name,
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
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `iso-a-${uniq}`, name: 'Iso Operator A' },
      { id: opBId, slug: `iso-b-${uniq}`, name: 'Iso Operator B' },
    ])
    vehicleA = await seedVehicle(opAId, 'Iso Car A')
    vehicleB = await seedVehicle(opBId, 'Iso Car B')
    createdVehicleIds.push(vehicleA.id, vehicleB.id)
  })

  afterAll(async () => {
    if (createdVehicleIds.length > 0) {
      await db.delete(vehicles).where(inArray(vehicles.id, createdVehicleIds))
    }
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('stamps the requested operatorId on each tenant write', () => {
    expect(vehicleA.operatorId).toBe(opAId)
    expect(vehicleB.operatorId).toBe(opBId)
  })

  it('findAll returns only the scoped tenant vehicles', async () => {
    const { data } = await vehicleRepo.findAll(ctxFor(opAId))
    const ids = data.map((v) => v.id)
    expect(ids).toContain(vehicleA.id)
    expect(ids).not.toContain(vehicleB.id)
    expect(data.every((v) => v.operatorId === opAId)).toBe(true)
  })

  it('findById cannot reach another tenant vehicle', async () => {
    const ctxA = ctxFor(opAId)
    expect(await vehicleRepo.findById(ctxA, vehicleA.id)).toMatchObject({ id: vehicleA.id })
    expect(await vehicleRepo.findById(ctxA, vehicleB.id)).toBeUndefined()
  })

  it('an OPERATOR_* caller with no tenant claim sees nothing (fail-closed)', async () => {
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    const { data } = await vehicleRepo.findAll(noTenant)
    expect(data).toHaveLength(0)
    expect(await vehicleRepo.findById(noTenant, vehicleA.id)).toBeUndefined()
  })

  // Writes are scoped at the repository, not just the route: an operator cannot
  // mutate another tenant's vehicle even by id (#386 F2). Run after the read
  // assertions above; the final case renames operator A's own vehicle.
  it('update cannot reach another tenant vehicle (no-op, not leak)', async () => {
    expect(
      await vehicleRepo.update(ctxFor(opAId), vehicleB.id, { name: 'hijacked' }),
    ).toBeUndefined()
    expect(await vehicleRepo.findById(SYSTEM_CONTEXT, vehicleB.id)).toMatchObject({
      name: 'Iso Car B',
    })
  })

  it('softDelete cannot reach another tenant vehicle', async () => {
    expect(await vehicleRepo.softDelete(ctxFor(opAId), vehicleB.id)).toBeUndefined()
    expect(await vehicleRepo.findById(SYSTEM_CONTEXT, vehicleB.id)).toMatchObject({
      status: 'AVAILABLE',
    })
  })

  it('bulkUpdateStatus skips another tenant vehicle', async () => {
    expect(await vehicleRepo.bulkUpdateStatus(ctxFor(opAId), [vehicleB.id], 'MAINTENANCE')).toEqual(
      [],
    )
  })

  it('an operator can update its own tenant vehicle', async () => {
    const updated = await vehicleRepo.update(ctxFor(opAId), vehicleA.id, { name: 'Iso Car A v2' })
    expect(updated).toMatchObject({ id: vehicleA.id, name: 'Iso Car A v2' })
  })
})
