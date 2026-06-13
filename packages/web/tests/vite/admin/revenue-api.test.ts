import { adminRevenueQueryOptions, fetchAdminRevenue } from '@/vite/admin/revenue/api'
import type { AdminRevenueResponse } from '@kuruma/shared/types/admin-revenue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const EMPTY: AdminRevenueResponse = {
  partners: [],
  totals: { grossJpy: 0, platformFeeJpy: 0, netToPartnerJpy: 0, paymentCount: 0 },
  availableMonths: [],
  selectedMonth: null,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchAdminRevenue (#628 month filter)', () => {
  it('omits the month param entirely when none is given (full matrix)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: EMPTY }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchAdminRevenue()

    const url = new URL(fetchMock.mock.calls[0]![0] as string, 'http://x')
    expect(url.pathname).toBe('/api/admin/revenue')
    expect(url.searchParams.has('month')).toBe(false)
    expect((fetchMock.mock.calls[0]![1] as RequestInit).credentials).toBe('include')
  })

  it('sends ?month=YYYY-MM (encoded) when a month is given', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { ...EMPTY, selectedMonth: '2026-04' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const report = await fetchAdminRevenue('2026-04')

    const url = new URL(fetchMock.mock.calls[0]![0] as string, 'http://x')
    expect(url.searchParams.get('month')).toBe('2026-04')
    expect(report.selectedMonth).toBe('2026-04')
  })
})

describe('adminRevenueQueryOptions', () => {
  it('keys all-months and a specific month distinctly so they cache apart', () => {
    expect(adminRevenueQueryOptions().queryKey).toEqual(['admin-revenue', null])
    expect(adminRevenueQueryOptions('2026-04').queryKey).toEqual(['admin-revenue', '2026-04'])
  })
})
