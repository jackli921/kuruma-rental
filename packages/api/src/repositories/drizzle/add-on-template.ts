import { addOnTemplates } from '@kuruma/shared/db/schema'
import type { TemplatePatch } from '@kuruma/shared/types/template-admin'
import { asc, eq } from 'drizzle-orm'
import type { AddOnTemplate } from '../../stores'
import type { AddOnTemplateRepository, TemplateCreateInput } from '../types'
import type { Db } from './shared'
import { templatePatchColumns } from './template-patch-columns'

/**
 * The platform-owned add-on template catalog (catalog i18n, epic #385). Global,
 * not tenant-scoped, so no ctx — every operator picks from the same list. Exposes
 * only ACTIVE rows (a picker never offers a retired template); `name` /
 * `description` come back as their raw LocalizedText JSONB bundles, resolved to
 * the caller locale in the service. Key-ordered for a stable base sequence (the
 * service re-sorts by resolved name).
 */
export class DrizzleAddOnTemplateRepository implements AddOnTemplateRepository {
  constructor(private readonly db: Db) {}

  async findActive(): Promise<AddOnTemplate[]> {
    return this.db
      .select(TEMPLATE_COLUMNS)
      .from(addOnTemplates)
      .where(eq(addOnTemplates.status, 'ACTIVE'))
      .orderBy(asc(addOnTemplates.key))
  }

  async findAll(): Promise<AddOnTemplate[]> {
    return this.db.select(TEMPLATE_COLUMNS).from(addOnTemplates).orderBy(asc(addOnTemplates.key))
  }

  async findById(id: string): Promise<AddOnTemplate | undefined> {
    const [row] = await this.db
      .select(TEMPLATE_COLUMNS)
      .from(addOnTemplates)
      .where(eq(addOnTemplates.id, id))
      .limit(1)
    return row
  }

  async update(id: string, patch: TemplatePatch): Promise<AddOnTemplate | undefined> {
    const [row] = await this.db
      .update(addOnTemplates)
      .set({ ...templatePatchColumns(patch), updatedAt: new Date() })
      .where(eq(addOnTemplates.id, id))
      .returning(TEMPLATE_COLUMNS)
    return row
  }

  async create(input: TemplateCreateInput): Promise<AddOnTemplate> {
    // id + createdAt/updatedAt are DB-defaulted (crypto.randomUUID / now()). A
    // duplicate key trips add_on_templates_key_unique (23505) -> service 409.
    const [row] = await this.db.insert(addOnTemplates).values(input).returning(TEMPLATE_COLUMNS)
    if (!row) throw new Error('Failed to insert add-on template')
    return row
  }
}

const TEMPLATE_COLUMNS = {
  id: addOnTemplates.id,
  key: addOnTemplates.key,
  name: addOnTemplates.name,
  description: addOnTemplates.description,
  status: addOnTemplates.status,
  createdAt: addOnTemplates.createdAt,
  updatedAt: addOnTemplates.updatedAt,
} as const
