import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, PUBLIC_CONTEXT, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { PG_ERROR } from '../../src/pg-errors'
import { InMemoryLocationRepository } from '../../src/repositories/in-memory'
import type { Location } from '../../src/stores'

function locationInput(overrides?: Partial<Location>) {
  return {
    operatorId: 'op_test',
    name: 'Osaka Namba',
    address: '1-2-3 Namba, Chuo-ku',
    operatingHours: null,
    timezone: 'Asia/Tokyo',
    defaultTurnaroundMinutes: 2880,
    status: 'ACTIVE' as const,
    ...overrides,
  }
}

describe('InMemoryLocationRepository', () => {
  let repo: InMemoryLocationRepository

  beforeEach(() => {
    repo = new InMemoryLocationRepository()
  })

  describe('create', () => {
    it('assigns UUID and timestamps and persists fields', async () => {
      const created = await repo.create(locationInput())

      expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(created.createdAt).toBeInstanceOf(Date)
      expect(created.updatedAt).toBeInstanceOf(Date)
      expect(created.name).toBe('Osaka Namba')
      expect(created.address).toBe('1-2-3 Namba, Chuo-ku')
      expect(created.defaultTurnaroundMinutes).toBe(2880)
      expect(created.status).toBe('ACTIVE')
    })

    it('round-trips an operating-hours pair', async () => {
      const created = await repo.create(
        locationInput({ operatingHours: { openTime: '09:00', closeTime: '20:00' } }),
      )
      expect(created.operatingHours).toEqual({ openTime: '09:00', closeTime: '20:00' })
    })

    it('throws a unique-violation on a duplicate operator+name (mirrors the DB seal)', async () => {
      await repo.create(locationInput({ operatorId: 'op_a', name: 'Namba' }))
      await expect(
        repo.create(locationInput({ operatorId: 'op_a', name: 'Namba' })),
      ).rejects.toMatchObject({ code: PG_ERROR.UNIQUE_VIOLATION })
    })

    it('allows the same name under a different operator', async () => {
      await repo.create(locationInput({ operatorId: 'op_a', name: 'Namba' }))
      await expect(
        repo.create(locationInput({ operatorId: 'op_b', name: 'Namba' })),
      ).resolves.toMatchObject({ name: 'Namba' })
    })

    it('frees an archived name for re-creation (#410, mirrors the partial index)', async () => {
      const first = await repo.create(locationInput({ operatorId: 'op_a', name: 'Namba' }))
      await repo.archive(SYSTEM_CONTEXT, first.id)
      await expect(
        repo.create(locationInput({ operatorId: 'op_a', name: 'Namba' })),
      ).resolves.toMatchObject({ name: 'Namba', status: 'ACTIVE' })
    })
  })

  describe('findAll', () => {
    it('excludes ARCHIVED by default', async () => {
      await repo.create(locationInput({ name: 'Active' }))
      await repo.create(locationInput({ name: 'Gone', status: 'ARCHIVED' }))

      const result = await repo.findAll(SYSTEM_CONTEXT)

      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Active')
    })

    it('includes ARCHIVED when includeArchived is true', async () => {
      await repo.create(locationInput({ name: 'Active' }))
      await repo.create(locationInput({ name: 'Gone', status: 'ARCHIVED' }))

      expect(await repo.findAll(SYSTEM_CONTEXT, { includeArchived: true })).toHaveLength(2)
    })

    it('filters by status', async () => {
      await repo.create(locationInput({ name: 'Active' }))
      await repo.create(locationInput({ name: 'Gone', status: 'ARCHIVED' }))

      const result = await repo.findAll(SYSTEM_CONTEXT, { status: 'ARCHIVED' })

      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Gone')
    })
  })

  describe('findByOperatorAndName', () => {
    it('finds a location by its operator + name', async () => {
      const created = await repo.create(locationInput({ operatorId: 'op_a', name: 'Namba' }))
      const found = await repo.findByOperatorAndName('op_a', 'Namba')
      expect(found?.id).toBe(created.id)
    })

    it('does not match the same name under a different operator', async () => {
      await repo.create(locationInput({ operatorId: 'op_a', name: 'Namba' }))
      expect(await repo.findByOperatorAndName('op_b', 'Namba')).toBeUndefined()
    })

    it('returns undefined when absent', async () => {
      expect(await repo.findByOperatorAndName('op_a', 'Nope')).toBeUndefined()
    })
  })

  describe('update', () => {
    it('modifies fields and preserves id/createdAt', async () => {
      const created = await repo.create(locationInput())

      const updated = await repo.update(SYSTEM_CONTEXT, created.id, {
        defaultTurnaroundMinutes: 3600,
      })

      expect(updated!.defaultTurnaroundMinutes).toBe(3600)
      expect(updated!.id).toBe(created.id)
      expect(updated!.createdAt).toEqual(created.createdAt)
    })

    it('returns undefined for missing id', async () => {
      expect(await repo.update(SYSTEM_CONTEXT, 'nonexistent', { name: 'Nope' })).toBeUndefined()
    })

    it('throws a unique-violation when renaming onto another row in the same operator', async () => {
      const a = await repo.create(locationInput({ operatorId: 'op_a', name: 'Namba' }))
      await repo.create(locationInput({ operatorId: 'op_a', name: 'Umeda' }))
      await expect(repo.update(SYSTEM_CONTEXT, a.id, { name: 'Umeda' })).rejects.toMatchObject({
        code: PG_ERROR.UNIQUE_VIOLATION,
      })
    })
  })

  describe('archive', () => {
    it('sets status to ARCHIVED', async () => {
      const created = await repo.create(locationInput({ status: 'ACTIVE' }))
      const archived = await repo.archive(SYSTEM_CONTEXT, created.id)
      expect(archived!.status).toBe('ARCHIVED')
      expect(archived!.id).toBe(created.id)
    })

    it('returns undefined for missing id', async () => {
      expect(await repo.archive(SYSTEM_CONTEXT, 'nonexistent')).toBeUndefined()
    })
  })
})

// Reads are operator-scoped (#387, mirroring #395 vehicle classes): an
// OPERATOR_* caller sees only its own tenant's locations; bypass roles
// (SYSTEM_CONTEXT) see across operators; a tenant-less operator fails closed.
// Writes are ALSO operator-scoped at the repo now (#1288): update/archive scope
// their WHERE by tenant, so a caller skipping the service's findById guard still
// can't mutate another operator's row. Those write-isolation cases live with the
// other repos' in tenancy-guards.test.ts.
describe('InMemoryLocationRepository operator-scopes reads', () => {
  const opA = 'op_a'
  const opB = 'op_b'

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  const seed = async () => {
    const repo = new InMemoryLocationRepository()
    const a = await repo.create(locationInput({ operatorId: opA, name: 'A-Namba' }))
    const b = await repo.create(locationInput({ operatorId: opB, name: 'B-Umeda' }))
    return { repo, a, b }
  }

  it('findAll returns only the scoped tenant locations', async () => {
    const { repo, a } = await seed()
    const result = await repo.findAll(ctxFor(opA))
    expect(result.map((l) => l.id)).toEqual([a.id])
    expect(result.every((l) => l.operatorId === opA)).toBe(true)
  })

  it('findById cannot reach another tenant location', async () => {
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

  it('an admin (SYSTEM_CONTEXT) sees every operator location', async () => {
    const { repo } = await seed()
    expect(await repo.findAll(SYSTEM_CONTEXT)).toHaveLength(2)
  })

  it('an operator filter narrows a bypass-role read to one tenant', async () => {
    const { repo, b } = await seed()
    const result = await repo.findAll(SYSTEM_CONTEXT, { operatorId: opB })
    expect(result.map((l) => l.id)).toEqual([b.id])
  })

  it('ignores an operatorId filter for an operator caller (scope is absolute)', async () => {
    const { repo, a } = await seed()
    // Even if a stray filter leaks in, an operator can never widen past its tenant.
    const result = await repo.findAll(ctxFor(opA), { operatorId: opB })
    expect(result.map((l) => l.id)).toEqual([a.id])
  })

  it('the public catalog sees every operator location (slice 5 forward-compat)', async () => {
    const { repo } = await seed()
    expect(await repo.findAll(PUBLIC_CONTEXT)).toHaveLength(2)
  })
})
