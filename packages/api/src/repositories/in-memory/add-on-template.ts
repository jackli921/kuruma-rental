import { DEMO_ADD_ON_TEMPLATES } from '@kuruma/shared/db/seed-data'
import { seedId } from '@kuruma/shared/db/seed-id'
import type { AddOnTemplate } from '../../stores'
import type { AddOnTemplateRepository } from '../types'

/**
 * Local-dev / route-suite double for the global add-on template catalog. An
 * empty constructor pre-seeds the curated demo catalog with the SAME ids the
 * real seed derives (`seedId('tmpl_' + key)`), so an in-memory app renders the
 * same picker production does; a test that needs archived rows passes its own
 * store.
 */
function seedDemoTemplates(): Map<string, AddOnTemplate> {
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

export class InMemoryAddOnTemplateRepository implements AddOnTemplateRepository {
  private readonly store: Map<string, AddOnTemplate>

  constructor(store?: Map<string, AddOnTemplate>) {
    this.store = store ?? seedDemoTemplates()
  }

  async findActive(): Promise<AddOnTemplate[]> {
    return [...this.store.values()].filter((t) => t.status === 'ACTIVE')
  }
}
