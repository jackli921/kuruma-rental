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

/** All results at one pickup location, in input order. The map plots one pin per
 *  location (a co-located cluster); the popup carousel (#885 slice 2) walks the whole
 *  group and the pin's price label is the group minimum. */
export interface LocationGroup {
  locationId: string
  items: SearchResultItem[]
}

/** Group results by pickup location, preserving first-seen order. Mirrors the map's
 *  one-pin-per-location dedupe while keeping every co-located car for the popup. */
export function groupByLocation(items: SearchResultItem[]): LocationGroup[] {
  const order: string[] = []
  const byId = new Map<string, SearchResultItem[]>()
  for (const item of items) {
    const id = item.location.locationId
    const group = byId.get(id)
    if (group) {
      group.push(item)
    } else {
      byId.set(id, [item])
      order.push(id)
    }
  }
  return order.map((id) => ({ locationId: id, items: byId.get(id) ?? [] }))
}

/** Compact price for a map pin: the group's cheapest daily rate (else cheapest
 *  hourly, else price-on-request), prefixed "From" when the pin covers more than one
 *  car. Unit-less by design — a pin reads "¥8,000" while the popup carries the full
 *  "/ day". Daily wins over hourly so a mixed group reads consistently. */
export function pinPriceLabel(group: SearchResultItem[], t: Translate): string {
  const price = minRate(group, (i) => i.dailyRateJpy) ?? minRate(group, (i) => i.hourlyRateJpy)
  if (price == null) return t('noPrice')
  const formatted = price.toLocaleString('en-US')
  return group.length > 1
    ? t('map.pinPriceFrom', { price: formatted })
    : t('map.pinPrice', { price: formatted })
}

function minRate(
  group: SearchResultItem[],
  pick: (item: SearchResultItem) => number | null,
): number | null {
  const rates = group.map(pick).filter((rate): rate is number => rate != null)
  return rates.length === 0 ? null : Math.min(...rates)
}
