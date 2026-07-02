import type { Locale } from '@kuruma/shared/i18n/locales'
import type { LocalizedTextOverride } from '@kuruma/shared/i18n/localized-text'

/**
 * Set one locale slot of an operator's authored description override, merging into
 * the raw bag rather than replacing it. The add-on form only edits the caller's UI
 * locale (a single textarea), so this preserves any other locales the operator (or
 * a translator) already authored. A cleared slot is dropped; an empty bag collapses
 * to `null` (the "no override" wire value). Pure + immutable — the input is never
 * mutated, so callers can pass a query-cached bag straight in.
 */
export function setLocaleSlot(
  existing: LocalizedTextOverride | null,
  locale: Locale,
  value: string,
): LocalizedTextOverride | null {
  const trimmed = value.trim()
  const merged: LocalizedTextOverride = { ...existing, [locale]: trimmed || undefined }
  const entries = Object.entries(merged).filter(([, v]) => Boolean(v))
  return entries.length > 0 ? (Object.fromEntries(entries) as LocalizedTextOverride) : null
}
