import { addOnTemplates } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { DrizzleAddOnTemplateRepository } from '../../src/repositories/drizzle'
import { db } from './setup'

// Synthetic keys (unique per run) so this file never collides with the seeded
// catalog or a parallel test file on add_on_templates_key_unique.
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const ACTIVE_KEY = `test_tmpl_active_${uniq}`
const ARCHIVED_KEY = `test_tmpl_archived_${uniq}`

describe('DrizzleAddOnTemplateRepository.findActive', () => {
  afterAll(async () => {
    await db.delete(addOnTemplates).where(inArray(addOnTemplates.key, [ACTIVE_KEY, ARCHIVED_KEY]))
  })

  it('returns ACTIVE rows with their localized bundles intact, excluding ARCHIVED', async () => {
    await db.insert(addOnTemplates).values([
      {
        id: crypto.randomUUID(),
        key: ACTIVE_KEY,
        name: { en: 'Roof box', ja: 'ルーフボックス', zh: '车顶箱' },
        description: { en: 'Extra luggage space, fitted at pickup.' },
        status: 'ACTIVE',
      },
      {
        id: crypto.randomUUID(),
        key: ARCHIVED_KEY,
        name: { en: 'Retired item' },
        description: null,
        status: 'ARCHIVED',
      },
    ])

    const repo = new DrizzleAddOnTemplateRepository(db)
    const active = await repo.findActive()

    const found = active.find((t) => t.key === ACTIVE_KEY)
    expect(found?.name).toEqual({ en: 'Roof box', ja: 'ルーフボックス', zh: '车顶箱' })
    expect(found?.status).toBe('ACTIVE')
    expect(active.map((t) => t.key)).not.toContain(ARCHIVED_KEY)
  })
})
