import { ParseError } from '@/lib/api-error'
import {
  OPERATOR_OVERVIEW_QUERY_KEY,
  fetchOperatorOverview,
  operatorOverviewQueryOptions,
} from '@/vite/operator-dashboard/api'
import type { OperatorOverview } from '@kuruma/shared/types/overview'
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

const overview: OperatorOverview = {
  totalBookings: 12,
  activeVehicles: 5,
  upcomingBookings: 3,
}

describe('fetchOperatorOverview', () => {
  it('GETs /api/dashboard/overview with credentials and unwraps the validated overview', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: overview }))

    const result = await fetchOperatorOverview()

    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/overview', { credentials: 'include' })
    expect(result).toEqual(overview)
  })

  it('throws a ParseError when a headline count drifts to null (#711)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...overview, totalBookings: null } }),
    )
    await expect(fetchOperatorOverview()).rejects.toBeInstanceOf(ParseError)
  })

  it('appends ?operatorId only when an operator is picked (#407 bypass-admin narrowing)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: overview }))

    await fetchOperatorOverview('op_9')

    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/overview?operatorId=op_9', {
      credentials: 'include',
    })
  })

  it('url-encodes the picked operator id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: overview }))

    await fetchOperatorOverview('a b/c')

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('/api/dashboard/overview?operatorId=a%20b%2Fc')
  })
})

describe('operatorOverviewQueryOptions', () => {
  it('keys the cache by "all" when no operator is picked', () => {
    expect(OPERATOR_OVERVIEW_QUERY_KEY).toEqual(['operator-overview'])
    expect(operatorOverviewQueryOptions().queryKey).toEqual([...OPERATOR_OVERVIEW_QUERY_KEY, 'all'])
  })

  it('keys the cache by the picked operator so a context switch never serves another tenant', () => {
    expect(operatorOverviewQueryOptions('op_9').queryKey).toEqual([
      ...OPERATOR_OVERVIEW_QUERY_KEY,
      'op_9',
    ])
  })
})
