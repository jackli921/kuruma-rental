import { feeSchedules, operators, vehicleClasses } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { pgErrorCode } from '../../src/pg-errors'
import { DrizzleFeeScheduleRepository } from '../../src/repositories/drizzle'
import { FeeScheduleService } from '../../src/services/fee-schedule'
import type { FeeSchedule } from '../../src/stores'
import { db } from './setup'

// Fee schedules are operator-scoped (#405). Mirrors the locations isolation
// suite plus the vehicle-class composite-FK suite. Exercised against real
// Postgres so the partial unique indexes and the composite FK are proven, not
// just the in-memory stand-in.

const PG_UNIQUE_VIOLATION = '23505'
const PG_FOREIGN_KEY_VIOLATION = '23503'
const violationCode = (p: Promise<unknown>): Promise<string | null> =>
  p.then(
    () => null,
    (err) => pgErrorCode(err),
  )

const ctxFor = (operatorId: string): CallerContext => ({
  userId: 'owner',
  role: 'OPERATOR_OWNER',
  operatorId,
  bypassScope: false,
})

const feeInput = (
  operatorId: string,
  overrides?: Partial<FeeSchedule>,
): Omit<FeeSchedule, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId,
  vehicleClassId: null,
  feeType: 'CLEANING_FLAT',
  unit: 'FLAT',
  amountJpy: 3000,
  status: 'ACTIVE',
  ...overrides,
})

async function seedClass(operatorId: string, uniq: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(vehicleClasses).values({
    id,
    operatorId,
    name: `Class ${uniq}`,
    slug: `fee-class-${uniq}`,
    seats: 5,
    luggageCapacity: 2,
    transmission: 'AUTO',
    dailyRateJpy: 5000,
    status: 'ACTIVE',
  })
  return id
}

describe('cross-operator fee-schedule isolation + uniqueness (Drizzle)', () => {
  const repo = new DrizzleFeeScheduleRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_fee_a_${uniq}`
  const opBId = `op_fee_b_${uniq}`
  let feeA: FeeSchedule
  let feeB: FeeSchedule

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `fee-a-${uniq}`, name: 'Fee Operator A' },
      { id: opBId, slug: `fee-b-${uniq}`, name: 'Fee Operator B' },
    ])
    // Both tenants get a CLEANING_FLAT operator-wide fee to prove uniqueness is
    // per-operator (NULL != NULL would otherwise let only one exist globally).
    feeA = await repo.create(feeInput(opAId))
    feeB = await repo.create(feeInput(opBId))
  })

  afterAll(async () => {
    await db.delete(feeSchedules).where(inArray(feeSchedules.operatorId, [opAId, opBId]))
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('stamps the requested operatorId on each tenant write', () => {
    expect(feeA.operatorId).toBe(opAId)
    expect(feeB.operatorId).toBe(opBId)
  })

  it('two operators may both own a CLEANING_FLAT operator-wide fee', () => {
    expect(feeA.feeType).toBe('CLEANING_FLAT')
    expect(feeB.feeType).toBe('CLEANING_FLAT')
    expect(feeA.id).not.toBe(feeB.id)
  })

  it('findAll returns only the scoped tenant fees', async () => {
    const ids = (await repo.findAll(ctxFor(opAId))).map((f) => f.id)
    expect(ids).toContain(feeA.id)
    expect(ids).not.toContain(feeB.id)
  })

  it('findById cannot reach another tenant fee', async () => {
    const ctxA = ctxFor(opAId)
    expect(await repo.findById(ctxA, feeA.id)).toMatchObject({ id: feeA.id })
    expect(await repo.findById(ctxA, feeB.id)).toBeUndefined()
  })

  it('an OPERATOR_* caller with no tenant claim sees nothing (fail-closed)', async () => {
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    expect(await repo.findAll(noTenant)).toHaveLength(0)
    expect(await repo.findById(noTenant, feeA.id)).toBeUndefined()
  })

  it('SYSTEM_CONTEXT reads fees across operators', async () => {
    const ids = (await repo.findAll(SYSTEM_CONTEXT)).map((f) => f.id)
    expect(ids).toContain(feeA.id)
    expect(ids).toContain(feeB.id)
  })
})

describe('fee-schedule operator-wide active-uniqueness sealed at the DB (23505)', () => {
  const repo = new DrizzleFeeScheduleRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opId = `op_feeu_${uniq}`

  beforeAll(async () => {
    await db.insert(operators).values({ id: opId, slug: `feeu-${uniq}`, name: 'FeeU Operator' })
    await repo.create(feeInput(opId, { feeType: 'NO_FUEL_FLAT', amountJpy: 5000 }))
  })

  afterAll(async () => {
    await db.delete(feeSchedules).where(inArray(feeSchedules.operatorId, [opId]))
    await db.delete(operators).where(inArray(operators.id, [opId]))
  })

  it('rejects a second ACTIVE operator-wide fee of the same type (partial unique)', async () => {
    expect(
      await violationCode(
        repo.create(feeInput(opId, { feeType: 'NO_FUEL_FLAT', amountJpy: 6000 })),
      ),
    ).toBe(PG_UNIQUE_VIOLATION)
  })

  it('archiving frees the operator-wide slot (re-create succeeds)', async () => {
    const [active] = await repo.findAll(ctxFor(opId), { feeType: 'NO_FUEL_FLAT' })
    if (!active) throw new Error('seed missing')
    await repo.archive(ctxFor(opId), active.id)
    const recreated = await repo.create(
      feeInput(opId, { feeType: 'NO_FUEL_FLAT', amountJpy: 7000 }),
    )
    expect(recreated.feeType).toBe('NO_FUEL_FLAT')
    expect(recreated.status).toBe('ACTIVE')
  })
})

describe('fee-schedule per-class active-uniqueness sealed at the DB (23505)', () => {
  const repo = new DrizzleFeeScheduleRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opId = `op_feec_${uniq}`
  let classId: string

  beforeAll(async () => {
    await db.insert(operators).values({ id: opId, slug: `feec-${uniq}`, name: 'FeeC Operator' })
    classId = await seedClass(opId, uniq)
    await repo.create(
      feeInput(opId, {
        feeType: 'OVERTIME_HOURLY',
        unit: 'PER_HOUR',
        vehicleClassId: classId,
        amountJpy: 500,
      }),
    )
  })

  afterAll(async () => {
    await db.delete(feeSchedules).where(inArray(feeSchedules.operatorId, [opId]))
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opId]))
    await db.delete(operators).where(inArray(operators.id, [opId]))
  })

  it('rejects a second ACTIVE per-class fee of the same (type, class)', async () => {
    expect(
      await violationCode(
        repo.create(
          feeInput(opId, {
            feeType: 'OVERTIME_HOURLY',
            unit: 'PER_HOUR',
            vehicleClassId: classId,
            amountJpy: 700,
          }),
        ),
      ),
    ).toBe(PG_UNIQUE_VIOLATION)
  })

  it('allows an operator-wide fee of the same type alongside the per-class one', async () => {
    const wide = await repo.create(
      feeInput(opId, {
        feeType: 'OVERTIME_HOURLY',
        unit: 'PER_HOUR',
        vehicleClassId: null,
        amountJpy: 400,
      }),
    )
    expect(wide.vehicleClassId).toBeNull()
  })
})

describe('fee-schedule composite FK seals per-class fee to its own operator (23503)', () => {
  const repo = new DrizzleFeeScheduleRepository(db)
  const service = new FeeScheduleService(repo)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_feefk_a_${uniq}`
  const opBId = `op_feefk_b_${uniq}`
  let classB: string

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `feefk-a-${uniq}`, name: 'FeeFK Operator A' },
      { id: opBId, slug: `feefk-b-${uniq}`, name: 'FeeFK Operator B' },
    ])
    // A class owned by operator B.
    classB = await seedClass(opBId, uniq)
  })

  afterAll(async () => {
    await db.delete(feeSchedules).where(inArray(feeSchedules.operatorId, [opAId, opBId]))
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it("rejects operator A's fee that points at operator B's class (23503)", async () => {
    expect(
      await violationCode(
        repo.create(
          feeInput(opAId, {
            feeType: 'OVERTIME_HOURLY',
            unit: 'PER_HOUR',
            vehicleClassId: classB,
            amountJpy: 500,
          }),
        ),
      ),
    ).toBe(PG_FOREIGN_KEY_VIOLATION)
  })

  it("maps operator A's cross-tenant class fee to 400 INVALID_VEHICLE_CLASS at the service", async () => {
    const res = await service.create(
      ctxFor(opAId),
      feeInput(opAId, {
        feeType: 'OVERTIME_HOURLY',
        unit: 'PER_HOUR',
        vehicleClassId: classB,
        amountJpy: 500,
      }),
    )
    expect(res).toMatchObject({ ok: false, status: 400, code: 'INVALID_VEHICLE_CLASS' })
  })

  it('accepts a fee pointing at the operator B class under operator B', async () => {
    const fee = await repo.create(
      feeInput(opBId, {
        feeType: 'OVERTIME_HOURLY',
        unit: 'PER_HOUR',
        vehicleClassId: classB,
        amountJpy: 500,
      }),
    )
    expect(fee.vehicleClassId).toBe(classB)
    expect(fee.operatorId).toBe(opBId)
  })
})

// Fee writes (update/archive) take no ctx at the repo; the tenant seal lives in
// FeeScheduleService via its caller-scoped findById. Probe that seal against
// real Postgres: operator B must not mutate operator A's fee -> 404, row intact.
describe('cross-operator fee-schedule WRITE denial (service seal)', () => {
  const repo = new DrizzleFeeScheduleRepository(db)
  const service = new FeeScheduleService(repo)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_feew_a_${uniq}`
  const opBId = `op_feew_b_${uniq}`
  let feeA: FeeSchedule

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `feew-a-${uniq}`, name: 'FeeW Operator A' },
      { id: opBId, slug: `feew-b-${uniq}`, name: 'FeeW Operator B' },
    ])
    feeA = await repo.create(feeInput(opAId, { feeType: 'CLEANING_FLAT', amountJpy: 3000 }))
  })

  afterAll(async () => {
    await db.delete(feeSchedules).where(inArray(feeSchedules.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('operator B cannot update operator A fee (404, amount untouched)', async () => {
    const res = await service.update(ctxFor(opBId), feeA.id, { amountJpy: 99999 })
    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(await repo.findById(SYSTEM_CONTEXT, feeA.id)).toMatchObject({ amountJpy: 3000 })
  })

  it('operator A can update its own fee', async () => {
    const res = await service.update(ctxFor(opAId), feeA.id, { amountJpy: 3500 })
    expect(res).toMatchObject({ ok: true, feeSchedule: { amountJpy: 3500 } })
  })

  it('[#1271] a direct repo update cannot migrate the row to another operator', async () => {
    // Repo-layer anchor: even a caller that bypasses the service scope check (a
    // future second caller) cannot repoint operatorId via the update payload.
    const updated = await repo.update(ctxFor(opAId), feeA.id, {
      operatorId: opBId,
      amountJpy: 4321,
    })
    expect(updated?.operatorId).toBe(opAId)
    expect(updated?.amountJpy).toBe(4321)
    expect(await repo.findById(SYSTEM_CONTEXT, feeA.id)).toMatchObject({
      operatorId: opAId,
      amountJpy: 4321,
    })
  })
})
