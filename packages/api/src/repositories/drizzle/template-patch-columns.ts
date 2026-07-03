import type { LocalizedText } from '@kuruma/shared/i18n/localized-text'
import type { CatalogTemplateStatus } from '@kuruma/shared/enums'
import type { TemplatePatch } from '@kuruma/shared/types/template-admin'

type TemplateSetColumns = {
  name?: LocalizedText
  description?: LocalizedText | null
  status?: CatalogTemplateStatus
}

/**
 * Build the drizzle `.set()` column subset for a #1319 admin template patch,
 * copying ONLY the fields the caller supplied. An absent field is left out
 * entirely (leaving the column untouched); `description: null` is a real clear,
 * so each field is gated on `!== undefined`, never truthiness. The caller adds
 * `updatedAt`. Shared by the add-on and insurance drizzle repos.
 */
export function templatePatchColumns(patch: TemplatePatch): TemplateSetColumns {
  const cols: TemplateSetColumns = {}
  if (patch.name !== undefined) cols.name = patch.name
  if (patch.description !== undefined) cols.description = patch.description
  if (patch.status !== undefined) cols.status = patch.status
  return cols
}
