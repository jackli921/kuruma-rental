import { ApiError, ParseError } from '@/lib/api-error'
import {
  LOCATIONS_QUERY_KEY,
  LocationArchiveBlockedError,
  archiveLocation,
  fetchOperatorLocations,
  operatorLocationsQueryOptions,
} from '@/vite/operator-locations/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function failResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const location = {
  id: 'loc_1',
  operatorId: 'op_1',
  name: 'Namba Hub',
  address: '1-1 Namba, Osaka',
  operatingHours: { openTime: '09:00', closeTime: '18:00' },
  timezone: 'Asia/Tokyo',
  defaultTurnaroundMinutes: 60,
  status: 'ACTIVE',
  coordinateSource: 'GEOCODED',
  regionId: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('fetchOperatorLocations', () => {
  afterEach(() => vi.restoreAllMocks())

  it('requests archived rows and opts bypass-scope callers into the cross-operator read', async () => {
    // #529 / #435: `_business` admits bypass roles (STAFF/ADMIN/PLATFORM_ADMIN);
    // GET /locations 400s for them unless includeAll=true is sent. Operator roles
    // auto-scope server-side and the API ignores the flag, so it's safe to always
    // send. Without it, every bypass user lands on the load-error state.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true, data: [] }))

    await fetchOperatorLocations()

    const url = String(fetchSpy.mock.calls[0]?.[0])
    expect(url).toContain('includeArchived=true')
    expect(url).toContain('includeAll=true')
    // Cookie carries the tenant — the client never names an operator.
    expect(url).not.toContain('operatorId')
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' })
  })

  it('scopes the read to operatorId (dropping includeAll) but keeps includeArchived when an admin picks a tenant', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true, data: [] }))

    await fetchOperatorLocations('op_9')

    const url = String(fetchSpy.mock.calls[0]?.[0])
    expect(url).toContain('operatorId=op_9')
    expect(url).not.toContain('includeAll')
    expect(url).toContain('includeArchived=true')
  })

  it('strips the wire latitude/longitude the projection deliberately omits (#711)', async () => {
    // The API row carries lat/lng (#531); the DTO omits them until a map view
    // needs them. The schema is non-strict, so those keys are dropped at the seam.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...location, latitude: 34.66, longitude: 135.5 }] }),
    )
    const result = await fetchOperatorLocations()
    expect(result).toEqual([location])
  })

  it('throws a ParseError when a row drifts from the schema (#711)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...location, defaultTurnaroundMinutes: 'oops' }] }),
    )
    await expect(fetchOperatorLocations()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('operatorLocationsQueryOptions', () => {
  it('exposes the stable LOCATIONS_QUERY_KEY prefix so writes can invalidate every scope', () => {
    // LOCATIONS_QUERY_KEY is the prefix; the per-scope key appends the picked
    // operator (or 'all') so switching context refetches without serving another
    // tenant's cached list. A prefix invalidate still clears all scopes.
    expect(LOCATIONS_QUERY_KEY).toEqual(['operator-locations'])
    expect(operatorLocationsQueryOptions().queryKey).toEqual(['operator-locations', 'all'])
    expect(operatorLocationsQueryOptions('op_9').queryKey).toEqual(['operator-locations', 'op_9'])
  })
})

describe('archiveLocation', () => {
  afterEach(() => vi.restoreAllMocks())

  it('routes the active-bookings 409 to a typed error carrying the count', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      failResponse(
        {
          success: false,
          error: 'has bookings',
          code: 'LOCATION_HAS_ACTIVE_BOOKINGS',
          activeBookingsCount: 3,
        },
        409,
      ),
    )
    const err = (await archiveLocation('loc_1').catch((e) => e)) as LocationArchiveBlockedError
    expect(err).toBeInstanceOf(LocationArchiveBlockedError)
    expect(err.activeBookingsCount).toBe(3)
  })

  it('preserves the failure body `code` on the generic ApiError fallthrough (#934)', async () => {
    // Mirrors `unwrap`: a non-active-bookings failure must keep its machine-readable
    // `code` so callers can discriminate same-status failures, not just read the message.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      failResponse(
        { success: false, error: 'Operator mismatch', code: 'OPERATOR_SCOPE_DENIED' },
        403,
      ),
    )
    const err = (await archiveLocation('loc_1').catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(403)
    expect(err.code).toBe('OPERATOR_SCOPE_DENIED')
  })
})
