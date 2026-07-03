import { seedId } from '@kuruma/shared/db/seed-id'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallerContext } from '../../src/middleware/auth'
import { PG_ERROR } from '../../src/pg-errors'
import {
  InMemoryAddOnRepository,
  InMemoryAddOnTemplateRepository,
} from '../../src/repositories/in-memory'
import { AddOnService } from '../../src/services/add-on'

const uniqueViolation = () =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: PG_ERROR.UNIQUE_VIOLATION,
  })

const opA = 'op_a'
const opB = 'op_b'

const CHILD_SEAT = seedId('tmpl_child_seat')
const ETC_CARD = seedId('tmpl_etc_card')
const LOCALE = 'en' as const

const ctxFor = (operatorId: string): CallerContext => ({
  userId: 'owner',
  role: 'OPERATOR_OWNER',
  operatorId,
  bypassScope: false,
})

function createInput(operatorId: string, templateId: string) {
  return {
    operatorId,
    templateId,
    descriptionOverride: null,
    priceJpy: 1500,
  }
}

// A self-authored create carries a nameI18n bundle and NO templateId (#1437).
function selfAuthoredInput(operatorId: string, nameI18n: { en: string; ja?: string; zh?: string }) {
  return {
    operatorId,
    nameI18n,
    descriptionOverride: null,
    priceJpy: 1500,
  }
}

describe('AddOnService', () => {
  let repo: InMemoryAddOnRepository
  let service: AddOnService

  beforeEach(() => {
    repo = new InMemoryAddOnRepository()
    service = new AddOnService(repo, new InMemoryAddOnTemplateRepository())
  })

  describe('create', () => {
    it('creates an add-on from a template and resolves its name to the locale', async () => {
      const result = await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), 'ja')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.option.templateId).toBe(CHILD_SEAT)
        expect(result.option.resolvedName).toBe('チャイルドシート')
        expect(result.option.operatorId).toBe(opA)
      }
    })

    it('rejects a second add-on for the same template within one operator with 409', async () => {
      await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      const result = await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe(409)
        expect(result.error).toBe('You already offer this add-on')
      }
    })

    it('allows the same template under a different operator', async () => {
      await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      const result = await service.create(ctxFor(opB), createInput(opB, CHILD_SEAT), LOCALE)
      expect(result.ok).toBe(true)
    })

    it('rejects an unknown templateId with 400', async () => {
      const result = await service.create(
        ctxFor(opA),
        createInput(opA, crypto.randomUUID()),
        LOCALE,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe(400)
        expect(result.error).toBe('Unknown or unavailable add-on template')
      }
    })

    it('rejects an ARCHIVED template with 400 (never newly offered)', async () => {
      const store = new Map([
        [
          ETC_CARD,
          {
            id: ETC_CARD,
            key: 'etc_card',
            name: { en: 'ETC card' },
            description: null,
            status: 'ARCHIVED' as const,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      ])
      const svc = new AddOnService(
        new InMemoryAddOnRepository(),
        new InMemoryAddOnTemplateRepository(store),
      )
      const result = await svc.create(ctxFor(opA), createInput(opA, ETC_CARD), LOCALE)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(400)
    })

    it('maps a unique-violation that slips past the pre-check (lost race) to 409', async () => {
      vi.spyOn(repo, 'findActiveByOperatorAndTemplate').mockResolvedValue(undefined)
      vi.spyOn(repo, 'create').mockRejectedValue(uniqueViolation())
      const result = await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })

    it('creates a SELF-AUTHORED add-on from a nameI18n bundle and resolves its name', async () => {
      const result = await service.create(
        ctxFor(opA),
        selfAuthoredInput(opA, { en: 'GPS unit', ja: 'GPS ユニット' }),
        'ja',
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.option.templateId).toBeNull()
        expect(result.option.nameI18n).toEqual({ en: 'GPS unit', ja: 'GPS ユニット' })
        expect(result.option.resolvedName).toBe('GPS ユニット')
      }
    })

    it('does not treat a self-authored create as an unknown template (no 400)', async () => {
      // A self-authored create must never hit the template lookup — no templateId.
      const result = await service.create(
        ctxFor(opA),
        selfAuthoredInput(opA, { en: 'Dashcam' }),
        LOCALE,
      )
      expect(result.ok).toBe(true)
    })

    it('rejects a second self-authored add-on with the same en name (distinct 409)', async () => {
      await service.create(ctxFor(opA), selfAuthoredInput(opA, { en: 'GPS unit' }), LOCALE)
      const result = await service.create(
        ctxFor(opA),
        selfAuthoredInput(opA, { en: 'GPS unit', ja: '別' }),
        LOCALE,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe(409)
        expect(result.error).toBe('You already offer an add-on with this name')
      }
    })

    it('maps a self-authored lost-race unique-violation to a 409 name clash', async () => {
      vi.spyOn(repo, 'findActiveByOperatorAndName').mockResolvedValue(undefined)
      vi.spyOn(repo, 'create').mockRejectedValue(uniqueViolation())
      const result = await service.create(
        ctxFor(opA),
        selfAuthoredInput(opA, { en: 'GPS unit' }),
        LOCALE,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.status).toBe(409)
        expect(result.error).toBe('You already offer an add-on with this name')
      }
    })
  })

  describe('update', () => {
    it('updates the price for an owned add-on', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      if (!created.ok) throw new Error('seed failed')
      const result = await service.update(
        ctxFor(opA),
        created.option.id,
        { priceJpy: 3000 },
        LOCALE,
      )
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.option.priceJpy).toBe(3000)
    })

    it('updates the description override and reflects it in resolvedDescription', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      if (!created.ok) throw new Error('seed failed')
      const result = await service.update(
        ctxFor(opA),
        created.option.id,
        { descriptionOverride: { en: 'Our own copy' } },
        'en',
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.option.descriptionOverride).toEqual({ en: 'Our own copy' })
        expect(result.option.resolvedDescription).toBe('Our own copy')
      }
    })

    it('returns 404 (not 403) when the id belongs to another operator', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      if (!created.ok) throw new Error('seed failed')
      const result = await service.update(ctxFor(opB), created.option.id, { priceJpy: 1 }, LOCALE)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(404)
    })

    it('loads the row (scoped) before writing, never writes on a cross-tenant id', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      if (!created.ok) throw new Error('seed failed')
      const updateSpy = vi.spyOn(repo, 'update')
      await service.update(ctxFor(opB), created.option.id, { priceJpy: 1 }, LOCALE)
      expect(updateSpy).not.toHaveBeenCalled()
    })

    it('edits a self-authored item name — adds a locale and re-resolves (D5)', async () => {
      const created = await service.create(
        ctxFor(opA),
        selfAuthoredInput(opA, { en: 'GPS unit' }),
        LOCALE,
      )
      if (!created.ok) throw new Error('seed failed')
      const result = await service.update(
        ctxFor(opA),
        created.option.id,
        { nameI18n: { en: 'GPS unit', ja: 'GPS ユニット' } },
        'ja',
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.option.nameI18n).toEqual({ en: 'GPS unit', ja: 'GPS ユニット' })
        expect(result.option.resolvedName).toBe('GPS ユニット')
      }
    })

    it('rejects a nameI18n edit on a PICKED row (its name comes from the template)', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      if (!created.ok) throw new Error('seed failed')
      const result = await service.update(
        ctxFor(opA),
        created.option.id,
        { nameI18n: { en: 'My own name' } },
        LOCALE,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(400)
    })

    it('rejects a self-authored rename that collides with another active name (409)', async () => {
      await service.create(ctxFor(opA), selfAuthoredInput(opA, { en: 'Dashcam' }), LOCALE)
      const second = await service.create(
        ctxFor(opA),
        selfAuthoredInput(opA, { en: 'GPS unit' }),
        LOCALE,
      )
      if (!second.ok) throw new Error('seed failed')
      const result = await service.update(
        ctxFor(opA),
        second.option.id,
        { nameI18n: { en: 'Dashcam' } },
        LOCALE,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(409)
    })
  })

  describe('archive', () => {
    it('sets status to ARCHIVED for an owned add-on', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      if (!created.ok) throw new Error('seed failed')
      const result = await service.archive(ctxFor(opA), created.option.id, LOCALE)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.option.status).toBe('ARCHIVED')
    })

    it('returns 404 and does not write when archiving another operator add-on', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      if (!created.ok) throw new Error('seed failed')
      const archiveSpy = vi.spyOn(repo, 'archive')
      const result = await service.archive(ctxFor(opB), created.option.id, LOCALE)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.status).toBe(404)
      expect(archiveSpy).not.toHaveBeenCalled()
    })

    it('frees the template so the operator can offer it again after archiving', async () => {
      const created = await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      if (!created.ok) throw new Error('seed failed')
      await service.archive(ctxFor(opA), created.option.id, LOCALE)
      const recreated = await service.create(ctxFor(opA), createInput(opA, CHILD_SEAT), LOCALE)
      expect(recreated.ok).toBe(true)
    })
  })
})
