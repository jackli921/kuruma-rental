import { beforeEach, describe, expect, it } from 'vitest'
import { type CallerContext, PUBLIC_CONTEXT, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { InMemoryVehicleClassRepository } from '../../src/repositories/in-memory'
import type { VehicleClass } from '../../src/stores'

function vehicleClassInput(overrides?: Partial<VehicleClass>) {
  return {
    operatorId: 'op_test',
    name: 'Economy',
    slug: 'economy',
    description: 'Compact and fuel-efficient',
    photos: ['economy.jpg'],
    seats: 4,
    luggageCapacity: 2,
    transmission: 'AUTO' as const,
    fuelType: 'GASOLINE',
    dailyRateJpy: 5000,
    hourlyRateJpy: 1000,
    acrissCode: null,
    sortOrder: 1,
    status: 'ACTIVE' as const,
    ...overrides,
  }
}

describe('InMemoryVehicleClassRepository', () => {
  let repo: InMemoryVehicleClassRepository

  beforeEach(() => {
    repo = new InMemoryVehicleClassRepository()
  })

  describe('findAll', () => {
    it('returns empty array when no classes exist', async () => {
      const result = await repo.findAll(SYSTEM_CONTEXT)
      expect(result).toEqual([])
    })

    it('excludes ARCHIVED classes by default', async () => {
      await repo.create(vehicleClassInput({ name: 'Active', status: 'ACTIVE' }))
      await repo.create(vehicleClassInput({ name: 'Gone', slug: 'gone', status: 'ARCHIVED' }))

      const result = await repo.findAll(SYSTEM_CONTEXT)

      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Active')
    })

    it('includes ARCHIVED when includeArchived is true', async () => {
      await repo.create(vehicleClassInput({ name: 'Active', status: 'ACTIVE' }))
      await repo.create(vehicleClassInput({ name: 'Gone', slug: 'gone', status: 'ARCHIVED' }))

      const result = await repo.findAll(SYSTEM_CONTEXT, { includeArchived: true })

      expect(result).toHaveLength(2)
    })

    it('filters by status', async () => {
      await repo.create(vehicleClassInput({ name: 'Active', status: 'ACTIVE' }))
      await repo.create(vehicleClassInput({ name: 'Gone', slug: 'gone', status: 'ARCHIVED' }))

      const result = await repo.findAll(SYSTEM_CONTEXT, { status: 'ARCHIVED' })

      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Gone')
    })
  })

  describe('create', () => {
    it('assigns UUID and timestamps', async () => {
      const created = await repo.create(vehicleClassInput())

      expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(created.createdAt).toBeInstanceOf(Date)
      expect(created.updatedAt).toBeInstanceOf(Date)
      expect(created.name).toBe('Economy')
      expect(created.slug).toBe('economy')
      expect(created.seats).toBe(4)
      expect(created.dailyRateJpy).toBe(5000)
    })

    it('persists the acrissCode (#388)', async () => {
      const created = await repo.create(vehicleClassInput({ acrissCode: 'CCAR' }))
      expect(created.acrissCode).toBe('CCAR')
    })
  })

  describe('findById', () => {
    it('returns the class when found', async () => {
      const created = await repo.create(vehicleClassInput())

      const found = await repo.findById(SYSTEM_CONTEXT, created.id)

      expect(found).toBeDefined()
      expect(found!.id).toBe(created.id)
      expect(found!.name).toBe('Economy')
    })

    it('returns undefined when not found', async () => {
      const found = await repo.findById(SYSTEM_CONTEXT, 'nonexistent')
      expect(found).toBeUndefined()
    })
  })

  describe('findBySlug', () => {
    it('returns the class when found', async () => {
      const created = await repo.create(vehicleClassInput({ slug: 'premium-suv' }))

      const found = await repo.findBySlug(SYSTEM_CONTEXT, 'premium-suv')

      expect(found).toBeDefined()
      expect(found!.id).toBe(created.id)
      expect(found!.slug).toBe('premium-suv')
    })

    it('returns undefined when not found', async () => {
      const found = await repo.findBySlug(SYSTEM_CONTEXT, 'nonexistent')
      expect(found).toBeUndefined()
    })
  })

  describe('update', () => {
    it('modifies fields and bumps updatedAt', async () => {
      const created = await repo.create(vehicleClassInput())

      const updated = await repo.update(created.id, { name: 'Premium', dailyRateJpy: 8000 })

      expect(updated).toBeDefined()
      expect(updated!.name).toBe('Premium')
      expect(updated!.dailyRateJpy).toBe(8000)
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime())
    })

    it('preserves id and createdAt', async () => {
      const created = await repo.create(vehicleClassInput())

      const updated = await repo.update(created.id, { name: 'Changed' })

      expect(updated!.id).toBe(created.id)
      expect(updated!.createdAt).toEqual(created.createdAt)
    })

    it('returns undefined for missing id', async () => {
      const result = await repo.update('nonexistent', { name: 'Nope' })
      expect(result).toBeUndefined()
    })
  })

  describe('archive', () => {
    it('sets status to ARCHIVED', async () => {
      const created = await repo.create(vehicleClassInput({ status: 'ACTIVE' }))

      const archived = await repo.archive(created.id)

      expect(archived).toBeDefined()
      expect(archived!.status).toBe('ARCHIVED')
      expect(archived!.id).toBe(created.id)
    })

    it('returns undefined for missing id', async () => {
      const result = await repo.archive('nonexistent')
      expect(result).toBeUndefined()
    })
  })
})

// Reads are operator-scoped (#395): an OPERATOR_* caller only sees its own
// tenant's classes; admins (SYSTEM_CONTEXT) and the anonymous renter catalog
// (PUBLIC_CONTEXT) see across operators; a tenant-less operator fails closed.
// Mirrors the cross-operator vehicle isolation in tenancy-guards.test.ts.
// Reads only: the class-operator write seal is a DB composite FK with no
// in-memory equivalent, so it is exercised solely in the Drizzle integration
// block ("...sealed to the vehicle's operator") in tenancy-isolation.test.ts.
describe('InMemoryVehicleClassRepository operator-scopes reads', () => {
  const opA = 'op_a'
  const opB = 'op_b'

  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  const seed = async () => {
    const repo = new InMemoryVehicleClassRepository()
    const a = await repo.create(vehicleClassInput({ operatorId: opA, name: 'A', slug: 'a-class' }))
    const b = await repo.create(vehicleClassInput({ operatorId: opB, name: 'B', slug: 'b-class' }))
    return { repo, a, b }
  }

  it('findAll returns only the scoped tenant classes', async () => {
    const { repo, a } = await seed()
    const result = await repo.findAll(ctxFor(opA))
    expect(result.map((vc) => vc.id)).toEqual([a.id])
    expect(result.every((vc) => vc.operatorId === opA)).toBe(true)
  })

  it('findById cannot reach another tenant class', async () => {
    const { repo, a, b } = await seed()
    expect(await repo.findById(ctxFor(opA), a.id)).toMatchObject({ id: a.id })
    expect(await repo.findById(ctxFor(opA), b.id)).toBeUndefined()
  })

  it('findBySlug cannot reach another tenant class', async () => {
    const { repo } = await seed()
    expect(await repo.findBySlug(ctxFor(opA), 'a-class')).toMatchObject({ slug: 'a-class' })
    expect(await repo.findBySlug(ctxFor(opA), 'b-class')).toBeUndefined()
  })

  it('a tenant-less operator sees nothing (fail-closed)', async () => {
    const { repo, a } = await seed()
    const noTenant: CallerContext = { userId: 'x', role: 'OPERATOR_OWNER', bypassScope: false }
    expect(await repo.findAll(noTenant)).toEqual([])
    expect(await repo.findById(noTenant, a.id)).toBeUndefined()
    expect(await repo.findBySlug(noTenant, 'a-class')).toBeUndefined()
  })

  it('the anonymous renter catalog sees every operator’s classes', async () => {
    const { repo, a, b } = await seed()
    const ids = (await repo.findAll(PUBLIC_CONTEXT)).map((vc) => vc.id).sort()
    expect(ids).toEqual([a.id, b.id].sort())
  })

  it('an admin (SYSTEM_CONTEXT) sees every operator’s classes', async () => {
    const { repo } = await seed()
    expect(await repo.findAll(SYSTEM_CONTEXT)).toHaveLength(2)
  })
})
