import { regionChain } from '@/vite/regions/region-lookup'
import {
  type GeoPoint,
  haversineKm,
  nearestAssignableRegion,
} from '@kuruma/shared/lib/region-distance'
import type { RegionNode } from '@kuruma/shared/types/region'
import type { ResultLocation, SearchResultItem } from '@kuruma/shared/types/search-result'

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

/** Derived "where in Japan" context for a result row, before localization. */
export interface GeoContext {
  /** Nearest AREA region to the pickup store (always present when non-null). */
  area: RegionNode
  /** The AREA's prefecture ancestor, or null when the chain is broken. */
  prefecture: RegionNode | null
  /** Anchor -> pickup distance in km, or null with no anchor / no store coords. */
  distanceKm: number | null
}

/**
 * Locate a pickup store in the region taxonomy (#885 slice 3a). Pure: finds the
 * nearest assignable AREA by coords, derives its prefecture by reusing the already
 * cycle-guarded `regionChain` (do NOT hand-roll a second parent walk — it runs on
 * the public region list and would freeze the tab on a malformed self-FK row), and
 * measures the searched anchor -> store distance. Returns null when the store has no
 * coordinates or sits beyond the area sanity radius (graceful degrade: no label).
 */
export function resolveGeoContext(
  location: ResultLocation,
  regions: readonly RegionNode[],
  anchor: GeoPoint | null,
): GeoContext | null {
  if (location.latitude === null || location.longitude === null) return null
  const point: GeoPoint = { latitude: location.latitude, longitude: location.longitude }
  const area = nearestAssignableRegion(regions, point)
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
  const hasDistance = ctx.distanceKm !== null && Number(ctx.distanceKm.toFixed(1)) !== 0
  const km = ctx.distanceKm !== null ? ctx.distanceKm.toFixed(1) : ''
  if (prefectureName === null || prefectureName === areaName) {
    return hasDistance
      ? t('map.geoContextAreaOnly', { area: areaName, km })
      : t('map.geoContextAreaOnlyNoDistance', { area: areaName })
  }
  return hasDistance
    ? t('map.geoContext', { area: areaName, prefecture: prefectureName, km })
    : t('map.geoContextNoDistance', { area: areaName, prefecture: prefectureName })
}
