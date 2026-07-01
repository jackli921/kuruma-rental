import { ParseError } from '@/lib/api-error'
import { fetchStorefrontDetail, fetchStorefronts } from '@/vite/storefronts/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Wire-shaped fixtures (typed loosely so drift/laxness overrides below can drop a
// key or send an out-of-domain value without fighting the inferred DTO types).
const fullClassSummary: Record<string, unknown> = {
  acrissCode: 'CCAR',
  label: 'Compact',
  luggageCapacity: 2,
  luggageSize: 'SMALL',
  availableCount: 4,
}

const fullCard: Record<string, unknown> = {
  locationId: 'loc1',
  operatorId: 'op1',
  operatorName: 'Osaka Cars',
  name: 'Namba Pickup',
  address: '1-1 Namba',
  operatingHours: { openTime: '09:00', closeTime: '20:00' },
  turnaroundMinutes: 180,
  classSummaries: [fullClassSummary],
  fromDailyPriceJpy: 8000,
  fromHourlyPriceJpy: null,
  representativePhotos: ['a.jpg'],
  latitude: 34.6,
  longitude: 135.5,
}

const fullVehicle: Record<string, unknown> = {
  id: 'v1',
  classId: 'cls1',
  name: 'Toyota Aqua',
  make: 'Toyota',
  model: 'Aqua',
  year: 2022,
  seats: 5,
  luggageCapacity: 2,
  luggageSize: 'SMALL',
  transmission: 'AUTO',
  acrissCode: 'CDMR',
  classLabel: 'Compact',
  dailyRateJpy: 8000,
  hourlyRateJpy: null,
  photos: ['a.jpg'],
}

const fullDetail: Record<string, unknown> = {
  storefront: {
    locationId: 'loc1',
    operatorId: 'op1',
    name: 'Namba Pickup',
    address: '1-1 Namba',
    operatorName: 'Osaka Cars',
    operatingHours: { openTime: '09:00', closeTime: '20:00' },
    turnaroundMinutes: 180,
  },
  vehicles: [fullVehicle],
  nextCursor: null,
}

const range = {
  from: new Date('2026-07-01T01:00:00.000Z'),
  to: new Date('2026-07-03T01:00:00.000Z'),
}

describe('fetchStorefronts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('serializes range + filters and unwraps the grouped storefront list', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { storefronts: [fullCard], nextCursor: 'cur-2' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchStorefronts({
      ...range,
      pickupLocationId: 'loc1',
      regionId: 'reg-9',
      classes: ['CCAR', 'MVAR'],
      limit: 20,
      cursor: 'cur-1',
    })

    expect(result).toEqual({ storefronts: [fullCard], nextCursor: 'cur-2' })
    const url = new URL((fetchMock.mock.calls[0] as [string])[0], 'http://x')
    expect(url.pathname).toBe('/api/storefronts/search')
    expect(url.searchParams.get('from')).toBe('2026-07-01T01:00:00.000Z')
    expect(url.searchParams.get('to')).toBe('2026-07-03T01:00:00.000Z')
    expect(url.searchParams.get('pickupLocationId')).toBe('loc1')
    expect(url.searchParams.get('regionId')).toBe('reg-9')
    expect(url.searchParams.getAll('class')).toEqual(['CCAR', 'MVAR'])
    expect(url.searchParams.get('limit')).toBe('20')
    expect(url.searchParams.get('cursor')).toBe('cur-1')
  })

  it('parses null operatingHours / prices / coords / class fields (the schema laxness margin)', async () => {
    // The API legitimately sends null hours, null rates, ungeocoded null coords, and
    // a class with no ACRISS/luggage. These must parse, not throw — guarding against
    // a later "tidy-up" that wrongly tightens a `.nullable()` to required.
    const sparseCard = {
      ...fullCard,
      operatingHours: null,
      fromDailyPriceJpy: null,
      fromHourlyPriceJpy: null,
      latitude: null,
      longitude: null,
      classSummaries: [
        {
          acrissCode: null,
          label: 'Misc',
          luggageCapacity: null,
          luggageSize: null,
          availableCount: 1,
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: { storefronts: [sparseCard], nextCursor: null } }),
      ),
    )
    await expect(fetchStorefronts(range)).resolves.toEqual({
      storefronts: [sparseCard],
      nextCursor: null,
    })
  })

  it('rejects with a ParseError when a card drifts (missing turnaroundMinutes)', async () => {
    const brokenCard = { ...fullCard, turnaroundMinutes: undefined }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: { storefronts: [brokenCard], nextCursor: null } }),
      ),
    )
    await expect(fetchStorefronts(range)).rejects.toBeInstanceOf(ParseError)
  })

  it('rejects with a ParseError when a class summary has an unknown luggageSize', async () => {
    const badCard = {
      ...fullCard,
      classSummaries: [{ ...fullClassSummary, luggageSize: 'GIGANTIC' }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: true, data: { storefronts: [badCard], nextCursor: null } }),
      ),
    )
    await expect(fetchStorefronts(range)).rejects.toBeInstanceOf(ParseError)
  })
})

describe('fetchStorefrontDetail', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('unwraps the storefront summary + available vehicles', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: fullDetail }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchStorefrontDetail('loc1', {
      ...range,
      classes: ['CCAR'],
      limit: 10,
      cursor: 'c1',
    })

    expect(result).toEqual(fullDetail)
    const url = new URL((fetchMock.mock.calls[0] as [string])[0], 'http://x')
    expect(url.pathname).toBe('/api/storefronts/loc1/vehicles')
    expect(url.searchParams.getAll('class')).toEqual(['CCAR'])
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('cursor')).toBe('c1')
  })

  it('returns null on 404 (unknown/archived store) without parsing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: { code: 'NOT_FOUND' } }, 404)),
    )
    await expect(fetchStorefrontDetail('ghost', range)).resolves.toBeNull()
  })

  it('rejects with a ParseError when a vehicle has an invalid transmission', async () => {
    const badDetail = { ...fullDetail, vehicles: [{ ...fullVehicle, transmission: 'CVT' }] }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: badDetail })),
    )
    await expect(fetchStorefrontDetail('loc1', range)).rejects.toBeInstanceOf(ParseError)
  })

  it('rejects with a ParseError when a vehicle drifts (missing luggageSize key)', async () => {
    const badDetail = { ...fullDetail, vehicles: [{ ...fullVehicle, luggageSize: undefined }] }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: badDetail })),
    )
    await expect(fetchStorefrontDetail('loc1', range)).rejects.toBeInstanceOf(ParseError)
  })
})
