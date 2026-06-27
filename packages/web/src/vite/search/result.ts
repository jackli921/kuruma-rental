import { regionChain } from '@/vite/regions/region-lookup'
import {
  type GeoPoint,
  haversineKm,
  nearestAssignableRegion,
} from '@kuruma/shared/lib/region-distance'
import type { RegionNode } from '@kuruma/shared/types/region'
import type { ResultLocation, SearchResultItem } from '@kuruma/shared/types/search-result'

/** Stable list key — the renter-safe per-car id for SPECIFIC, a location-namespaced
 *  class id for a CLASS_COMBO row (#464) so the same class offered at two storefronts
 *  never collides into one React key. Mirrors the API cursor `itemKey` (`c:<loc>:<class>`),
 *  minus the kind prefix the list doesn't need. Shared by the flat list and map+list view.
 *  Switched (vs ternary) so a future `kind` is a tsc error here — the web ships
 *  independently of the API, so a stale bundle can't silently produce a collision-prone
 *  key for an unknown variant (matches #1094/#1096). */
export function searchResultKey(item: SearchResultItem): string {
  switch (item.kind) {
    case 'SPECIFIC':
      return item.vehicleId
    case 'CLASS_COMBO':
      return `${item.location.locationId}:${item.classId}`
    default:
      item satisfies never
      return ''
  }
}

type Translate = (key: string, values?: Record<string, string | number>) => string

/** Human title of a result row: the car name (SPECIFIC) or class label (CLASS_COMBO).
 *  Switched (vs ternary) so a future `kind` is a tsc error here — see searchResultKey. */
export function resultTitle(item: SearchResultItem): string {
  switch (item.kind) {
    case 'SPECIFIC':
      return item.name
    case 'CLASS_COMBO':
      return item.classLabel
    default:
      item satisfies never
      return ''
  }
}

/** The JPY figure an indicative-price note converts for a result row: the daily
 *  rate (preferred) else hourly, or null for price-on-request. Mirrors
 *  `resultPriceLabel`'s daily-over-hourly preference so the `≈` note matches the
 *  label it sits beneath. */
export function resultPriceJpy(item: SearchResultItem): number | null {
  return item.dailyRateJpy ?? item.hourlyRateJpy ?? null
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

/** Derived "where in Japan" context for a result row, before localization. */
export interface GeoContext {
  /** Nearest AREA region to the pickup store. Always coordinate-bearing (the
   *  producer only matches coord-carrying AREA nodes), so callers may read its
   *  lat/lng without a non-null assertion — banked for a future area-centre pin. */
  area: RegionNode & GeoPoint
  /** The AREA's prefecture ancestor, or null when the chain is broken. */
  prefecture: RegionNode | null
  /** Anchor -> pickup distance in km, or null with no anchor / no store coords. */
  distanceKm: number | null
}

/**
 * Locate a pickup store in the region taxonomy (#885 slice 3a). Pure: finds the
 * nearest assignable AREA by coords — restricted to `type === 'AREA'` so a future
 * assignable city/prefecture node can never be mislabelled as "the area" (the
 * "nearest assignable" set coincides with AREAs only by current seed convention, not
 * by type) — derives its prefecture by reusing the already cycle-guarded
 * `regionChain` (do NOT hand-roll a second parent walk — it runs on the public
 * region list and would freeze the tab on a malformed self-FK row), and measures the
 * searched anchor -> store distance. `location` is the PICKUP store; a one-way
 * dropoff label (#882) would be an additive second call, not a change here. Returns
 * null when the store has no coordinates or no AREA sits within the sanity radius
 * (graceful degrade: no label).
 */
export function resolveGeoContext(
  location: ResultLocation,
  regions: readonly RegionNode[],
  anchor: GeoPoint | null,
): GeoContext | null {
  if (location.latitude === null || location.longitude === null) return null
  const point: GeoPoint = { latitude: location.latitude, longitude: location.longitude }
  const area = nearestAssignableRegion(
    regions.filter((region) => region.type === 'AREA'),
    point,
  )
  if (area === null) return null
  return {
    area,
    prefecture: regionChain(regions, area.id).prefecture,
    distanceKm: anchor === null ? null : haversineKm(anchor, point),
  }
}

function localizedRegionName(region: RegionNode, locale: string): string {
  if (locale === 'ja') return region.nameJa
  if (locale === 'zh') return region.nameZh
  return region.nameEn
}

/**
 * Localize + format a `GeoContext` into the one-line label (#885 slice 3a). Pure
 * given `t`. Picks the area-only template when there is no prefecture or it equals
 * the area name (Nara/Nara), and drops the distance clause when there is no anchor
 * or the distance rounds to 0.0 km. `km` is `.toFixed(1)` (mirrors `StorefrontCard`).
 */
export function formatGeoContext(
  ctx: GeoContext | null,
  locale: string,
  t: Translate,
): string | null {
  if (ctx === null) return null
  const areaName = localizedRegionName(ctx.area, locale)
  const prefectureName = ctx.prefecture ? localizedRegionName(ctx.prefecture, locale) : null
  const km = ctx.distanceKm !== null ? ctx.distanceKm.toFixed(1) : ''
  const hasDistance = ctx.distanceKm !== null && Number(km) !== 0
  if (prefectureName === null || prefectureName === areaName) {
    return hasDistance
      ? t('map.geoContextAreaOnly', { area: areaName, km })
      : t('map.geoContextAreaOnlyNoDistance', { area: areaName })
  }
  return hasDistance
    ? t('map.geoContext', { area: areaName, prefecture: prefectureName, km })
    : t('map.geoContextNoDistance', { area: areaName, prefecture: prefectureName })
}
