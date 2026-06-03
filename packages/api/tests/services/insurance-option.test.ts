import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import { PG_ERROR } from '../../src/pg-errors'
import { InMemoryInsuranceOptionRepository } from '../../src/repositories/in-memory'
import { InsuranceOptionService } from '../../src/services/insurance-option'

const uniqueViolation = () =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: PG_ERROR.UNIQUE_VIOLATION,
  })

const opA = 'op_a'
const opB = 'op_b'

const ctxFor = (operatorId: string): CallerContext => ({
  userId: 'owner',
  role: 'OPERATOR_OWNER',
  operatorId,
  bypassScope: false,
})

function createInput(operatorId: string, name: string) {
  return {
    operatorId,
    name,
    description: null,
    dailyPriceJpy: 1500,
    deductibleJpy: 150000,
    status: 'ACTIVE' as const,
  }
}

describe('InsuranceOptionService', () => {
  let repo: InMemoryInsuranceOptionRepository
  let service: InsuranceOptionService

  beforeEach(() => {
    repo = new InMemoryInsuranceOptionRepository()
    service = new InsuranceOptionService(repo)
  })

  describe('create', () => {
    it('creates an option for the caller operator', async () => {
      const result = await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.option.name).toBe('Premium')
        expect(result.option.operatorId).toBe(opA)
      }
    })

    it('rejects a duplicate ACTIVE name within the same operator with 409', async () => {
      await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      const result = await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe(409)
        expect(result.error).toBe('An insurance option with this name already exists')
      }
    })

    it('allows the same name under a different operator', async () => {
      await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      const result = await service.create(ctxFor(opB), createInput(opB, 'Premium'))
      expect(result.ok).toBe(true)
    })

    it('maps a unique-violation that slips past the pre-check (lost race) to 409', async () => {
      vi.spyOn(repo, 'findActiveByOperatorAndName').mockResolvedValue(undefined)
      vi.spyOn(repo, 'create').mockRejectedValue(uniqueViolation())
      const result = await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })
  })

  describe('update', () => {
    it('updates a field for an owned option', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      if (!created.ok) throw new Error('seed failed')
      const result = await service.update(ctxFor(opA), created.option.id, { dailyPriceJpy: 3000 })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.option.dailyPriceJpy).toBe(3000)
    })

    it('returns 404 (not 403) when the id belongs to another operator', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      if (!created.ok) throw new Error('seed failed')
      const result = await service.update(ctxFor(opB), created.option.id, { name: 'Hijack' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(404)
    })

    it('loads the row (scoped) before writing, never writes on a cross-tenant id', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      if (!created.ok) throw new Error('seed failed')
      const updateSpy = vi.spyOn(repo, 'update')
      await service.update(ctxFor(opB), created.option.id, { name: 'Hijack' })
      expect(updateSpy).not.toHaveBeenCalled()
    })

    it('rejects renaming to a name already used by the same operator with 409', async () => {
      await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      const standard = await service.create(ctxFor(opA), createInput(opA, 'Standard'))
      if (!standard.ok) throw new Error('seed failed')
      const result = await service.update(ctxFor(opA), standard.option.id, { name: 'Premium' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })

    it('allows a no-name-change edit without a self-collision (excludes current id)', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      if (!created.ok) throw new Error('seed failed')
      // Patch the same name back plus a price change — must not 409 on itself.
      const result = await service.update(ctxFor(opA), created.option.id, {
        name: 'Premium',
        dailyPriceJpy: 1800,
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.option.dailyPriceJpy).toBe(1800)
    })

    it('maps a unique-violation on rename that slips past the pre-check to 409', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      if (!created.ok) throw new Error('seed failed')
      vi.spyOn(repo, 'findActiveByOperatorAndName').mockResolvedValue(undefined)
      vi.spyOn(repo, 'update').mockRejectedValue(uniqueViolation())
      const result = await service.update(ctxFor(opA), created.option.id, { name: 'Standard' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })
  })

  describe('archive', () => {
    it('sets status to ARCHIVED for an owned option', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      if (!created.ok) throw new Error('seed failed')
      const result = await service.archive(ctxFor(opA), created.option.id)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.option.status).toBe('ARCHIVED')
    })

    it('returns 404 and does not write when archiving another operator option', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      if (!created.ok) throw new Error('seed failed')
      const archiveSpy = vi.spyOn(repo, 'archive')
      const result = await service.archive(ctxFor(opB), created.option.id)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(404)
      expect(archiveSpy).not.toHaveBeenCalled()
    })

    it('frees the name so a new ACTIVE option can reuse it', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      if (!created.ok) throw new Error('seed failed')
      await service.archive(ctxFor(opA), created.option.id)
      const recreated = await service.create(ctxFor(opA), createInput(opA, 'Premium'))
      expect(recreated.ok).toBe(true)
    })
  })
})
