import type { TemplatePatch } from '@kuruma/shared/types/template-admin'
import type { InsuranceTemplate } from '../../stores'
import type { InsuranceTemplateRepository, TemplateCreateInput } from '../types'
import { seedDemoInsuranceTemplates } from './insurance-template-seed'
import { insertTemplate, mergeTemplatePatch } from './template-patch'

const KEY_CONSTRAINT = 'insurance_templates_key_unique'

/**
 * Local-dev / route-suite double for the global insurance template catalog.
 * Mirrors `InMemoryAddOnTemplateRepository`: an empty constructor pre-seeds the
 * curated demo catalog with the SAME ids the real seed derives, so an in-memory
 * app renders the same admin library production does; a test that needs ARCHIVED
 * rows passes its own store. `findAll` returns EVERY status (the admin read).
 */
export class InMemoryInsuranceTemplateRepository implements InsuranceTemplateRepository {
  private readonly store: Map<string, InsuranceTemplate>

  constructor(store?: Map<string, InsuranceTemplate>) {
    this.store = store ?? seedDemoInsuranceTemplates()
  }

  async findAll(): Promise<InsuranceTemplate[]> {
    return [...this.store.values()].sort((a, b) => a.key.localeCompare(b.key))
  }

  async findById(id: string): Promise<InsuranceTemplate | undefined> {
    return this.store.get(id)
  }

  async update(id: string, patch: TemplatePatch): Promise<InsuranceTemplate | undefined> {
    const current = this.store.get(id)
    if (!current) return undefined
    const updated = mergeTemplatePatch(current, patch)
    this.store.set(id, updated)
    return updated
  }

  async create(input: TemplateCreateInput): Promise<InsuranceTemplate> {
    return insertTemplate(this.store, input, KEY_CONSTRAINT)
  }
}
