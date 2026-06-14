import { ParseError } from '@/lib/api-error'
import {
  REGIONS_QUERY_KEY,
  fetchRegions,
  regionsQueryOptions,
} from '@/vite/operator-locations/regions-api'
import type { RegionNode } from '@kuruma/shared/types/region'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => fetchMock.mockReset())

const region: RegionNode = {
  id: 'osaka',
  parentId: null,
  nameEn: 'Osaka',
  nameJa: '大阪府',
  nameZh: '大阪府',
  sortOrder: 0,
  type: 'PREFECTURE',
  latitude: 34.69,
  longitude: 135.5,
  assignable: false,
  status: 'ACTIVE',
  slug: 'osaka',
}

describe('fetchRegions', () => {
  it('GETs /api/regions with credentials and unwraps the validated tree', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [region] }))

    const result = await fetchRegions()

    expect(fetchMock).toHaveBeenCalledWith('/api/regions', { credentials: 'include' })
    expect(result).toEqual([region])
  })

  it('accepts the INACTIVE status — regions use ACTIVE|INACTIVE, not ARCHIVED (#711)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...region, status: 'INACTIVE' }] }),
    )
    const result = await fetchRegions()
    expect(result[0]?.status).toBe('INACTIVE')
  })

  it('throws a ParseError when a node carries an out-of-domain status (#711)', async () => {
    // ARCHIVED is a location/fee status, never a region one — must reject at the seam.
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...region, status: 'ARCHIVED' }] }),
    )
    await expect(fetchRegions()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('regionsQueryOptions', () => {
  it('exposes the stable REGIONS_QUERY_KEY for cache reuse', () => {
    expect(REGIONS_QUERY_KEY).toEqual(['regions'])
    expect(regionsQueryOptions().queryKey).toEqual(['regions'])
  })
})
