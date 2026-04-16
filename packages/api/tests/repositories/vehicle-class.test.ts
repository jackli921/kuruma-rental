import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryVehicleClassRepository } from '../../src/repositories/in-memory'
import type { VehicleClass } from '../../src/stores'

function vehicleClassInput(overrides?: Partial<VehicleClass>) {
  return {
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
      const result = await repo.findAll()
      expect(result).toEqual([])
    })

    it('excludes ARCHIVED classes by default', async () => {
      await repo.create(vehicleClassInput({ name: 'Active', status: 'ACTIVE' }))
      await repo.create(vehicleClassInput({ name: 'Gone', slug: 'gone', status: 'ARCHIVED' }))

      const result = await repo.findAll()

      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Active')
    })

    it('includes ARCHIVED when includeArchived is true', async () => {
      await repo.create(vehicleClassInput({ name: 'Active', status: 'ACTIVE' }))
      await repo.create(vehicleClassInput({ name: 'Gone', slug: 'gone', status: 'ARCHIVED' }))

      const result = await repo.findAll({ includeArchived: true })

      expect(result).toHaveLength(2)
    })

    it('filters by status', async () => {
      await repo.create(vehicleClassInput({ name: 'Active', status: 'ACTIVE' }))
      await repo.create(vehicleClassInput({ name: 'Gone', slug: 'gone', status: 'ARCHIVED' }))

      const result = await repo.findAll({ status: 'ARCHIVED' })

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
  })

  describe('findById', () => {
    it('returns the class when found', async () => {
      const created = await repo.create(vehicleClassInput())

      const found = await repo.findById(created.id)

      expect(found).toBeDefined()
      expect(found!.id).toBe(created.id)
      expect(found!.name).toBe('Economy')
    })

    it('returns undefined when not found', async () => {
      const found = await repo.findById('nonexistent')
      expect(found).toBeUndefined()
    })
  })

  describe('findBySlug', () => {
    it('returns the class when found', async () => {
      const created = await repo.create(vehicleClassInput({ slug: 'premium-suv' }))

      const found = await repo.findBySlug('premium-suv')

      expect(found).toBeDefined()
      expect(found!.id).toBe(created.id)
      expect(found!.slug).toBe('premium-suv')
    })

    it('returns undefined when not found', async () => {
      const found = await repo.findBySlug('nonexistent')
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
