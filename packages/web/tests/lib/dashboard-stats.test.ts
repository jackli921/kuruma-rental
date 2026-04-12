import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const API_BASE = 'http://localhost:8787'

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => {
    const { hc } = require('hono/client')
    return hc(API_BASE)
  },
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeAll(() => {
  process.env.STATS_API_KEY = 'test-key'
})

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  mockFetch.mockReset()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchDashboardStats', () => {
  test('sends X-API-Key header', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { totalBookings: 0, activeVehicles: 0, totalCustomers: 0, unreadMessages: 0 },
      }),
    )

    const { fetchDashboardStats } = await import('@/lib/dashboard-stats')
    await fetchDashboardStats()

    const calledUrl = mockFetch.mock.calls[0]?.[0]?.toString() ?? ''
    expect(calledUrl).toBe(`${API_BASE}/stats`)
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get('X-API-Key')).toBe('test-key')
  })

  test('returns parsed stats on success', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { totalBookings: 10, activeVehicles: 5, totalCustomers: 20, unreadMessages: 3 },
      }),
    )

    const { fetchDashboardStats } = await import('@/lib/dashboard-stats')
    const result = await fetchDashboardStats()

    expect(result).toEqual({
      totalBookings: 10,
      activeVehicles: 5,
      totalCustomers: 20,
      unreadMessages: 3,
    })
  })

  test('returns null when API returns non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))

    const { fetchDashboardStats } = await import('@/lib/dashboard-stats')
    const result = await fetchDashboardStats()
    expect(result).toBeNull()
  })

  test('returns null when fetch throws (API unreachable)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const { fetchDashboardStats } = await import('@/lib/dashboard-stats')
    const result = await fetchDashboardStats()
    expect(result).toBeNull()
  })

  test('returns null when response shape is unexpected', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ unexpected: true }))

    const { fetchDashboardStats } = await import('@/lib/dashboard-stats')
    const result = await fetchDashboardStats()
    expect(result).toBeNull()
  })
})
