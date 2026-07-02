import { DEMO_ADD_ON_TEMPLATES } from '@kuruma/shared/db/seed-data'
import { seedId } from '@kuruma/shared/db/seed-id'
import type { AddOnTemplate } from '../../stores'

/**
 * The curated add-on template catalog as an in-memory Map, keyed by id with the
 * SAME ids the real seed derives (`seedId('tmpl_' + key)`). Shared by the
 * in-memory template repo (the picker) AND the in-memory add-on repo's JOIN
 * store (M4), so a dev/test app's list and picker agree without wiring the same
 * Map through both. Every seeded template is ACTIVE.
 */
export function seedDemoAddOnTemplates(): Map<string, AddOnTemplate> {
  const now = new Date()
  const store = new Map<string, AddOnTemplate>()
  for (const t of DEMO_ADD_ON_TEMPLATES) {
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
