import { ParseError } from '@/lib/api-error'
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

  // Catalog i18n slice 2 (#1315): the storefront add-ons endpoint resolves the
  // picked template name/description to `?locale=`, so the renter wizard threads
  // its route locale. (Absent locale ⇒ server default EN, asserted by the exact
  // URL in the first case above.)
  it('appends the caller locale so the server resolves add-on names to it', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchAddOns('loc-1', 'ja')

    expect(fetchMock).toHaveBeenCalledWith('/api/storefronts/loc-1/add-ons?locale=ja', {
      credentials: 'include',
    })
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

// #711: validate the response body at the network seam. A renamed/dropped field
// must fail here as a ParseError, not surface as `undefined` deep in the wizard.
describe('reservation response validation (#711)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects with a ParseError when an add-on row drifts (priceJpy renamed)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [{ id: 'a1', name: 'Baby seat', description: null, priceAmount: 2000 }],
        }),
      ),
    )
    await expect(fetchAddOns('loc-1')).rejects.toBeInstanceOf(ParseError)
  })

  it('rejects with a ParseError when an insurance row omits dailyPriceJpy (drift)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [{ id: 'i1', name: 'Basic', description: null, deductibleJpy: 50000 }],
        }),
      ),
    )
    await expect(fetchInsuranceOptions('loc-1')).rejects.toBeInstanceOf(ParseError)
  })
})
