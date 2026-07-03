import { DEMO_INSURANCE_TEMPLATES } from '@kuruma/shared/db/seed-data'
import { seedId } from '@kuruma/shared/db/seed-id'
import type { InsuranceTemplate } from '../../stores'

/**
 * The curated insurance template catalog as an in-memory Map, keyed by id with
 * the SAME ids the real seed derives (`seedId('tmpl_' + key)`), so a dev/test
 * app's admin library matches production. Mirrors `seedDemoAddOnTemplates`; every
 * seeded template is ACTIVE (backfill-minted ARCHIVED rows exist only against a
 * real DB, so tests that need one pass their own store).
 */
export function seedDemoInsuranceTemplates(): Map<string, InsuranceTemplate> {
  const now = new Date()
  const store = new Map<string, InsuranceTemplate>()
  for (const t of DEMO_INSURANCE_TEMPLATES) {
    const id = seedId(`tmpl_${t.key}`)
    store.set(id, {
      id,
      key: t.key,
      name: t.name,
      description: t.description,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    })
  }
  return store
}
