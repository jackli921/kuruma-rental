import type { SearchResultItem } from '@kuruma/shared/types/search-result'

/** Stable list key — the renter-safe per-car id for SPECIFIC, the class id for a
 *  future CLASS_COMBO row (#464). Shared by the flat list and the map+list view. */
export function searchResultKey(item: SearchResultItem): string {
  return item.kind === 'SPECIFIC' ? item.vehicleId : item.classId
}

type Translate = (key: string, values?: Record<string, string | number>) => string

/** Human title of a result row: the car name (SPECIFIC) or class label (CLASS_COMBO). */
export function resultTitle(item: SearchResultItem): string {
  return item.kind === 'SPECIFIC' ? item.name : item.classLabel
}

/** "From ¥X / day" (or hourly, or price-on-request) — shared by the list row and
 *  the map popup so they never drift. `t` is the use-intl translator. */
export function resultPriceLabel(item: SearchResultItem, t: Translate): string {
  if (item.dailyRateJpy != null)
    return t('fromDaily', { price: item.dailyRateJpy.toLocaleString('en-US') })
  if (item.hourlyRateJpy != null)
    return t('fromHourly', { price: item.hourlyRateJpy.toLocaleString('en-US') })
  return t('noPrice')
}
