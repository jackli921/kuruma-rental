import { operators, vehicleClasses, vehicles } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, ForbiddenError, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { pgErrorCode } from '../../src/pg-errors'
import {
  DrizzleBookingRepository,
  DrizzleMessageRepository,
  DrizzleThreadRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { VehicleClassService } from '../../src/services/vehicle-class'
import type { Vehicle, VehicleClass } from '../../src/stores'
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

// Vehicle-class reads are operator-scoped (#395): an OPERATOR_* caller only
// sees its own tenant's classes; a tenant-less operator fails closed; admins
// (SYSTEM_CONTEXT) read across operators. Exercised against real Postgres.
describe('cross-operator class isolation', () => {
  const classRepo = new DrizzleVehicleClassRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_cls_a_${uniq}`
  const opBId = `op_cls_b_${uniq}`
  const createdClassIds: string[] = []
  let classA: VehicleClass
  let classB: VehicleClass

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  const seedClass = (operatorId: string, suffix: string): Promise<VehicleClass> =>
    classRepo.create({
      operatorId,
      name: `Iso Class ${suffix}`,
      slug: `iso-class-${suffix}-${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `cls-a-${uniq}`, name: 'Class Operator A' },
      { id: opBId, slug: `cls-b-${uniq}`, name: 'Class Operator B' },
    ])
    classA = await seedClass(opAId, 'a')
    classB = await seedClass(opBId, 'b')
    createdClassIds.push(classA.id, classB.id)
  })

  afterAll(async () => {
    if (createdClassIds.length > 0) {
      await db.delete(vehicleClasses).where(inArray(vehicleClasses.id, createdClassIds))
    }
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('findAll returns only the scoped tenant classes', async () => {
    const ids = (await classRepo.findAll(ctxFor(opAId))).map((c) => c.id)
    expect(ids).toContain(classA.id)
    expect(ids).not.toContain(classB.id)
  })

  it('findById cannot reach another tenant class', async () => {
    const ctxA = ctxFor(opAId)
    expect(await classRepo.findById(ctxA, classA.id)).toMatchObject({ id: classA.id })
    expect(await classRepo.findById(ctxA, classB.id)).toBeUndefined()
  })

  it('findBySlug cannot reach another tenant class', async () => {
    const ctxA = ctxFor(opAId)
    expect(await classRepo.findBySlug(ctxA, classA.slug)).toMatchObject({ id: classA.id })
    expect(await classRepo.findBySlug(ctxA, classB.slug)).toBeUndefined()
  })

  it('an OPERATOR_* caller with no tenant claim sees nothing (fail-closed)', async () => {
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    expect(await classRepo.findAll(noTenant)).toHaveLength(0)
    expect(await classRepo.findById(noTenant, classA.id)).toBeUndefined()
    expect(await classRepo.findBySlug(noTenant, classA.slug)).toBeUndefined()
  })

  it('SYSTEM_CONTEXT reads classes across operators', async () => {
    const ids = (await classRepo.findAll(SYSTEM_CONTEXT)).map((c) => c.id)
    expect(ids).toContain(classA.id)
    expect(ids).toContain(classB.id)
  })
})

// Composite FK seal (#395 Phase 2): a vehicle's classId must belong to the
// vehicle's own operator. Enforced at the DB by FK vehicles(operatorId,classId)
// -> vehicle_classes(operatorId,id). A NULL classId stays allowed (MATCH SIMPLE),
// so an unassigned vehicle is fine. Covers create AND update (reassign on edit).
describe('vehicle classId is sealed to the vehicle’s operator (composite FK)', () => {
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const classRepo = new DrizzleVehicleClassRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_fk_a_${uniq}`
  const opBId = `op_fk_b_${uniq}`
  let classA: VehicleClass
  let classB: VehicleClass

  const makeClass = (operatorId: string, suffix: string): Promise<VehicleClass> =>
    classRepo.create({
      operatorId,
      name: `FK Class ${suffix}`,
      slug: `fk-class-${suffix}-${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })

  const vehicleInput = (operatorId: string, classId: string | null) => ({
    operatorId,
    classId,
    name: 'FK Vehicle',
    description: null,
    photos: [] as string[],
    seats: 5,
    transmission: 'AUTO' as const,
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE' as const,
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
      { id: opAId, slug: `fk-a-${uniq}`, name: 'FK Operator A' },
      { id: opBId, slug: `fk-b-${uniq}`, name: 'FK Operator B' },
    ])
    classA = await makeClass(opAId, 'a')
    classB = await makeClass(opBId, 'b')
  })

  // Delete by operatorId so any vehicle created by a still-failing assertion
  // (cross-tenant rows that wrongly succeed before the FK lands) is also removed.
  afterAll(async () => {
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  // Anchor to the PG foreign_key_violation code so the test cannot pass on an
  // unrelated error (e.g. a future NOT NULL column) while the cross-tenant seal
  // silently breaks. drizzle's err.message is just the failed SQL; the real PG
  // code lives at err.cause.code — pgErrorCode() reads both paths.
  const PG_FK_VIOLATION = '23503'
  const violationCode = (p: Promise<unknown>): Promise<string | null> =>
    p.then(
      () => null,
      (err) => pgErrorCode(err),
    )

  it('create rejects a class owned by another operator', async () => {
    expect(
      await violationCode(vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(opAId, classB.id))),
    ).toBe(PG_FK_VIOLATION)
  })

  it('create accepts the operator’s own class', async () => {
    const v = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(opAId, classA.id))
    expect(v.classId).toBe(classA.id)
  })

  it('create accepts a null class (unassigned vehicle)', async () => {
    const v = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(opAId, null))
    expect(v.classId).toBeNull()
  })

  it('update rejects reassigning to another operator’s class', async () => {
    const v = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(opAId, null))
    expect(
      await violationCode(vehicleRepo.update(SYSTEM_CONTEXT, v.id, { classId: classB.id })),
    ).toBe(PG_FK_VIOLATION)
  })

  it('update accepts reassigning to the operator’s own class', async () => {
    const v = await vehicleRepo.create(SYSTEM_CONTEXT, vehicleInput(opAId, null))
    const updated = await vehicleRepo.update(SYSTEM_CONTEXT, v.id, { classId: classA.id })
    expect(updated?.classId).toBe(classA.id)
  })
})

// #397 opens class writes to OPERATOR_* at the route. Class repo writes take no
// ctx (no repo-layer guard), so the tenant seal for class update/archive lives
// in VehicleClassService.{update,archive} via its caller-scoped findById. This
// probes that seal against real Postgres: if an operator could mutate another
// tenant's class, the service-layer boundary would be a real bypass and we'd
// need a repo-layer guard. It must resolve to 404, leaving the row untouched.
describe('cross-operator class WRITE denial (service seal, #397)', () => {
  const classRepo = new DrizzleVehicleClassRepository(db)
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const bookingRepo = new DrizzleBookingRepository(db)
  const service = new VehicleClassService(classRepo, vehicleRepo, bookingRepo)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_clsw_a_${uniq}`
  const opBId = `op_clsw_b_${uniq}`
  const createdClassIds: string[] = []
  let classA: VehicleClass

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `clsw-a-${uniq}`, name: 'ClsW Operator A' },
      { id: opBId, slug: `clsw-b-${uniq}`, name: 'ClsW Operator B' },
    ])
    classA = await classRepo.create({
      operatorId: opAId,
      name: 'ClsW Class A',
      slug: `clsw-a-${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })
    createdClassIds.push(classA.id)
  })

  afterAll(async () => {
    if (createdClassIds.length > 0) {
      await db.delete(vehicleClasses).where(inArray(vehicleClasses.id, createdClassIds))
    }
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('operator B cannot update operator A class (404, row untouched)', async () => {
    const res = await service.update(ctxFor(opBId), classA.id, { name: 'hijacked' })
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Vehicle class not found' })
    expect(await classRepo.findById(SYSTEM_CONTEXT, classA.id)).toMatchObject({
      name: 'ClsW Class A',
    })
  })

  it('operator B cannot archive operator A class (404, still ACTIVE)', async () => {
    const res = await service.archive(ctxFor(opBId), classA.id)
    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(await classRepo.findById(SYSTEM_CONTEXT, classA.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('operator A can update its own class', async () => {
    const res = await service.update(ctxFor(opAId), classA.id, { name: 'ClsW Class A v2' })
    expect(res).toMatchObject({ ok: true, vehicleClass: { name: 'ClsW Class A v2' } })
  })
})
