import type { AddOnTemplate } from '../../stores'
import type { AddOnTemplateRepository } from '../types'
import { seedDemoAddOnTemplates } from './add-on-template-seed'

/**
 * Local-dev / route-suite double for the global add-on template catalog. An
 * empty constructor pre-seeds the curated demo catalog with the SAME ids the
 * real seed derives (`seedId('tmpl_' + key)`), so an in-memory app renders the
 * same picker production does; a test that needs archived rows passes its own
 * store. The seed builder is shared with the in-memory add-on repo's JOIN store
 * (M4), so the list and the picker agree.
 */
export class InMemoryAddOnTemplateRepository implements AddOnTemplateRepository {
  private readonly store: Map<string, AddOnTemplate>

  constructor(store?: Map<string, AddOnTemplate>) {
    this.store = store ?? seedDemoAddOnTemplates()
  }

  async findActive(): Promise<AddOnTemplate[]> {
    return [...this.store.values()].filter((t) => t.status === 'ACTIVE')
  }

  async findById(id: string): Promise<AddOnTemplate | undefined> {
    return this.store.get(id)
  }
}
