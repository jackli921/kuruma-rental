import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, PUBLIC_CONTEXT, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { PG_ERROR } from '../../src/pg-errors'
import { InMemoryInsuranceOptionRepository } from '../../src/repositories/in-memory'
import type { InsuranceOption } from '../../src/stores'

function optionInput(overrides?: Partial<InsuranceOption>) {
  return {
    operatorId: 'op_test',
    name: 'Standard Cover',
    description: null,
    dailyPriceJpy: 1500,
    deductibleJpy: 150000,
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

describe('InMemoryInsuranceOptionRepository', () => {
  let repo: InMemoryInsuranceOptionRepository

  beforeEach(() => {
    repo = new InMemoryInsuranceOptionRepository()
  })

  describe('create', () => {
    it('assigns UUID + timestamps and persists fields', async () => {
      const created = await repo.create(optionInput())
      expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(created.createdAt).toBeInstanceOf(Date)
      expect(created.updatedAt).toBeInstanceOf(Date)
      expect(created.name).toBe('Standard Cover')
      expect(created.dailyPriceJpy).toBe(1500)
      expect(created.deductibleJpy).toBe(150000)
      expect(created.status).toBe('ACTIVE')
    })

    it('persists a null deductible (full cover)', async () => {
      const created = await repo.create(optionInput({ deductibleJpy: null }))
      expect(created.deductibleJpy).toBeNull()
    })

    it('throws a unique-violation on a duplicate ACTIVE operator+name', async () => {
      await repo.create(optionInput({ operatorId: 'op_a', name: 'Premium' }))
      await expect(
        repo.create(optionInput({ operatorId: 'op_a', name: 'Premium' })),
      ).rejects.toMatchObject({ code: PG_ERROR.UNIQUE_VIOLATION })
    })

    it('allows the same name under a different operator', async () => {
      await repo.create(optionInput({ operatorId: 'op_a', name: 'Premium' }))
      await expect(
        repo.create(optionInput({ operatorId: 'op_b', name: 'Premium' })),
      ).resolves.toMatchObject({ name: 'Premium' })
    })

    it('allows reusing a name freed by archiving (uniqueness is ACTIVE-only)', async () => {
      const first = await repo.create(optionInput({ operatorId: 'op_a', name: 'Premium' }))
      await repo.archive(first.id)
      // The archived row no longer reserves the name.
      await expect(
        repo.create(optionInput({ operatorId: 'op_a', name: 'Premium' })),
      ).resolves.toMatchObject({ name: 'Premium', status: 'ACTIVE' })
    })
  })

  describe('findActiveByOperatorAndName', () => {
    it('finds an ACTIVE option by operator + name', async () => {
      const created = await repo.create(optionInput({ operatorId: 'op_a', name: 'Premium' }))
      expect((await repo.findActiveByOperatorAndName('op_a', 'Premium'))?.id).toBe(created.id)
    })

    it('ignores an ARCHIVED row of the same name', async () => {
      const created = await repo.create(optionInput({ operatorId: 'op_a', name: 'Premium' }))
      await repo.archive(created.id)
      expect(await repo.findActiveByOperatorAndName('op_a', 'Premium')).toBeUndefined()
    })

    it('does not match the same name under a different operator', async () => {
      await repo.create(optionInput({ operatorId: 'op_a', name: 'Premium' }))
      expect(await repo.findActiveByOperatorAndName('op_b', 'Premium')).toBeUndefined()
    })
  })

  describe('findAll status filtering', () => {
    it('excludes ARCHIVED by default', async () => {
      await repo.create(optionInput({ name: 'Active' }))
      await repo.create(optionInput({ name: 'Gone', status: 'ARCHIVED' }))
      const result = await repo.findAll(SYSTEM_CONTEXT, { includeAllOperators: true })
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Active')
    })

    it('includes ARCHIVED when includeArchived is true', async () => {
      await repo.create(optionInput({ name: 'Active' }))
      await repo.create(optionInput({ name: 'Gone', status: 'ARCHIVED' }))
      expect(
        await repo.findAll(SYSTEM_CONTEXT, { includeArchived: true, includeAllOperators: true }),
      ).toHaveLength(2)
    })

    it('filters by status', async () => {
      await repo.create(optionInput({ name: 'Active' }))
      await repo.create(optionInput({ name: 'Gone', status: 'ARCHIVED' }))
      const result = await repo.findAll(SYSTEM_CONTEXT, {
        status: 'ARCHIVED',
        includeAllOperators: true,
      })
      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Gone')
    })
  })

  describe('update', () => {
    it('modifies fields and preserves id/createdAt', async () => {
      const created = await repo.create(optionInput())
      const updated = await repo.update(created.id, { dailyPriceJpy: 2500 })
      expect(updated!.dailyPriceJpy).toBe(2500)
      expect(updated!.id).toBe(created.id)
      expect(updated!.createdAt).toEqual(created.createdAt)
    })

    it('returns undefined for a missing id', async () => {
      expect(await repo.update('nonexistent', { name: 'Nope' })).toBeUndefined()
    })

    it('throws a unique-violation when renaming onto another ACTIVE row in the same operator', async () => {
      const a = await repo.create(optionInput({ operatorId: 'op_a', name: 'Premium' }))
      await repo.create(optionInput({ operatorId: 'op_a', name: 'Standard' }))
      await expect(repo.update(a.id, { name: 'Standard' })).rejects.toMatchObject({
        code: PG_ERROR.UNIQUE_VIOLATION,
      })
    })
  })

  describe('archive', () => {
    it('sets status to ARCHIVED', async () => {
      const created = await repo.create(optionInput({ status: 'ACTIVE' }))
      const archived = await repo.archive(created.id)
      expect(archived!.status).toBe('ARCHIVED')
      expect(archived!.id).toBe(created.id)
    })

    it('returns undefined for a missing id', async () => {
      expect(await repo.archive('nonexistent')).toBeUndefined()
    })
  })
})

// Reads are operator-scoped (#404, mirroring #387/#395) AND management-gated:
// RENTER/PARTNER are rejected because insurance is operator-private config
// (slice-4 [P0]). OPERATOR_* see only their own tenant; bypass roles see across.
describe('InMemoryInsuranceOptionRepository operator-scopes + management-gates reads', () => {
  const opA = 'op_a'
  const opB = 'op_b'

  const seed = async () => {
    const repo = new InMemoryInsuranceOptionRepository()
    const a = await repo.create(optionInput({ operatorId: opA, name: 'A-Premium' }))
    const b = await repo.create(optionInput({ operatorId: opB, name: 'B-Premium' }))
    return { repo, a, b }
  }

  it('findAll returns only the scoped tenant options', async () => {
    const { repo, a } = await seed()
    const result = await repo.findAll(ctxFor(opA))
    expect(result.map((o) => o.id)).toEqual([a.id])
    expect(result.every((o) => o.operatorId === opA)).toBe(true)
  })

  it('findById cannot reach another tenant option', async () => {
    const { repo, a, b } = await seed()
    expect(await repo.findById(ctxFor(opA), a.id)).toMatchObject({ id: a.id })
    expect(await repo.findById(ctxFor(opA), b.id)).toBeUndefined()
  })

  it('a tenant-less operator sees nothing (fail-closed)', async () => {
    const { repo, a } = await seed()
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    expect(await repo.findAll(noTenant)).toEqual([])
    expect(await repo.findById(noTenant, a.id)).toBeUndefined()
  })

  it('an admin (SYSTEM_CONTEXT) sees every operator option', async () => {
    const { repo } = await seed()
    expect(await repo.findAll(SYSTEM_CONTEXT, { includeAllOperators: true })).toHaveLength(2)
  })

  it('an operator filter narrows a bypass-role read to one tenant', async () => {
    const { repo, b } = await seed()
    const result = await repo.findAll(SYSTEM_CONTEXT, { operatorId: opB })
    expect(result.map((o) => o.id)).toEqual([b.id])
  })

  it('ignores an operatorId filter for an operator caller (scope is absolute)', async () => {
    const { repo, a } = await seed()
    const result = await repo.findAll(ctxFor(opA), { operatorId: opB })
    expect(result.map((o) => o.id)).toEqual([a.id])
  })

  // [P0] insurance is operator-private. operatorReadScope maps RENTER to
  // {kind:'all'}, so without requireManagementRead a renter would read EVERY
  // operator's config. The guard must throw Forbidden, NOT return all-operators.
  it('[P0] a RENTER read throws Forbidden (NOT all-operators)', async () => {
    const { repo, a } = await seed()
    await expect(repo.findAll(PUBLIC_CONTEXT)).rejects.toThrow('management read scope required')
    await expect(repo.findById(PUBLIC_CONTEXT, a.id)).rejects.toThrow(
      'management read scope required',
    )
  })

  it('[P0] a PARTNER read throws Forbidden (NOT all-operators)', async () => {
    const { repo, a } = await seed()
    const partner: CallerContext = { userId: 'partner:api-key', role: 'PARTNER', bypassScope: true }
    await expect(repo.findAll(partner)).rejects.toThrow('management read scope required')
    await expect(repo.findById(partner, a.id)).rejects.toThrow('management read scope required')
  })
})
