import { insuranceTemplates } from '@kuruma/shared/db/schema'
import type { TemplatePatch } from '@kuruma/shared/types/template-admin'
import { asc, eq } from 'drizzle-orm'
import type { InsuranceTemplate } from '../../stores'
import type { InsuranceTemplateRepository } from '../types'
import type { Db } from './shared'
import { templatePatchColumns } from './template-patch-columns'

/**
 * The platform-owned insurance template catalog (catalog i18n, slice 3). Global,
 * not tenant-scoped, so no ctx. Mirrors `DrizzleAddOnTemplateRepository` over
 * `insurance_templates`; `name` / `description` come back as their raw
 * LocalizedText JSONB bundles (the admin curates them raw). Key-ordered for a
 * stable sequence. `findAll` is the platform-admin library read (#1319) — it
 * returns ARCHIVED rows too, so the admin can promote backfill-minted templates.
 */
export class DrizzleInsuranceTemplateRepository implements InsuranceTemplateRepository {
  constructor(private readonly db: Db) {}

  async findAll(): Promise<InsuranceTemplate[]> {
    return this.db
      .select(TEMPLATE_COLUMNS)
      .from(insuranceTemplates)
      .orderBy(asc(insuranceTemplates.key))
  }

  async findById(id: string): Promise<InsuranceTemplate | undefined> {
    const [row] = await this.db
      .select(TEMPLATE_COLUMNS)
      .from(insuranceTemplates)
      .where(eq(insuranceTemplates.id, id))
      .limit(1)
    return row
  }

  async update(id: string, patch: TemplatePatch): Promise<InsuranceTemplate | undefined> {
    const [row] = await this.db
      .update(insuranceTemplates)
      .set({ ...templatePatchColumns(patch), updatedAt: new Date() })
      .where(eq(insuranceTemplates.id, id))
      .returning(TEMPLATE_COLUMNS)
    return row
  }
}

const TEMPLATE_COLUMNS = {
  id: insuranceTemplates.id,
  key: insuranceTemplates.key,
  name: insuranceTemplates.name,
  description: insuranceTemplates.description,
  status: insuranceTemplates.status,
  createdAt: insuranceTemplates.createdAt,
  updatedAt: insuranceTemplates.updatedAt,
} as const
