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

// #1437 slice 3: insurance is purely self-authored — the create DTO carries a
// nameI18n bundle (en required) and the service derives the `name` mirror = en.
function createInput(operatorId: string, en: string, extra?: { ja?: string; zh?: string }) {
  return {
    operatorId,
    nameI18n: { en, ...extra },
    description: null,
    dailyPriceJpy: 1500,
    deductibleJpy: 150000,
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
      const result = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.option.resolvedName).toBe('Premium')
        expect(result.option.operatorId).toBe(opA)
      }
    })

    it('persists the nameI18n bundle and resolves the create locale', async () => {
      const result = await service.create(
        ctxFor(opA),
        createInput(opA, 'Premium', { ja: 'プレミアム', zh: '高级' }),
        'ja',
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.option.nameI18n).toEqual({ en: 'Premium', ja: 'プレミアム', zh: '高级' })
        // The wire carries the resolved label (ja here); the raw bundle rides along.
        expect(result.option.resolvedName).toBe('プレミアム')
      }
    })

    it('rejects a duplicate ACTIVE name within the same operator with 409', async () => {
      await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      const result = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe(409)
        expect(result.error).toBe('An insurance option with this name already exists')
      }
    })

    it('allows the same name under a different operator', async () => {
      await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      const result = await service.create(ctxFor(opB), createInput(opB, 'Premium'), 'en')
      expect(result.ok).toBe(true)
    })

    it('maps a unique-violation that slips past the pre-check (lost race) to 409', async () => {
      vi.spyOn(repo, 'findActiveByOperatorAndName').mockResolvedValue(undefined)
      vi.spyOn(repo, 'create').mockRejectedValue(uniqueViolation())
      const result = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })
  })

  describe('read projection (#1437 slice 3b)', () => {
    it('findById resolves resolvedName to the caller locale, keeping the raw bundle', async () => {
      const created = await service.create(
        ctxFor(opA),
        createInput(opA, 'Premium', { ja: 'プレミアム' }),
        'en',
      )
      if (!created.ok) throw new Error('seed failed')

      const found = await service.findById(ctxFor(opA), created.option.id, 'ja')
      expect(found?.resolvedName).toBe('プレミアム')
      expect(found?.nameI18n).toEqual({ en: 'Premium', ja: 'プレミアム' })
    })

    it('findById floors to en for a locale the bundle omits', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      if (!created.ok) throw new Error('seed failed')

      const found = await service.findById(ctxFor(opA), created.option.id, 'zh')
      expect(found?.resolvedName).toBe('Premium')
    })
  })

  describe('update', () => {
    it('updates a field for an owned option', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      if (!created.ok) throw new Error('seed failed')
      const result = await service.update(
        ctxFor(opA),
        created.option.id,
        { dailyPriceJpy: 3000 },
        'en',
      )
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.option.dailyPriceJpy).toBe(3000)
    })

    it('returns 404 (not 403) when the id belongs to another operator', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      if (!created.ok) throw new Error('seed failed')
      const result = await service.update(
        ctxFor(opB),
        created.option.id,
        { nameI18n: { en: 'Hijack' } },
        'en',
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(404)
    })

    it('loads the row (scoped) before writing, never writes on a cross-tenant id', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      if (!created.ok) throw new Error('seed failed')
      const updateSpy = vi.spyOn(repo, 'update')
      await service.update(ctxFor(opB), created.option.id, { nameI18n: { en: 'Hijack' } }, 'en')
      expect(updateSpy).not.toHaveBeenCalled()
    })

    it('rejects renaming to a name already used by the same operator with 409', async () => {
      await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      const standard = await service.create(ctxFor(opA), createInput(opA, 'Standard'), 'en')
      if (!standard.ok) throw new Error('seed failed')
      const result = await service.update(
        ctxFor(opA),
        standard.option.id,
        { nameI18n: { en: 'Premium' } },
        'en',
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })

    it('allows a no-name-change edit without a self-collision (excludes current id)', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      if (!created.ok) throw new Error('seed failed')
      // Patch the same name back plus a price change — must not 409 on itself.
      const result = await service.update(
        ctxFor(opA),
        created.option.id,
        { nameI18n: { en: 'Premium' }, dailyPriceJpy: 1800 },
        'en',
      )
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.option.dailyPriceJpy).toBe(1800)
    })

    it('keeps the resolved name in lockstep when nameI18n.en changes', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      if (!created.ok) throw new Error('seed failed')
      const result = await service.update(
        ctxFor(opA),
        created.option.id,
        { nameI18n: { en: 'Platinum', ja: 'プラチナ' } },
        'en',
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.option.resolvedName).toBe('Platinum')
        expect(result.option.nameI18n).toEqual({ en: 'Platinum', ja: 'プラチナ' })
      }
    })

    it('maps a unique-violation on rename that slips past the pre-check to 409', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      if (!created.ok) throw new Error('seed failed')
      vi.spyOn(repo, 'findActiveByOperatorAndName').mockResolvedValue(undefined)
      vi.spyOn(repo, 'update').mockRejectedValue(uniqueViolation())
      const result = await service.update(
        ctxFor(opA),
        created.option.id,
        { nameI18n: { en: 'Standard' } },
        'en',
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })
  })

  describe('archive', () => {
    it('sets status to ARCHIVED for an owned option', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      if (!created.ok) throw new Error('seed failed')
      const result = await service.archive(ctxFor(opA), created.option.id, 'en')
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.option.status).toBe('ARCHIVED')
    })

    it('returns 404 and does not write when archiving another operator option', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      if (!created.ok) throw new Error('seed failed')
      const archiveSpy = vi.spyOn(repo, 'archive')
      const result = await service.archive(ctxFor(opB), created.option.id, 'en')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(404)
      expect(archiveSpy).not.toHaveBeenCalled()
    })

    it('frees the name so a new ACTIVE option can reuse it', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      if (!created.ok) throw new Error('seed failed')
      await service.archive(ctxFor(opA), created.option.id, 'en')
      const recreated = await service.create(ctxFor(opA), createInput(opA, 'Premium'), 'en')
      expect(recreated.ok).toBe(true)
    })
  })
})
