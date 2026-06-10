import type {
  ClassComboSearchResult,
  ResultLocation,
  SearchResultItem,
  SpecificSearchResult,
} from '@kuruma/shared/types/search-result'
import { describe, expect, it } from 'vitest'

const location: ResultLocation = {
  locationId: 'loc_namba',
  operatorId: 'op_best',
  operatorName: 'Best Car Rental',
  name: 'Namba',
  address: '2-10-70 Nanba, Chuo-ku, Osaka',
  latitude: 34.6627,
  longitude: 135.5012,
}

describe('SearchResultItem discriminated union', () => {
  it('accepts a SPECIFIC result and narrows on kind', () => {
    const item: SearchResultItem = {
      kind: 'SPECIFIC',
      location,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
      classLabel: 'Compact',
      acrissCode: 'ECMR',
      seats: 5,
      photos: ['https://example.test/a.jpg'],
      vehicleId: 'veh_1',
      name: 'Toyota Alphard',
      make: 'Toyota',
      model: 'Alphard',
      year: 2023,
      transmission: 'AUTO',
    } satisfies SpecificSearchResult

    if (item.kind === 'SPECIFIC') {
      // Narrows to SpecificSearchResult — vehicleId is guaranteed present.
      expect(item.vehicleId).toBe('veh_1')
      expect(item.transmission).toBe('AUTO')
    }
  })

  it('admits a CLASS_COMBO member so the union is closed/extensible (#464)', () => {
    const combo: SearchResultItem = {
      kind: 'CLASS_COMBO',
      location,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
      classLabel: 'Compact',
      acrissCode: 'ECMR',
      seats: 5,
      photos: [],
      classId: 'cls_compact',
      availableCount: 3,
    } satisfies ClassComboSearchResult

    if (combo.kind === 'CLASS_COMBO') {
      expect(combo.availableCount).toBe(3)
    }
  })

  it('keeps the renter-safe projection — no licencePlate on any member', () => {
    const item: SearchResultItem = {
      kind: 'SPECIFIC',
      location,
      dailyRateJpy: null,
      hourlyRateJpy: 1200,
      classLabel: 'Kei',
      acrissCode: null,
      seats: 4,
      photos: [],
      vehicleId: 'veh_2',
      name: 'Honda N-Box',
      make: null,
      model: null,
      year: null,
      transmission: 'MANUAL',
    }
    expect('licensePlate' in item).toBe(false)
    expect('licencePlate' in item).toBe(false)
  })

  it('lets ResultLocation carry null coordinates (not-yet-geocoded degrades)', () => {
    const ungeocoded: ResultLocation = { ...location, latitude: null, longitude: null }
    expect(ungeocoded.latitude).toBeNull()
    expect(ungeocoded.longitude).toBeNull()
  })
})
