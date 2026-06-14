import { ParseError } from '@/lib/api-error'
import { fetchSearchResults } from '@/vite/search/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// A complete SPECIFIC search row (#458) — the renter-safe per-car projection.
const specificItem = {
  kind: 'SPECIFIC',
  location: {
    locationId: 'loc1',
    operatorId: 'op1',
    operatorName: 'Osaka Cars',
    name: 'Namba Pickup',
    address: '1-1 Namba',
    latitude: 34.6,
    longitude: 135.5,
  },
  dailyRateJpy: 8000,
  hourlyRateJpy: null,
  classLabel: 'Compact',
  acrissCode: 'CDMR',
  seats: 5,
  photos: ['a.jpg'],
  vehicleId: 'v1',
  name: 'Toyota Aqua',
  make: 'Toyota',
  model: 'Aqua',
  year: 2022,
  transmission: 'AUTO',
}

const range = {
  from: new Date('2026-07-01T01:00:00.000Z'),
  to: new Date('2026-07-03T01:00:00.000Z'),
}

describe('fetchSearchResults', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('serializes the range + repeatable class filters and unwraps the flat list', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { items: [specificItem], nextCursor: 'cur-2' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchSearchResults({
      ...range,
      pickupLocationId: 'loc1',
      classes: ['CDMR', 'ICAR'],
      limit: 20,
    })

    expect(result).toEqual({ items: [specificItem], nextCursor: 'cur-2' })
    const url = new URL((fetchMock.mock.calls[0] as [string])[0], 'http://x')
    expect(url.pathname).toBe('/api/search/vehicles')
    expect(url.searchParams.get('from')).toBe('2026-07-01T01:00:00.000Z')
    expect(url.searchParams.get('to')).toBe('2026-07-03T01:00:00.000Z')
    expect(url.searchParams.get('pickupLocationId')).toBe('loc1')
    expect(url.searchParams.getAll('class')).toEqual(['CDMR', 'ICAR'])
    expect(url.searchParams.get('limit')).toBe('20')
  })

  it('parses a CLASS_COMBO row with null coordinates + rates (the schema laxness margin)', async () => {
    // Every `.nullable()`/CLASS_COMBO branch is a safety margin: the API legitimately
    // sends null coords (not-yet-geocoded), null rates, and CLASS_COMBO items. They
    // must parse, not throw — this guards against a later "tidy-up" tightening.
    const classCombo = {
      kind: 'CLASS_COMBO',
      location: {
        locationId: 'loc2',
        operatorId: 'op2',
        operatorName: 'Kyoto Cars',
        name: 'Kyoto Station',
        address: '2-2 Kyoto',
        latitude: null,
        longitude: null,
      },
      dailyRateJpy: null,
      hourlyRateJpy: 1200,
      classLabel: 'SUV',
      acrissCode: null,
      seats: 7,
      photos: [],
      classId: 'cls-1',
      availableCount: 3,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: { items: [classCombo], nextCursor: null } }),
      ),
    )
    await expect(fetchSearchResults(range)).resolves.toEqual({
      items: [classCombo],
      nextCursor: null,
    })
  })

  it('rejects with a ParseError when a result row drifts (missing seats/location)', async () => {
    // The API dropped renter-safe fields; the legacy cast surfaced them as
    // `undefined` deep in the map/list. With a schema the drift fails at the seam.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: {
            items: [{ kind: 'SPECIFIC', vehicleId: 'v1', name: 'Toyota Aqua' }],
            nextCursor: null,
          },
        }),
      ),
    )
    await expect(fetchSearchResults(range)).rejects.toBeInstanceOf(ParseError)
  })
})
