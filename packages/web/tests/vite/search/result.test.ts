import {
  formatGeoContext,
  groupByLocation,
  pinPriceLabel,
  resolveGeoContext,
  resultPriceLabel,
  resultTitle,
} from '@/vite/search/result'
import { haversineKm } from '@kuruma/shared/lib/region-distance'
import type { RegionNode } from '@kuruma/shared/types/region'
import type {
  ClassComboSearchResult,
  SpecificSearchResult,
} from '@kuruma/shared/types/search-result'
import { describe, expect, it } from 'vitest'

const base: SpecificSearchResult = {
  kind: 'SPECIFIC',
  location: {
    locationId: 'l',
    operatorId: 'o',
    operatorName: 'Op',
    name: 'Namba',
    address: 'Osaka',
    latitude: 34.6,
    longitude: 135.5,
  },
  dailyRateJpy: 8000,
  hourlyRateJpy: null,
  classLabel: 'Compact',
  acrissCode: 'CCAR',
  seats: 5,
  photos: [],
  vehicleId: 'v1',
  name: 'Toyota Yaris',
  make: 'Toyota',
  model: 'Yaris',
  year: 2023,
  transmission: 'AUTO',
}
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${values.price}` : key

const combo: ClassComboSearchResult = {
  kind: 'CLASS_COMBO',
  location: base.location,
  dailyRateJpy: 8000,
  hourlyRateJpy: null,
  classLabel: 'SUV',
  acrissCode: 'IFAR',
  seats: 5,
  photos: [],
  classId: 'cls_suv',
  availableCount: 3,
}

describe('resultTitle', () => {
  it('uses the car name for a SPECIFIC result', () => {
    expect(resultTitle(base)).toBe('Toyota Yaris')
  })
  it('uses the class label for a CLASS_COMBO result', () => {
    expect(resultTitle(combo)).toBe('SUV')
  })
})

describe('resultPriceLabel', () => {
  it('formats a daily rate with thousands separators', () => {
    expect(resultPriceLabel(base, t)).toBe('fromDaily:8,000')
  })
  it('falls back to hourly, then to no-price', () => {
    expect(resultPriceLabel({ ...base, dailyRateJpy: null, hourlyRateJpy: 500 }, t)).toBe(
      'fromHourly:500',
    )
    expect(resultPriceLabel({ ...base, dailyRateJpy: null, hourlyRateJpy: null }, t)).toBe(
      'noPrice',
    )
  })
})

describe('groupByLocation', () => {
  it('groups results by pickup location, preserving first-seen order', () => {
    const a1 = { ...base, vehicleId: 'a1', location: { ...base.location, locationId: 'loc_a' } }
    const b1 = { ...base, vehicleId: 'b1', location: { ...base.location, locationId: 'loc_b' } }
    const a2 = { ...base, vehicleId: 'a2', location: { ...base.location, locationId: 'loc_a' } }

    const groups = groupByLocation([a1, b1, a2])

    expect(groups.map((g) => g.locationId)).toEqual(['loc_a', 'loc_b'])
    expect(groups[0]?.items.map((i) => (i.kind === 'SPECIFIC' ? i.vehicleId : ''))).toEqual([
      'a1',
      'a2',
    ])
    expect(groups[1]?.items).toHaveLength(1)
  })
})

describe('pinPriceLabel', () => {
  it('shows the bare price for a single-car pin', () => {
    expect(pinPriceLabel([base], t)).toBe('map.pinPrice:8,000')
  })

  it('shows the group minimum with a "From" prefix for a multi-car pin', () => {
    const cheap = { ...base, vehicleId: 'v2', dailyRateJpy: 6500 }
    const dear = { ...base, vehicleId: 'v3', dailyRateJpy: 12000 }
    expect(pinPriceLabel([dear, cheap], t)).toBe('map.pinPriceFrom:6,500')
  })

  it('prefers a daily rate over hourly even when an hourly car is cheaper', () => {
    const daily = { ...base, dailyRateJpy: 8000, hourlyRateJpy: null }
    const hourly = { ...base, vehicleId: 'v2', dailyRateJpy: null, hourlyRateJpy: 500 }
    expect(pinPriceLabel([daily, hourly], t)).toBe('map.pinPriceFrom:8,000')
  })

  it('falls back to the cheapest hourly rate when no car has a daily rate', () => {
    const h1 = { ...base, dailyRateJpy: null, hourlyRateJpy: 700 }
    const h2 = { ...base, vehicleId: 'v2', dailyRateJpy: null, hourlyRateJpy: 500 }
    expect(pinPriceLabel([h1, h2], t)).toBe('map.pinPriceFrom:500')
  })

  it('returns price-on-request when no car in the group is priced', () => {
    expect(pinPriceLabel([{ ...base, dailyRateJpy: null, hourlyRateJpy: null }], t)).toBe('noPrice')
  })
})

// --- geo-context (3a) ---------------------------------------------------------

function area(overrides: Partial<RegionNode> & Pick<RegionNode, 'id'>): RegionNode {
  return {
    latitude: null,
    longitude: null,
    assignable: false,
    status: 'ACTIVE',
    sortOrder: 0,
    parentId: null,
    nameEn: 'X',
    nameJa: 'X',
    nameZh: 'X',
    type: null,
    slug: null,
    ...overrides,
  }
}

// Osaka: Namba & Umeda areas under Osaka City under Osaka prefecture.
const osaka = area({
  id: 'reg_osaka',
  nameEn: 'Osaka',
  nameJa: '大阪府',
  nameZh: '大阪府',
  type: 'PREFECTURE',
  slug: 'osaka',
})
const osakaCity = area({
  id: 'reg_osaka_city',
  nameEn: 'Osaka City',
  type: 'CITY',
  parentId: 'reg_osaka',
})
const namba = area({
  id: 'reg_namba',
  nameEn: 'Namba',
  nameJa: '難波',
  nameZh: '难波',
  type: 'AREA',
  slug: 'namba',
  parentId: 'reg_osaka_city',
  assignable: true,
  latitude: 34.6627,
  longitude: 135.5023,
  sortOrder: 1,
})
const umeda = area({
  id: 'reg_umeda',
  nameEn: 'Umeda',
  nameJa: '梅田',
  nameZh: '梅田',
  type: 'AREA',
  slug: 'umeda',
  parentId: 'reg_osaka_city',
  assignable: true,
  latitude: 34.7025,
  longitude: 135.4959,
  sortOrder: 2,
})
const OSAKA_REGIONS: RegionNode[] = [osaka, osakaCity, namba, umeda]

const storeAt = (latitude: number | null, longitude: number | null) => ({
  ...base.location,
  latitude,
  longitude,
})

describe('resolveGeoContext', () => {
  it('picks the nearest AREA and walks up to its prefecture', () => {
    const ctx = resolveGeoContext(storeAt(34.66, 135.5), OSAKA_REGIONS, null)
    expect(ctx?.area.id).toBe('reg_namba')
    expect(ctx?.prefecture?.id).toBe('reg_osaka')
  })

  it('measures distance from the searched anchor to the pickup store', () => {
    const anchor = { latitude: 34.7025, longitude: 135.4959 } // Umeda centre
    const store = storeAt(34.66, 135.5)
    const ctx = resolveGeoContext(store, OSAKA_REGIONS, anchor)
    expect(ctx?.distanceKm).toBeCloseTo(
      haversineKm(anchor, { latitude: 34.66, longitude: 135.5 }),
      5,
    )
  })

  it('returns a null distance when no region was searched (no anchor)', () => {
    const ctx = resolveGeoContext(storeAt(34.66, 135.5), OSAKA_REGIONS, null)
    expect(ctx?.distanceKm).toBeNull()
  })

  it('returns null when the store has no coordinates', () => {
    expect(resolveGeoContext(storeAt(null, null), OSAKA_REGIONS, null)).toBeNull()
  })

  it('returns null when the nearest area is beyond the sanity radius', () => {
    // Tokyo (~400 km away) exceeds REGION_SANITY_RADIUS_KM (100 km).
    expect(resolveGeoContext(storeAt(35.68, 139.76), OSAKA_REGIONS, null)).toBeNull()
  })

  it('terminates on a cyclic parent chain (A -> B -> A) with a null prefecture', () => {
    const a = area({
      id: 'A',
      type: 'AREA',
      assignable: true,
      latitude: 34.66,
      longitude: 135.5,
      parentId: 'B',
    })
    const b = area({ id: 'B', type: 'CITY', parentId: 'A' })
    const ctx = resolveGeoContext(storeAt(34.66, 135.5), [a, b], null)
    expect(ctx?.area.id).toBe('A')
    expect(ctx?.prefecture).toBeNull()
  })
})

describe('formatGeoContext', () => {
  // Fake translator that renders the template key with its interpolated values so
  // we assert template selection + value wiring without depending on en.json here.
  const tt = (key: string, values?: Record<string, string | number>) =>
    `${key}(${Object.entries(values ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(',')})`

  it('returns null for a null context', () => {
    expect(formatGeoContext(null, 'en', tt)).toBeNull()
  })

  it('formats area + prefecture + distance', () => {
    const ctx = { area: namba, prefecture: osaka, distanceKm: 3.48 }
    expect(formatGeoContext(ctx, 'en', tt)).toBe(
      'map.geoContext(area=Namba,prefecture=Osaka,km=3.5)',
    )
  })

  it('drops the distance clause when there is no anchor (null distance)', () => {
    const ctx = { area: namba, prefecture: osaka, distanceKm: null }
    expect(formatGeoContext(ctx, 'en', tt)).toBe(
      'map.geoContextNoDistance(area=Namba,prefecture=Osaka)',
    )
  })

  it('drops the distance clause when distance rounds to 0.0 km', () => {
    const ctx = { area: namba, prefecture: osaka, distanceKm: 0.04 }
    expect(formatGeoContext(ctx, 'en', tt)).toBe(
      'map.geoContextNoDistance(area=Namba,prefecture=Osaka)',
    )
  })

  it('uses the area-only template when the prefecture is null', () => {
    const ctx = { area: namba, prefecture: null, distanceKm: 3.48 }
    expect(formatGeoContext(ctx, 'en', tt)).toBe('map.geoContextAreaOnly(area=Namba,km=3.5)')
  })

  it('uses the area-only template when area and prefecture share a name (Nara/Nara)', () => {
    const naraPref = area({ id: 'reg_nara_p', nameEn: 'Nara', type: 'PREFECTURE' })
    const naraArea = area({ id: 'reg_nara_a', nameEn: 'Nara', type: 'AREA' })
    const ctx = { area: naraArea, prefecture: naraPref, distanceKm: null }
    expect(formatGeoContext(ctx, 'en', tt)).toBe('map.geoContextAreaOnlyNoDistance(area=Nara)')
  })

  it('picks localized names by locale', () => {
    const ctx = { area: namba, prefecture: osaka, distanceKm: null }
    expect(formatGeoContext(ctx, 'ja', tt)).toBe(
      'map.geoContextNoDistance(area=難波,prefecture=大阪府)',
    )
    expect(formatGeoContext(ctx, 'zh', tt)).toBe(
      'map.geoContextNoDistance(area=难波,prefecture=大阪府)',
    )
  })
})
