import { afterEach, describe, expect, test, vi } from 'vitest'
import { fetchDashboardStats } from '@/lib/dashboard-stats'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

afterEach(() => {
  mockFetch.mockReset()
})

describe('fetchDashboardStats', () => {
  test('returns parsed stats on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            totalBookings: 10,
            activeVehicles: 5,
            totalCustomers: 20,
            unreadMessages: 3,
          },
        }),
    })

    const result = await fetchDashboardStats()

    expect(result).toEqual({
      totalBookings: 10,
      activeVehicles: 5,
      totalCustomers: 20,
      unreadMessages: 3,
    })
  })

  test('returns null when API returns non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    const result = await fetchDashboardStats()
    expect(result).toBeNull()
  })

  test('returns null when fetch throws (API unreachable)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await fetchDashboardStats()
    expect(result).toBeNull()
  })

  test('returns null when response shape is unexpected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ unexpected: true }),
    })

    const result = await fetchDashboardStats()
    expect(result).toBeNull()
  })
})
