import type { StorefrontCardData } from '@/vite/storefronts/api'
import { rankStorefronts } from '@/vite/storefronts/rank'
import { type GeoPoint, haversineKm } from '@kuruma/shared/lib/region-distance'
import { describe, expect, it } from 'vitest'

// Minimal card fixture — only the fields ranking reads (coords + id) vary.
function card(
  locationId: string,
  latitude: number | null,
  longitude: number | null,
): StorefrontCardData {
  return {
    locationId,
    operatorId: 'op',
    operatorName: 'Op',
    name: locationId,
    address: 'addr',
    operatingHours: null,
    turnaroundMinutes: 0,
    classSummaries: [],
    fromDailyPriceJpy: null,
    fromHourlyPriceJpy: null,
    representativePhotos: [],
    latitude,
    longitude,
  }
}

const OSAKA: GeoPoint = { latitude: 34.69, longitude: 135.5 }

describe('rankStorefronts', () => {
  it('no anchor → preserves the API order untouched and tags every card distanceKm null', () => {
    const cards = [card('b', 34.8, 135.6), card('a', 34.69, 135.51)]
    const ranked = rankStorefronts(cards, null)
    expect(ranked.map((r) => r.locationId)).toEqual(['b', 'a'])
    expect(ranked.map((r) => r.distanceKm)).toEqual([null, null])
  })

  it('with an anchor → orders nearest-first and tags each card its great-circle distance', () => {
    const near = card('near', 34.69, 135.51)
    const mid = card('mid', 34.7, 135.55)
    const far = card('far', 34.8, 135.6)
    const ranked = rankStorefronts([far, mid, near], OSAKA)
    expect(ranked.map((r) => r.locationId)).toEqual(['near', 'mid', 'far'])
    expect(ranked[0]?.distanceKm).toBeCloseTo(
      haversineKm(OSAKA, { latitude: 34.69, longitude: 135.51 }),
      6,
    )
    expect(ranked[2]?.distanceKm).toBeCloseTo(
      haversineKm(OSAKA, { latitude: 34.8, longitude: 135.6 }),
      6,
    )
  })

  it('coord-less stores rank last (distanceKm null), keeping their original relative order', () => {
    const ranked = rankStorefronts(
      [
        card('noB', null, null),
        card('far', 34.8, 135.6),
        card('noA', null, null),
        card('near', 34.69, 135.51),
      ],
      OSAKA,
    )
    expect(ranked.map((r) => r.locationId)).toEqual(['near', 'far', 'noB', 'noA'])
    expect(ranked[2]?.distanceKm).toBeNull()
    expect(ranked[3]?.distanceKm).toBeNull()
  })

  it('equidistant stores break ties by original order (stable sort)', () => {
    // Two stores symmetric about the anchor are exactly equidistant.
    const east = card('east', 34.69, 135.51)
    const west = card('west', 34.69, 135.49)
    expect(rankStorefronts([west, east], OSAKA).map((r) => r.locationId)).toEqual(['west', 'east'])
    expect(rankStorefronts([east, west], OSAKA).map((r) => r.locationId)).toEqual(['east', 'west'])
  })

  it('does not mutate the input array', () => {
    const cards = [card('far', 34.8, 135.6), card('near', 34.69, 135.51)]
    rankStorefronts(cards, OSAKA)
    expect(cards.map((c) => c.locationId)).toEqual(['far', 'near'])
  })
})
