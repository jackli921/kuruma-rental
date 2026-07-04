import type { Locale } from '@kuruma/shared/i18n/locales'
import {
  resolveDescription,
  resolveLocalized,
  resolveOwnDescription,
} from '@kuruma/shared/i18n/localized-text'
import type { AddOnWithTemplate } from '../stores'

/**
 * Catalog i18n: the two pure resolvers that turn a joined add-on read row into a
 * caller-locale label + description. Shared by the operator service projection
 * (OperatorAddOnData) and the renter storefront read so the fallback rules stay in
 * ONE place. Three row shapes (#1437), discriminated in priority order:
 *
 * - PICKED (`templateName` present): the shared template supplies the name and the
 *   description floor — admin curation propagates live.
 * - SELF-AUTHORED (`nameI18n` present, no template): the operator's own bundle
 *   drives the name; the description floors to any present locale (no template).
 * - LEGACY (both null, PR1 window): fall back to the `name`/`description` columns.
 */
export function resolveAddOnName(row: AddOnWithTemplate, locale: Locale): string {
  if (row.templateName) return resolveLocalized(row.templateName, locale)
  if (row.nameI18n) return resolveLocalized(row.nameI18n, locale)
  return row.name
}

export function resolveAddOnDescription(row: AddOnWithTemplate, locale: Locale): string | null {
  if (row.templateName) {
    return resolveDescription(row.descriptionOverride, row.templateDescription, locale)
  }
  if (row.nameI18n) return resolveOwnDescription(row.descriptionOverride, locale)
  return row.description
}
