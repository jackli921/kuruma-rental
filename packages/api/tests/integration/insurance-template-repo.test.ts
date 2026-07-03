import { insuranceTemplates } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { DrizzleInsuranceTemplateRepository } from '../../src/repositories/drizzle'
import { db } from './setup'

// Synthetic keys (unique per run) so this file never collides with the seeded
// catalog or a parallel test file on insurance_templates_key_unique.
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const ACTIVE_KEY = `test_ins_active_${uniq}`
const ARCHIVED_KEY = `test_ins_archived_${uniq}`

describe('DrizzleInsuranceTemplateRepository.findAll', () => {
  afterAll(async () => {
    await db
      .delete(insuranceTemplates)
      .where(inArray(insuranceTemplates.key, [ACTIVE_KEY, ARCHIVED_KEY]))
  })

  it('returns BOTH ACTIVE and ARCHIVED rows with bundles intact (the admin library read)', async () => {
    await db.insert(insuranceTemplates).values([
      {
        id: crypto.randomUUID(),
        key: ACTIVE_KEY,
        name: { en: 'Full cover', ja: 'フルカバー', zh: '全险' },
        description: { en: 'Zero-deductible collision cover.' },
        status: 'ACTIVE',
      },
      {
        id: crypto.randomUUID(),
        key: ARCHIVED_KEY,
        name: { en: 'Retired tier' },
        description: null,
        status: 'ARCHIVED',
      },
    ])

    const repo = new DrizzleInsuranceTemplateRepository(db)
    const all = await repo.findAll()

    const active = all.find((t) => t.key === ACTIVE_KEY)
    expect(active?.name).toEqual({ en: 'Full cover', ja: 'フルカバー', zh: '全险' })
    expect(active?.status).toBe('ACTIVE')
    // The admin library MUST surface backfill-minted ARCHIVED rows so they can be promoted.
    const archived = all.find((t) => t.key === ARCHIVED_KEY)
    expect(archived?.status).toBe('ARCHIVED')
  })

  it('findById returns a single row of any status, undefined when absent', async () => {
    const id = crypto.randomUUID()
    const key = `test_ins_byid_${uniq}`
    await db
      .insert(insuranceTemplates)
      .values({ id, key, name: { en: 'By id' }, description: null, status: 'ARCHIVED' })

    const repo = new DrizzleInsuranceTemplateRepository(db)
    expect((await repo.findById(id))?.key).toBe(key)
    expect(await repo.findById(crypto.randomUUID())).toBeUndefined()

    await db.delete(insuranceTemplates).where(inArray(insuranceTemplates.key, [key]))
  })
})
