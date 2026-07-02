import { insuranceTemplates } from '@kuruma/shared/db/schema'
import { DEMO_INSURANCE_TEMPLATES } from '@kuruma/shared/db/seed-data'
import { seedId } from '@kuruma/shared/db/seed-id'
import { inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from './setup'

// H1: the curated insurance template catalog lives in TWO forms that cannot import
// each other — the TS constant (DEMO_INSURANCE_TEMPLATES, the source) and the raw
// INSERT SQL in migration 0097. The completeness unit test iterates only the TS
// side, so a template missing or wrong in the SQL would pass it silently — the
// exact English-fallback bug this feature fixes. This test reads the migrated
// rows back and asserts they equal the constant (ids, keys, all-locale bundles),
// closing the cross-artifact drift gap.
describe('insurance_templates migration seed == TS constant (H1)', () => {
  it('seeds every curated template with the exact id, key and localized bundles', async () => {
    const keys = DEMO_INSURANCE_TEMPLATES.map((t) => t.key)
    const rows = await db
      .select({
        id: insuranceTemplates.id,
        key: insuranceTemplates.key,
        name: insuranceTemplates.name,
        description: insuranceTemplates.description,
        status: insuranceTemplates.status,
      })
      .from(insuranceTemplates)
      .where(inArray(insuranceTemplates.key, keys))

    // Every curated key resolved to exactly one migrated row.
    expect(rows).toHaveLength(DEMO_INSURANCE_TEMPLATES.length)

    const rowsByKey = new Map(rows.map((r) => [r.key, r]))
    for (const template of DEMO_INSURANCE_TEMPLATES) {
      const row = rowsByKey.get(template.key)
      expect(row, `no migrated row for template "${template.key}"`).toBeDefined()
      // The migration hardcodes seedId('tmpl_<key>'); the TS side derives the
      // same id, so a mismatch means the SQL id column drifted.
      expect(row?.id).toBe(seedId(`tmpl_${template.key}`))
      expect(row?.name).toEqual(template.name)
      expect(row?.description).toEqual(template.description)
      // Seeded templates are ACTIVE (only backfill-minted ones are ARCHIVED).
      expect(row?.status).toBe('ACTIVE')
    }
  })
})
