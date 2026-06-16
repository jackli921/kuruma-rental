import { resultPriceLabel, resultTitle } from '@/vite/search/result'
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
