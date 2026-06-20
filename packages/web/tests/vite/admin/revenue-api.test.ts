import { ParseError } from '@/lib/api-error'
import { adminRevenueQueryOptions, fetchAdminRevenue } from '@/vite/admin/revenue/api'
import type { AdminRevenueResponse } from '@kuruma/shared/types/admin-revenue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const EMPTY: AdminRevenueResponse = {
  partners: [],
  totals: { grossJpy: 0, platformFeeJpy: 0, netToPartnerJpy: 0, paymentCount: 0 },
  availableMonths: [],
  selectedMonth: null,
}

const POPULATED: AdminRevenueResponse = {
  partners: [
    {
      operatorId: 'op_1',
      operatorName: 'Best Car Rental',
      operatorSlug: 'best-car-rental',
      grossJpy: 120_000,
      platformFeeJpy: 4_800,
      netToPartnerJpy: 115_200,
      paymentCount: 3,
      months: [
        {
          month: '2026-04',
          grossJpy: 120_000,
          platformFeeJpy: 4_800,
          netToPartnerJpy: 115_200,
          paymentCount: 3,
        },
      ],
    },
  ],
  totals: { grossJpy: 120_000, platformFeeJpy: 4_800, netToPartnerJpy: 115_200, paymentCount: 3 },
  availableMonths: ['2026-04'],
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

  it('validates and returns a populated report (nested partners/months) (#711)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: POPULATED }))
    vi.stubGlobal('fetch', fetchMock)

    const report = await fetchAdminRevenue()

    expect(report.partners[0]?.months[0]?.grossJpy).toBe(120_000)
    expect(report.totals.netToPartnerJpy).toBe(115_200)
  })

  it('throws a ParseError when a revenue figure drifts to a non-number (#711)', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: { ...EMPTY, totals: { ...EMPTY.totals, grossJpy: '0' } },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchAdminRevenue()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('adminRevenueQueryOptions', () => {
  it('keys all-months and a specific month distinctly so they cache apart', () => {
    expect(adminRevenueQueryOptions().queryKey).toEqual(['admin-revenue', null])
    expect(adminRevenueQueryOptions('2026-04').queryKey).toEqual(['admin-revenue', '2026-04'])
  })
})
