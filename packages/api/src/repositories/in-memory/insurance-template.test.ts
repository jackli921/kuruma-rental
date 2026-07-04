import { describe, expect, it } from 'vitest'
import type { InsuranceTemplate } from '../../stores'
import { InMemoryInsuranceTemplateRepository } from './insurance-template'
import { seedDemoInsuranceTemplates } from './insurance-template-seed'

describe('InMemoryInsuranceTemplateRepository', () => {
  it('findAll returns the curated demo catalog with localized bundles intact', async () => {
    const repo = new InMemoryInsuranceTemplateRepository()
    const all = await repo.findAll()

    const normal = all.find((t) => t.key === 'normal')
    expect(normal?.name).toEqual({ en: 'Normal', ja: 'ノーマル', zh: '标准' })
    expect(normal?.status).toBe('ACTIVE')
    expect(all.map((t) => t.key).sort()).toEqual(['normal', 'premium'])
  })

  it('findAll includes ARCHIVED rows (the admin library sees every status)', async () => {
    const store = new Map<string, InsuranceTemplate>([
      [
        'ins_archived',
        {
          id: 'ins_archived',
          key: 'legacy-tier',
          name: { en: 'Legacy tier' },
          description: null,
          status: 'ARCHIVED',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    ])
    const repo = new InMemoryInsuranceTemplateRepository(store)

    const all = await repo.findAll()
    expect(all.map((t) => t.status)).toContain('ARCHIVED')
  })

  it('findById returns the matching template, undefined otherwise', async () => {
    const store = seedDemoInsuranceTemplates()
    const [id, seeded] = [...store.entries()][0] ?? []
    const repo = new InMemoryInsuranceTemplateRepository(store)

    expect(await repo.findById(id ?? '')).toEqual(seeded)
    expect(await repo.findById('nope')).toBeUndefined()
  })

  describe('update', () => {
    const OLD = new Date('2020-01-01T00:00:00Z')
    function archivedStore(): Map<string, InsuranceTemplate> {
      return new Map([
        [
          'ins_1',
          {
            id: 'ins_1',
            key: 'legacy-tier',
            name: { en: 'Legacy tier' },
            description: null,
            status: 'ARCHIVED',
            createdAt: OLD,
            updatedAt: OLD,
          },
        ],
      ])
    }

    it('merges the localized bundles and bumps updatedAt, leaving id/key/createdAt intact', async () => {
      const repo = new InMemoryInsuranceTemplateRepository(archivedStore())

      const updated = await repo.update('ins_1', {
        name: { en: 'Legacy tier', ja: 'レガシー', zh: '旧版' },
        description: { en: 'Older coverage tier' },
      })

      expect(updated?.name).toEqual({ en: 'Legacy tier', ja: 'レガシー', zh: '旧版' })
      expect(updated?.description).toEqual({ en: 'Older coverage tier' })
      expect(updated?.id).toBe('ins_1')
      expect(updated?.key).toBe('legacy-tier')
      expect(updated?.createdAt).toEqual(OLD)
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(OLD.getTime())
      // status untouched when the patch omits it
      expect(updated?.status).toBe('ARCHIVED')
    })

    it('promotes an ARCHIVED row to ACTIVE via a status-only patch', async () => {
      const repo = new InMemoryInsuranceTemplateRepository(archivedStore())

      const updated = await repo.update('ins_1', { status: 'ACTIVE' })

      expect(updated?.status).toBe('ACTIVE')
      expect(updated?.name).toEqual({ en: 'Legacy tier' })
      expect((await repo.findById('ins_1'))?.status).toBe('ACTIVE')
    })

    it('clears the description when the patch sets it null', async () => {
      const store = archivedStore()
      const row = store.get('ins_1')
      if (row) store.set('ins_1', { ...row, description: { en: 'has one' } })
      const repo = new InMemoryInsuranceTemplateRepository(store)

      const updated = await repo.update('ins_1', { description: null })

      expect(updated?.description).toBeNull()
    })

    it('returns undefined for an unknown id and writes nothing', async () => {
      const repo = new InMemoryInsuranceTemplateRepository(archivedStore())

      expect(await repo.update('nope', { status: 'ACTIVE' })).toBeUndefined()
      expect((await repo.findById('ins_1'))?.status).toBe('ARCHIVED')
    })
  })
})
