import type { Locale } from '@kuruma/shared/i18n/locales'
import { resolveDescription, resolveLocalized } from '@kuruma/shared/i18n/localized-text'
import type { AddOnWithTemplate } from '../stores'

/**
 * Catalog i18n (slice 2): the two pure resolvers that turn a joined add-on read
 * row into a caller-locale label + description. Shared by the operator service
 * projection (OperatorAddOnData) and the renter storefront read so the fallback
 * rules stay in ONE place.
 *
 * Legacy fallback: a null-templateId row (PR1 window) carries no JOIN bundle, so
 * `templateName`/`templateDescription` are null — resolution then reads the
 * `name`/`description` columns the free-text write path still populates.
 */
export function resolveAddOnName(row: AddOnWithTemplate, locale: Locale): string {
  return row.templateName ? resolveLocalized(row.templateName, locale) : row.name
}

export function resolveAddOnDescription(row: AddOnWithTemplate, locale: Locale): string | null {
  return row.templateName
    ? resolveDescription(row.descriptionOverride, row.templateDescription, locale)
    : row.description
}
