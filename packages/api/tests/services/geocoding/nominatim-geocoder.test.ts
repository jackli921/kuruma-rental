import { describe, expect, it, vi } from 'vitest'
import { NominatimGeocoder } from '../../../src/services/geocoding/nominatim-geocoder'

const UA = 'kuruma-rental/1.0 (ops@bestcarrental.jp)'
const BASE = 'https://nominatim.example.org'

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

// Nominatim jsonv2 returns an array; lat/lon are strings.
const osakaHit = [{ lat: '34.6937', lon: '135.5023', display_name: 'Osaka' }]

describe('NominatimGeocoder', () => {
  it('GETs /search (jsonv2, limit 1) with the address q-encoded, a User-Agent, and an AbortSignal', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(osakaHit))
    await new NominatimGeocoder(BASE, UA, fetchFn).geocode('1-1 Osaka, Japan')

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]!
    const parsed = new URL(url as string)
    expect(parsed.origin + parsed.pathname).toBe(`${BASE}/search`)
    expect(parsed.searchParams.get('format')).toBe('jsonv2')
    expect(parsed.searchParams.get('limit')).toBe('1')
    expect(parsed.searchParams.get('q')).toBe('1-1 Osaka, Japan')
    const headers = init?.headers as Record<string, string>
    expect(headers['User-Agent']).toBe(UA)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps the first result lat/lon (strings) to an ok outcome with numeric {lat,lng}', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(osakaHit))
    const result = await new NominatimGeocoder(BASE, UA, fetchFn).geocode('Osaka')
    expect(result).toEqual({ status: 'ok', lat: 34.6937, lng: 135.5023 })
  })

  it('returns notFound on an empty result array (address not found)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse([]))
    expect(await new NominatimGeocoder(BASE, UA, fetchFn).geocode('nowhere')).toEqual({
      status: 'notFound',
    })
  })

  it('returns notFound on a non-OK response (does not throw)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'oops' }, { status: 500 }))
    expect(await new NominatimGeocoder(BASE, UA, fetchFn).geocode('Osaka')).toEqual({
      status: 'notFound',
    })
  })

  it('returns notFound when lat/lon are not finite numbers (parse failure)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse([{ lat: 'NaN', lon: '135' }]))
    expect(await new NominatimGeocoder(BASE, UA, fetchFn).geocode('Osaka')).toEqual({
      status: 'notFound',
    })
  })

  it('returns notFound on a network error instead of throwing', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await new NominatimGeocoder(BASE, UA, fetchFn).geocode('Osaka')).toEqual({
      status: 'notFound',
    })
  })

  it('returns notFound on a timeout (AbortSignal.timeout fires) instead of throwing', async () => {
    const fetchFn = vi.fn(async () => {
      throw new DOMException('The operation timed out', 'TimeoutError')
    })
    expect(await new NominatimGeocoder(BASE, UA, fetchFn).geocode('Osaka')).toEqual({
      status: 'notFound',
    })
  })

  it('makes a single request — no retries, no autocomplete bursts (OSMF policy)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse([]))
    await new NominatimGeocoder(BASE, UA, fetchFn).geocode('Osaka')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('appends ?key= when an API key is set, making LocationIQ a drop-in (#574)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(osakaHit))
    await new NominatimGeocoder(BASE, UA, fetchFn, 'pk.test-token').geocode('Osaka')
    const parsed = new URL(fetchFn.mock.calls[0]![0] as string)
    expect(parsed.searchParams.get('key')).toBe('pk.test-token')
  })

  it('omits the key param entirely when no API key is set (public OSM)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(osakaHit))
    await new NominatimGeocoder(BASE, UA, fetchFn).geocode('Osaka')
    const parsed = new URL(fetchFn.mock.calls[0]![0] as string)
    expect(parsed.searchParams.has('key')).toBe(false)
  })
})
