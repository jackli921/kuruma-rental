import { ApiError, ParseError } from '@/lib/api-error'
import type { FxRates } from '@kuruma/shared/types/fx'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FX_RATES_QUERY_KEY, fetchFxRates, fxRatesQueryOptions } from './currency-api'

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

const rates: FxRates = {
  base: 'JPY',
  asOf: '2026-06-01',
  rates: { USD: 0.0067, CNY: 0.048 },
}

describe('fetchFxRates', () => {
  it('GETs /api/fx/rates with credentials and unwraps the validated snapshot', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: rates }))

    const result = await fetchFxRates()

    expect(fetchMock).toHaveBeenCalledWith('/api/fx/rates', { credentials: 'include' })
    expect(result).toEqual(rates)
  })

  it('throws a ParseError when the base is not JPY — the contract pins JPY base', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ...rates, base: 'USD' } }))
    await expect(fetchFxRates()).rejects.toBeInstanceOf(ParseError)
  })

  it('throws ApiError when the provider is unavailable (503) so the web falls back to JPY', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: 'FX_RATES_UNAVAILABLE' }, 503),
    )
    await expect(fetchFxRates()).rejects.toBeInstanceOf(ApiError)
  })
})

describe('fxRatesQueryOptions', () => {
  it('exposes the stable FX_RATES_QUERY_KEY for cache reuse', () => {
    expect(FX_RATES_QUERY_KEY).toEqual(['fx', 'rates'])
    expect(fxRatesQueryOptions().queryKey).toEqual(['fx', 'rates'])
  })
})
