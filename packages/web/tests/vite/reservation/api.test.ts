import { fetchAddOns, fetchInsuranceOptions } from '@/vite/reservation/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchAddOns', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('unwraps the ok() envelope into the renter-safe add-on list', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: [
          { id: 'a1', name: 'Baby seat', description: 'Rear-facing', priceJpy: 2000 },
          { id: 'a2', name: 'ETC card', description: null, priceJpy: 500 },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchAddOns('loc-1')).resolves.toEqual([
      { id: 'a1', name: 'Baby seat', description: 'Rear-facing', priceJpy: 2000 },
      { id: 'a2', name: 'ETC card', description: null, priceJpy: 500 },
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/storefronts/loc-1/add-ons', {
      credentials: 'include',
    })
  })

  it('throws on a 404 (unknown/archived storefront)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Storefront not found' }, 404)),
    )
    await expect(fetchAddOns('gone')).rejects.toThrow('Storefront not found')
  })
})

describe('fetchInsuranceOptions', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('unwraps the ok() envelope into the renter-safe insurance list', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: [
          {
            id: 'i1',
            name: 'Full coverage',
            description: 'No deductible',
            dailyPriceJpy: 1500,
            deductibleJpy: 0,
          },
          {
            id: 'i2',
            name: 'Basic',
            description: null,
            dailyPriceJpy: 800,
            deductibleJpy: 50000,
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchInsuranceOptions('loc-1')).resolves.toEqual([
      {
        id: 'i1',
        name: 'Full coverage',
        description: 'No deductible',
        dailyPriceJpy: 1500,
        deductibleJpy: 0,
      },
      { id: 'i2', name: 'Basic', description: null, dailyPriceJpy: 800, deductibleJpy: 50000 },
    ])
    expect(fetchMock).toHaveBeenCalledWith('/api/storefronts/loc-1/insurance-options', {
      credentials: 'include',
    })
  })
})
