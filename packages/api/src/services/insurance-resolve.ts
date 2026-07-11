import type { Locale } from '@kuruma/shared/i18n/locales'
import { resolveLocalized } from '@kuruma/shared/i18n/localized-text'
import type { InsuranceOption } from '../stores'

/**
 * Catalog i18n (#1437 slice 3b): the one pure resolver that turns an insurance
 * read row into a caller-locale label. Insurance is PURELY self-authored (no
 * template, unlike add-ons), so there are only two shapes:
 *
 * - SELF-AUTHORED (`nameI18n` present): the operator's own bundle drives the name,
 *   floored to English for any locale it omits (`resolveLocalized`).
 * - LEGACY (`nameI18n` null, pre-slice-3 rows): fall back to the `name` mirror.
 *
 * Shared by the operator service projection (`toInsuranceOptionData`) and the
 * renter storefront read so the fallback rule stays in ONE place.
 */
export function resolveInsuranceName(row: InsuranceOption, locale: Locale): string {
  if (row.nameI18n) return resolveLocalized(row.nameI18n, locale)
  return row.name
}
