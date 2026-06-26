import { ParseError } from '@/lib/api-error'
import type { AdminOverview } from '@kuruma/shared/types/admin-overview'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_OVERVIEW_QUERY_KEY, adminOverviewQueryOptions, fetchAdminOverview } from './api'

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

const OVERVIEW: AdminOverview = {
  bookings: 128,
  gmvJpy: 4_560_000,
  fleet: 42,
  operators: 7,
  unresolvedAnomalies: 2,
  pendingDocs: 5,
}

describe('adminOverviewQueryOptions', () => {
  it('exposes the stable admin-overview key for cache invalidation', () => {
    expect(ADMIN_OVERVIEW_QUERY_KEY).toEqual(['admin-overview'])
    expect(adminOverviewQueryOptions().queryKey).toEqual(['admin-overview'])
  })
})

describe('fetchAdminOverview', () => {
  it('GETs /api/admin/overview with credentials and unwraps the validated aggregate', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: OVERVIEW }))

    const result = await fetchAdminOverview()

    expect(fetchMock).toHaveBeenCalledWith('/api/admin/overview', { credentials: 'include' })
    expect(result).toEqual(OVERVIEW)
  })

  it('rejects with a ParseError when a KPI arrives as a string (contract drift)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...OVERVIEW, gmvJpy: '4560000' } }),
    )
    await expect(fetchAdminOverview()).rejects.toBeInstanceOf(ParseError)
  })

  it('rejects with a ParseError when a KPI is missing entirely', async () => {
    const { pendingDocs, ...partial } = OVERVIEW
    void pendingDocs
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: partial }))
    await expect(fetchAdminOverview()).rejects.toBeInstanceOf(ParseError)
  })
})
