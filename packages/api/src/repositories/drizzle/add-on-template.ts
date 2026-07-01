import { addOnTemplates } from '@kuruma/shared/db/schema'
import { asc, eq } from 'drizzle-orm'
import type { AddOnTemplate } from '../../stores'
import type { AddOnTemplateRepository } from '../types'
import type { Db } from './shared'

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
      .select({
        id: addOnTemplates.id,
        key: addOnTemplates.key,
        name: addOnTemplates.name,
        description: addOnTemplates.description,
        status: addOnTemplates.status,
        createdAt: addOnTemplates.createdAt,
        updatedAt: addOnTemplates.updatedAt,
      })
      .from(addOnTemplates)
      .where(eq(addOnTemplates.status, 'ACTIVE'))
      .orderBy(asc(addOnTemplates.key))
  }
}
