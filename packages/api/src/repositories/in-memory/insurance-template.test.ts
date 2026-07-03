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
})
