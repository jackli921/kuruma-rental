import { CATALOG_TEMPLATE_STATUSES, type CatalogTemplateStatus } from '@kuruma/shared/enums'
import type { Locale } from '@kuruma/shared/i18n/locales'
import type { LocalizedText } from '@kuruma/shared/i18n/localized-text'
import type { TemplateAdminRow, TemplatePatch } from '@kuruma/shared/types/template-admin'

/** One text field per supported locale (always a string, never undefined — a
 *  controlled input's value). Absent bundle locales render as empty strings. */
export type BundleForm = Record<Locale, string>

export interface TemplateForm {
  name: BundleForm
  description: BundleForm
  status: CatalogTemplateStatus
}

/** Narrow a raw `<select>` value to a catalog status. The options are exactly
 *  CATALOG_TEMPLATE_STATUSES so an unknown value never arises in practice — this
 *  keeps the onChange handler assertion-free (type guard over `as`). */
export function isCatalogTemplateStatus(value: string): value is CatalogTemplateStatus {
  return (CATALOG_TEMPLATE_STATUSES as readonly string[]).includes(value)
}

function bundleToForm(bundle: LocalizedText | null): BundleForm {
  return { en: bundle?.en ?? '', ja: bundle?.ja ?? '', zh: bundle?.zh ?? '' }
}

/** Seed the edit form from a persisted row — each locale to its own field, a
 *  null description to blank fields. Pure; the dialog owns the mutable copy. */
export function formFromRow(row: TemplateAdminRow): TemplateForm {
  return {
    name: bundleToForm(row.name),
    description: bundleToForm(row.description),
    status: row.status,
  }
}

/**
 * Collapse a bundle form into a `LocalizedText`, or null when en is blank.
 * `en` is the required fallback (`localizedTextSchema`): with no en there is no
 * bundle, so a description whose en is empty CLEARS to null. ja/zh are included
 * only when non-empty. Trims every value so a whitespace-only field never
 * persists a blank slot.
 */
function toBundle(form: BundleForm): LocalizedText | null {
  const en = form.en.trim()
  if (!en) return null
  const ja = form.ja.trim()
  const zh = form.zh.trim()
  return { en, ...(ja ? { ja } : {}), ...(zh ? { zh } : {}) }
}

/**
 * Build the `PATCH` body from the edit form. `name` requires en (the Save button
 * stays disabled while it is blank, so a null name never reaches here — but it is
 * omitted defensively rather than sent as an invalid bundle); `description` is
 * sent as its bundle or explicit null (a real clear); `status` always rides along
 * so a single Save both translates and promotes/archives.
 */
export function buildTemplatePatch(form: TemplateForm): TemplatePatch {
  const name = toBundle(form.name)
  return {
    ...(name ? { name } : {}),
    description: toBundle(form.description),
    status: form.status,
  }
}
