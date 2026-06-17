import { groupByLocation, pinPriceLabel, resultPriceLabel, resultTitle } from '@/vite/search/result'
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
