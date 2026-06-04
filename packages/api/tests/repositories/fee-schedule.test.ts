import { beforeEach, describe, expect, it } from 'vitest'
import {
  type CallerContext,
  ForbiddenError,
  PUBLIC_CONTEXT,
  SYSTEM_CONTEXT,
} from '../../src/middleware/auth'
import { PG_ERROR } from '../../src/pg-errors'
import { InMemoryFeeScheduleRepository } from '../../src/repositories/in-memory'
import type { FeeSchedule } from '../../src/stores'

const opA = 'op_a'
const opB = 'op_b'

function feeInput(overrides?: Partial<FeeSchedule>) {
  return {
    operatorId: opA,
    vehicleClassId: null,
    feeType: 'CLEANING_FLAT' as const,
    unit: 'FLAT' as const,
    amountJpy: 3000,
    status: 'ACTIVE' as const,
    ...overrides,
  }
}

const ctxFor = (operatorId: string): CallerContext => ({
  userId: 'owner',
  role: 'OPERATOR_OWNER',
  operatorId,
  bypassScope: false,
})

describe('InMemoryFeeScheduleRepository — CRUD', () => {
  let repo: InMemoryFeeScheduleRepository

  beforeEach(() => {
    repo = new InMemoryFeeScheduleRepository()
  })

  it('assigns UUID + timestamps and persists fields', async () => {
    const created = await repo.create(feeInput())
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(created.createdAt).toBeInstanceOf(Date)
    expect(created.feeType).toBe('CLEANING_FLAT')
    expect(created.unit).toBe('FLAT')
    expect(created.amountJpy).toBe(3000)
    expect(created.vehicleClassId).toBeNull()
    expect(created.status).toBe('ACTIVE')
  })

  it('updates fields and preserves id/createdAt', async () => {
    const created = await repo.create(feeInput())
    const updated = await repo.update(created.id, { amountJpy: 4500 })
    expect(updated!.amountJpy).toBe(4500)
    expect(updated!.id).toBe(created.id)
    expect(updated!.createdAt).toEqual(created.createdAt)
  })

  it('archive sets status to ARCHIVED', async () => {
    const created = await repo.create(feeInput())
    const archived = await repo.archive(created.id)
    expect(archived!.status).toBe('ARCHIVED')
  })

  it('returns undefined updating/archiving a missing id', async () => {
    expect(await repo.update('nope', { amountJpy: 1 })).toBeUndefined()
    expect(await repo.archive('nope')).toBeUndefined()
  })
})

describe('InMemoryFeeScheduleRepository — active-uniqueness seal (both partial indexes)', () => {
  let repo: InMemoryFeeScheduleRepository
  beforeEach(() => {
    repo = new InMemoryFeeScheduleRepository()
  })

  it('rejects a second ACTIVE operator-wide fee of the same type (23505)', async () => {
    await repo.create(feeInput({ feeType: 'CLEANING_FLAT', vehicleClassId: null }))
    await expect(
      repo.create(feeInput({ feeType: 'CLEANING_FLAT', vehicleClassId: null })),
    ).rejects.toMatchObject({ code: PG_ERROR.UNIQUE_VIOLATION })
  })

  it('rejects a second ACTIVE per-class fee of the same (type, class) (23505)', async () => {
    const klass = crypto.randomUUID()
    await repo.create(
      feeInput({
        feeType: 'OVERTIME_HOURLY',
        unit: 'PER_HOUR',
        vehicleClassId: klass,
        amountJpy: 500,
      }),
    )
    await expect(
      repo.create(
        feeInput({
          feeType: 'OVERTIME_HOURLY',
          unit: 'PER_HOUR',
          vehicleClassId: klass,
          amountJpy: 700,
        }),
      ),
    ).rejects.toMatchObject({ code: PG_ERROR.UNIQUE_VIOLATION })
  })

  it('allows an operator-wide AND a per-class fee of the same type (different scope)', async () => {
    await repo.create(feeInput({ feeType: 'CLEANING_FLAT', vehicleClassId: null }))
    await expect(
      repo.create(feeInput({ feeType: 'CLEANING_FLAT', vehicleClassId: crypto.randomUUID() })),
    ).resolves.toMatchObject({ feeType: 'CLEANING_FLAT' })
  })

  it('archiving frees the slot — a re-created fee of the same scope succeeds', async () => {
    const first = await repo.create(feeInput({ feeType: 'CLEANING_FLAT', vehicleClassId: null }))
    await repo.archive(first.id)
    await expect(
      repo.create(feeInput({ feeType: 'CLEANING_FLAT', vehicleClassId: null })),
    ).resolves.toMatchObject({ feeType: 'CLEANING_FLAT', status: 'ACTIVE' })
  })

  it('two ACTIVE fees of different types are allowed', async () => {
    await repo.create(feeInput({ feeType: 'CLEANING_FLAT', vehicleClassId: null }))
    await expect(
      repo.create(feeInput({ feeType: 'NO_FUEL_FLAT', vehicleClassId: null, amountJpy: 5000 })),
    ).resolves.toMatchObject({ feeType: 'NO_FUEL_FLAT' })
  })
})

describe('InMemoryFeeScheduleRepository — findActiveByScope', () => {
  let repo: InMemoryFeeScheduleRepository
  beforeEach(() => {
    repo = new InMemoryFeeScheduleRepository()
  })

  it('returns the ACTIVE operator-wide row for the scope', async () => {
    const created = await repo.create(feeInput({ feeType: 'CLEANING_FLAT', vehicleClassId: null }))
    expect((await repo.findActiveByScope(opA, 'CLEANING_FLAT', null))?.id).toBe(created.id)
  })

  it('returns the ACTIVE per-class row for the scope', async () => {
    const klass = crypto.randomUUID()
    const created = await repo.create(
      feeInput({
        feeType: 'OVERTIME_HOURLY',
        unit: 'PER_HOUR',
        vehicleClassId: klass,
        amountJpy: 500,
      }),
    )
    expect((await repo.findActiveByScope(opA, 'OVERTIME_HOURLY', klass))?.id).toBe(created.id)
  })

  it('ignores ARCHIVED rows', async () => {
    const created = await repo.create(feeInput({ feeType: 'CLEANING_FLAT', vehicleClassId: null }))
    await repo.archive(created.id)
    expect(await repo.findActiveByScope(opA, 'CLEANING_FLAT', null)).toBeUndefined()
  })

  it('does not cross operators', async () => {
    await repo.create(feeInput({ operatorId: opA, feeType: 'CLEANING_FLAT', vehicleClassId: null }))
    expect(await repo.findActiveByScope(opB, 'CLEANING_FLAT', null)).toBeUndefined()
  })
})

describe('InMemoryFeeScheduleRepository — operator-scoped reads + filters', () => {
  const klassA = crypto.randomUUID()

  const seed = async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const aWide = await repo.create(
      feeInput({ operatorId: opA, feeType: 'CLEANING_FLAT', vehicleClassId: null }),
    )
    const aClass = await repo.create(
      feeInput({
        operatorId: opA,
        feeType: 'OVERTIME_HOURLY',
        unit: 'PER_HOUR',
        vehicleClassId: klassA,
        amountJpy: 500,
      }),
    )
    const b = await repo.create(
      feeInput({ operatorId: opB, feeType: 'CLEANING_FLAT', vehicleClassId: null }),
    )
    return { repo, aWide, aClass, b }
  }

  it('findAll returns only the scoped tenant fees', async () => {
    const { repo, aWide, aClass, b } = await seed()
    const ids = (await repo.findAll(ctxFor(opA))).map((f) => f.id)
    expect(ids).toContain(aWide.id)
    expect(ids).toContain(aClass.id)
    expect(ids).not.toContain(b.id)
  })

  it('op-B cannot see op-A fees and vice versa (both directions)', async () => {
    const { repo, aWide, b } = await seed()
    const idsB = (await repo.findAll(ctxFor(opB))).map((f) => f.id)
    expect(idsB).toEqual([b.id])
    expect(idsB).not.toContain(aWide.id)
  })

  it('findById cannot reach another tenant fee', async () => {
    const { repo, aWide, b } = await seed()
    expect(await repo.findById(ctxFor(opA), aWide.id)).toMatchObject({ id: aWide.id })
    expect(await repo.findById(ctxFor(opA), b.id)).toBeUndefined()
  })

  it('filters by feeType', async () => {
    const { repo, aClass } = await seed()
    const result = await repo.findAll(ctxFor(opA), { feeType: 'OVERTIME_HOURLY' })
    expect(result.map((f) => f.id)).toEqual([aClass.id])
  })

  it('filters by vehicleClassId', async () => {
    const { repo, aClass } = await seed()
    const result = await repo.findAll(ctxFor(opA), { vehicleClassId: klassA })
    expect(result.map((f) => f.id)).toEqual([aClass.id])
  })

  it('excludes ARCHIVED by default, includes with includeArchived', async () => {
    const { repo, aWide } = await seed()
    await repo.archive(aWide.id)
    expect((await repo.findAll(ctxFor(opA))).map((f) => f.id)).not.toContain(aWide.id)
    expect((await repo.findAll(ctxFor(opA), { includeArchived: true })).map((f) => f.id)).toContain(
      aWide.id,
    )
  })

  it('a tenant-less operator sees nothing (fail-closed)', async () => {
    const { repo, aWide } = await seed()
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    expect(await repo.findAll(noTenant)).toEqual([])
    expect(await repo.findById(noTenant, aWide.id)).toBeUndefined()
  })

  it('a bypass admin (SYSTEM_CONTEXT) sees every operator fee', async () => {
    const { repo } = await seed()
    expect(await repo.findAll(SYSTEM_CONTEXT)).toHaveLength(3)
  })

  it('an operatorId filter narrows a bypass-role read to one tenant', async () => {
    const { repo, b } = await seed()
    const result = await repo.findAll(SYSTEM_CONTEXT, { operatorId: opB })
    expect(result.map((f) => f.id)).toEqual([b.id])
  })

  it('ignores an operatorId filter for an operator caller (scope is absolute)', async () => {
    const { repo, aWide, aClass } = await seed()
    const result = await repo.findAll(ctxFor(opA), { operatorId: opB })
    expect(result.map((f) => f.id).sort()).toEqual([aWide.id, aClass.id].sort())
  })
})

describe('InMemoryFeeScheduleRepository — [P0] private to management roles', () => {
  const seed = async () => {
    const repo = new InMemoryFeeScheduleRepository()
    const fee = await repo.create(feeInput({ operatorId: opA, vehicleClassId: null }))
    return { repo, fee }
  }

  it('RENTER findAll is Forbidden (NOT all-operators)', async () => {
    const { repo } = await seed()
    const renter: CallerContext = { userId: 'r', role: 'RENTER', bypassScope: false }
    await expect(repo.findAll(renter)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('RENTER findById is Forbidden', async () => {
    const { repo, fee } = await seed()
    const renter: CallerContext = { userId: 'r', role: 'RENTER', bypassScope: false }
    await expect(repo.findById(renter, fee.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('PARTNER findAll is Forbidden', async () => {
    const { repo } = await seed()
    const partner: CallerContext = { userId: 'p', role: 'PARTNER', bypassScope: true }
    await expect(repo.findAll(partner)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('the anonymous public context is Forbidden (no public fee surface)', async () => {
    const { repo } = await seed()
    await expect(repo.findAll(PUBLIC_CONTEXT)).rejects.toBeInstanceOf(ForbiddenError)
  })
})
