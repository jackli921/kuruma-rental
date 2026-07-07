import { insuranceOptions, operators } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, PUBLIC_CONTEXT, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { pgErrorCode } from '../../src/pg-errors'
import { DrizzleInsuranceOptionRepository } from '../../src/repositories/drizzle'
import { InsuranceOptionService } from '../../src/services/insurance-option'
import type { InsuranceOption } from '../../src/stores'
import { db } from './setup'

// Insurance options are operator-private config (#404). This proves, against
// real Postgres: tenant-scope filtering, the management-read seal (RENTER
// rejected, NOT served all-operators), the FK on operatorId, the PARTIAL
// active-name unique index (two ACTIVE same name -> 23505; archive frees it),
// and the service write-isolation seal (cross-tenant -> 404).

const ctxFor = (operatorId: string): CallerContext => ({
  userId: 'owner',
  role: 'OPERATOR_OWNER',
  operatorId,
  bypassScope: false,
})

// Faithful repo-level fixture (#1437): the entity carries both the `name` mirror
// and the self-authored `nameI18n` bundle (en = the mirror), so a Drizzle write
// that drops the jsonb column is observable on read-back.
const optionInput = (
  operatorId: string,
  name: string,
): Omit<InsuranceOption, 'id' | 'createdAt' | 'updatedAt'> => ({
  operatorId,
  name,
  nameI18n: { en: name },
  description: null,
  dailyPriceJpy: 1500,
  deductibleJpy: 150000,
  status: 'ACTIVE',
})

const PG_UNIQUE_VIOLATION = '23505'
const PG_FK_VIOLATION = '23503'
const violationCode = (p: Promise<unknown>): Promise<string | null> =>
  p.then(
    () => null,
    (err) => pgErrorCode(err),
  )

describe('cross-operator insurance-option isolation (Drizzle)', () => {
  const repo = new DrizzleInsuranceOptionRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_ins_a_${uniq}`
  const opBId = `op_ins_b_${uniq}`
  let optionA: InsuranceOption
  let optionB: InsuranceOption

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `ins-a-${uniq}`, name: 'Ins Operator A' },
      { id: opBId, slug: `ins-b-${uniq}`, name: 'Ins Operator B' },
    ])
    optionA = await repo.create(optionInput(opAId, 'Premium'))
    optionB = await repo.create(optionInput(opBId, 'Premium'))
  })

  afterAll(async () => {
    await db.delete(insuranceOptions).where(inArray(insuranceOptions.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('stamps the requested operatorId on each tenant write', () => {
    expect(optionA.operatorId).toBe(opAId)
    expect(optionB.operatorId).toBe(opBId)
  })

  it('two operators may both own an option with the same name', () => {
    expect(optionA.name).toBe('Premium')
    expect(optionB.name).toBe('Premium')
    expect(optionA.id).not.toBe(optionB.id)
  })

  it('findAll returns only the scoped tenant options', async () => {
    const ids = (await repo.findAll(ctxFor(opAId))).map((o) => o.id)
    expect(ids).toContain(optionA.id)
    expect(ids).not.toContain(optionB.id)
  })

  it('findById cannot reach another tenant option', async () => {
    const ctxA = ctxFor(opAId)
    expect(await repo.findById(ctxA, optionA.id)).toMatchObject({ id: optionA.id })
    expect(await repo.findById(ctxA, optionB.id)).toBeUndefined()
  })

  it('an OPERATOR_* caller with no tenant claim sees nothing (fail-closed)', async () => {
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    expect(await repo.findAll(noTenant)).toHaveLength(0)
    expect(await repo.findById(noTenant, optionA.id)).toBeUndefined()
  })

  it('SYSTEM_CONTEXT reads options across operators', async () => {
    const ids = (await repo.findAll(SYSTEM_CONTEXT)).map((o) => o.id)
    expect(ids).toContain(optionA.id)
    expect(ids).toContain(optionB.id)
  })

  // [P0] a RENTER must be rejected, NOT served every operator's config.
  it('[P0] a RENTER read throws Forbidden (NOT all-operators)', async () => {
    await expect(repo.findAll(PUBLIC_CONTEXT)).rejects.toThrow('management read scope required')
    await expect(repo.findById(PUBLIC_CONTEXT, optionA.id)).rejects.toThrow(
      'management read scope required',
    )
  })
})

describe('insurance-option FK + active-name uniqueness (Drizzle)', () => {
  const repo = new DrizzleInsuranceOptionRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_insu_a_${uniq}`

  beforeAll(async () => {
    await db
      .insert(operators)
      .values([{ id: opAId, slug: `insu-a-${uniq}`, name: 'InsU Operator A' }])
    await repo.create(optionInput(opAId, 'Standard'))
  })

  afterAll(async () => {
    await db.delete(insuranceOptions).where(inArray(insuranceOptions.operatorId, [opAId]))
    await db.delete(operators).where(inArray(operators.id, [opAId]))
  })

  it('rejects an option whose operatorId has no operator row (23503)', async () => {
    expect(await violationCode(repo.create(optionInput(`op_missing_${uniq}`, 'Orphan')))).toBe(
      PG_FK_VIOLATION,
    )
  })

  it('rejects a second ACTIVE option with the same (operatorId, name) (23505 on the partial index)', async () => {
    expect(await violationCode(repo.create(optionInput(opAId, 'Standard')))).toBe(
      PG_UNIQUE_VIOLATION,
    )
  })

  it('archiving an option then creating a new one with the same name succeeds (name freed)', async () => {
    const created = await repo.create(optionInput(opAId, 'Seasonal'))
    await repo.archive(ctxFor(opAId), created.id)
    const recreated = await repo.create(optionInput(opAId, 'Seasonal'))
    expect(recreated.name).toBe('Seasonal')
    expect(recreated.status).toBe('ACTIVE')
    expect(recreated.id).not.toBe(created.id)
  })
})

// Write isolation lives in InsuranceOptionService via its caller-scoped
// findById. Probe that seal against real Postgres: operator B must not mutate
// operator A's option. Resolves to 404 (no cross-tenant existence leak).
describe('cross-operator insurance-option WRITE denial (service seal, #404)', () => {
  const repo = new DrizzleInsuranceOptionRepository(db)
  const service = new InsuranceOptionService(repo)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_insw_a_${uniq}`
  const opBId = `op_insw_b_${uniq}`
  let optionA: InsuranceOption

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `insw-a-${uniq}`, name: 'InsW Operator A' },
      { id: opBId, slug: `insw-b-${uniq}`, name: 'InsW Operator B' },
    ])
    optionA = await repo.create(optionInput(opAId, 'Premium'))
  })

  afterAll(async () => {
    await db.delete(insuranceOptions).where(inArray(insuranceOptions.operatorId, [opAId, opBId]))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('operator B cannot update operator A option (404, row untouched)', async () => {
    const res = await service.update(
      ctxFor(opBId),
      optionA.id,
      { nameI18n: { en: 'hijacked' } },
      'en',
    )
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Insurance option not found' })
    expect(await repo.findById(SYSTEM_CONTEXT, optionA.id)).toMatchObject({ name: 'Premium' })
  })

  it('operator B cannot archive operator A option (404, still ACTIVE)', async () => {
    const res = await service.archive(ctxFor(opBId), optionA.id, 'en')
    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(await repo.findById(SYSTEM_CONTEXT, optionA.id)).toMatchObject({ status: 'ACTIVE' })
  })

  it('operator A can update its own option', async () => {
    const res = await service.update(ctxFor(opAId), optionA.id, { dailyPriceJpy: 2000 }, 'en')
    expect(res).toMatchObject({ ok: true, option: { dailyPriceJpy: 2000 } })
  })

  // [#1437 R-2] The Drizzle create MUST enumerate nameI18n in .values(); a dropped
  // column persists null in Postgres while the in-memory repo keeps it (spreads
  // ...data), so this round-trip is the ONLY layer that catches the regression.
  it('[#1437] service create round-trips nameI18n through Postgres and mirrors name = en', async () => {
    const res = await service.create(
      ctxFor(opAId),
      {
        operatorId: opAId,
        nameI18n: { en: 'Gold', ja: 'ゴールド', zh: '黄金' },
        description: null,
        dailyPriceJpy: 1500,
        deductibleJpy: null,
      },
      'en',
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // Read back with a FRESH SELECT (not the create return) to prove Postgres stored it.
    const readBack = await repo.findById(SYSTEM_CONTEXT, res.option.id)
    expect(readBack?.nameI18n).toEqual({ en: 'Gold', ja: 'ゴールド', zh: '黄金' })
    expect(readBack?.name).toBe('Gold')
  })

  // A legacy row (nameI18n null) must survive the round-trip so the resolver can
  // fall back to the `name` mirror — the additive column can't break existing data.
  it('[#1437] a null nameI18n round-trips as null (legacy floor preserved)', async () => {
    const created = await repo.create({
      operatorId: opAId,
      name: 'LegacyCover',
      nameI18n: null,
      description: null,
      dailyPriceJpy: 900,
      deductibleJpy: null,
      status: 'ACTIVE',
    })
    const readBack = await repo.findById(SYSTEM_CONTEXT, created.id)
    expect(readBack?.nameI18n).toBeNull()
    expect(readBack?.name).toBe('LegacyCover')
  })

  it('[#1271] a direct repo update cannot migrate the row to another operator', async () => {
    // Repo-layer anchor: even a caller that bypasses the service scope check (a
    // future second caller) cannot repoint operatorId via the update payload.
    const updated = await repo.update(ctxFor(opAId), optionA.id, {
      operatorId: opBId,
      dailyPriceJpy: 4321,
    })
    expect(updated?.operatorId).toBe(opAId)
    expect(updated?.dailyPriceJpy).toBe(4321)
    expect(await repo.findById(SYSTEM_CONTEXT, optionA.id)).toMatchObject({
      operatorId: opAId,
      dailyPriceJpy: 4321,
    })
  })
})
