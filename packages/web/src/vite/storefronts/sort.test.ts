import { describe, expect, it } from 'vitest'
import type { StorefrontCardData } from './api'
import { DEFAULT_SORT, parsePriceMax, parseSort, sortStorefronts } from './sort'

function card(over: Partial<StorefrontCardData> & { locationId: string }): StorefrontCardData {
  return {
    operatorId: 'op_1',
    operatorName: 'Op',
    name: over.locationId,
    address: 'somewhere',
    operatingHours: null,
    turnaroundMinutes: 0,
    classSummaries: [],
    fromDailyPriceJpy: null,
    fromHourlyPriceJpy: null,
    representativePhotos: [],
    latitude: null,
    longitude: null,
    ...over,
  }
}

const cards: StorefrontCardData[] = [
  card({ locationId: 'a', fromDailyPriceJpy: 8000 }),
  card({ locationId: 'b', fromDailyPriceJpy: 3000 }),
  card({ locationId: 'c', fromDailyPriceJpy: 12000 }),
  card({ locationId: 'd', fromDailyPriceJpy: null }),
]

const ids = (result: { locationId: string }[]) => result.map((r) => r.locationId)

describe('parseSort', () => {
  it('accepts the supported sorts', () => {
    expect(parseSort('priceAsc')).toBe('priceAsc')
    expect(parseSort('nearest')).toBe('nearest')
  })
  it('rejects unknown or non-string values', () => {
    expect(parseSort('cheapest')).toBeUndefined()
    expect(parseSort(3)).toBeUndefined()
    expect(parseSort(undefined)).toBeUndefined()
  })
})

describe('parsePriceMax', () => {
  it('accepts a positive number or numeric string', () => {
    expect(parsePriceMax('5000')).toBe(5000)
    expect(parsePriceMax(5000)).toBe(5000)
  })
  it('rejects zero, negatives, and non-numeric input', () => {
    expect(parsePriceMax('0')).toBeUndefined()
    expect(parsePriceMax('-1')).toBeUndefined()
    expect(parsePriceMax('abc')).toBeUndefined()
    expect(parsePriceMax(undefined)).toBeUndefined()
  })
})

describe('sortStorefronts', () => {
  it('orders cheapest-first on priceAsc, priceless stores last', () => {
    const result = sortStorefronts(cards, { anchor: null, sort: 'priceAsc' })
    expect(ids(result)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('orders most-expensive-first on priceDesc, priceless stores still last', () => {
    const result = sortStorefronts(cards, { anchor: null, sort: 'priceDesc' })
    expect(ids(result)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('applies a daily price cap and drops priceless stores when a cap is set', () => {
    const result = sortStorefronts(cards, { anchor: null, sort: 'priceAsc', priceMax: 8000 })
    expect(ids(result)).toEqual(['b', 'a'])
  })

  it('preserves the incoming order for nearest with no anchor (the default)', () => {
    const result = sortStorefronts(cards, { anchor: null, sort: DEFAULT_SORT })
    expect(ids(result)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('tags a distance and orders nearest-first when an anchor is given', () => {
    const geo = [
      card({ locationId: 'far', latitude: 35.68, longitude: 139.76, fromDailyPriceJpy: 1000 }),
      card({ locationId: 'near', latitude: 34.7, longitude: 135.5, fromDailyPriceJpy: 9000 }),
    ]
    const result = sortStorefronts(geo, {
      anchor: { latitude: 34.7, longitude: 135.5 },
      sort: 'nearest',
    })
    expect(ids(result)).toEqual(['near', 'far'])
    expect(result[0]?.distanceKm).toBe(0)
  })
})
