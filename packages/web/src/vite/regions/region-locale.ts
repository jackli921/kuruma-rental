import type { RegionNode } from '@kuruma/shared/types/region'

// The renter/operator UI is trilingual; the API returns all three names per node and the
// client picks one by route locale. This module is the single source of truth for that
// choice AND for the locale-aware ordering + search rules (#1543) — previously the
// `nameOf` selector was copy-pasted across RegionPicker and RegionCascade.

/** Display name for the active locale, falling back to English when a localized name is blank. */
export function regionName(region: RegionNode, locale: string): string {
  if (locale === 'ja') return region.nameJa || region.nameEn
  if (locale === 'zh') return region.nameZh || region.nameEn
  return region.nameEn
}

/**
 * Order a level's options for display.
 * - `en`: alphabetical by English name (easier to scan than the JP prefecture-code order).
 * - `ja` / `zh`: keep the API's `sortOrder` sequence (the familiar Hokkaido→Okinawa order).
 *
 * Returns a new array; never mutates the input. The `en` sort is authoritative — the API
 * orders by `(sortOrder, nameEn)`, so `nameEn` is only a within-group tiebreak there, not
 * a global A-Z; we re-sort client-side rather than half-rely on server order.
 */
export function orderRegionsForLocale(
  regions: readonly RegionNode[],
  locale: string,
): RegionNode[] {
  if (locale === 'en') {
    return [...regions].sort((a, b) => a.nameEn.localeCompare(b.nameEn, 'en'))
  }
  return [...regions]
}

// Case- and accent-insensitive fold: NFD splits accented letters into base + combining
// mark, then we strip the marks so "Kyōto" and "kyoto" compare equal.
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/**
 * Whether a region matches a type-to-search query. Matches the active-locale display name
 * OR the romanized (English) name, so an English typer can find a Japanese-labelled entry
 * ("osaka" finds 大阪). Empty/whitespace query matches everything.
 */
export function regionMatchesQuery(region: RegionNode, query: string, locale: string): boolean {
  const needle = fold(query)
  if (needle === '') return true
  return fold(regionName(region, locale)).includes(needle) || fold(region.nameEn).includes(needle)
}
