import { ParseError } from '@/lib/api-error'
import {
  ADDON_QUERY_KEY,
  addOnsQueryOptions,
  archiveAddOn,
  createAddOn,
  fetchAddOns,
  updateAddOn,
} from '@/vite/operator-add-ons/api'
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

const addOn = {
  id: 'addon_1',
  operatorId: 'op_1',
  templateId: 'tmpl_1',
  resolvedName: 'Child seat',
  resolvedDescription: null,
  descriptionOverride: null,
  nameI18n: null,
  priceJpy: 1500,
  status: 'ACTIVE' as const,
}

describe('fetchAddOns', () => {
  it('GETs /api/add-ons?includeArchived=true&includeAll=true with credentials and unwraps the array', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [addOn] }))

    const result = await fetchAddOns()

    expect(fetchMock).toHaveBeenCalledWith('/api/add-ons?includeArchived=true&includeAll=true', {
      credentials: 'include',
    })
    expect(result).toEqual([addOn])
  })

  it('sends NO operatorId — the cookie session scopes the read, includeAll only unblocks bypass roles (#529)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchAddOns()
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('operatorId')
  })

  it('scopes the read to operatorId (dropping includeAll) but keeps includeArchived when an admin picks a tenant', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchAddOns('op_9')
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('operatorId=op_9')
    expect(url).not.toContain('includeAll')
    expect(url).toContain('includeArchived=true')
  })

  it('appends the caller locale so the server resolves template names to it (#385)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchAddOns(undefined, 'ja')
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('locale=ja')
  })

  it('throws an ApiError carrying the status on a failure envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'Forbidden' }, 403))
    await expect(fetchAddOns()).rejects.toThrow('Forbidden')
  })

  it('throws a ParseError when a row drifts from the schema (#711)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...addOn, priceJpy: 'oops' }] }),
    )
    await expect(fetchAddOns()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('createAddOn', () => {
  it('POSTs the body to /api/add-ons with the CSRF + JSON headers and unwraps the row', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: addOn }, 201))

    const input = { templateId: 'tmpl_1', descriptionOverride: null, priceJpy: 1500 }
    const result = await createAddOn(input, 'csrf-7')

    expect(result).toEqual(addOn)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/add-ons')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-7' })
    expect(JSON.parse(init.body as string)).toEqual(input)
  })

  it('propagates a 409 duplicate-template failure as an ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: 'You already offer this add-on' }, 409),
    )
    await expect(
      createAddOn({ templateId: 'tmpl_1', descriptionOverride: null, priceJpy: 1 }, 'csrf'),
    ).rejects.toThrow('You already offer this add-on')
  })
})

describe('updateAddOn', () => {
  it('PATCHes /api/add-ons/:id with the CSRF header and the partial body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { ...addOn, priceJpy: 3000 } }))

    const result = await updateAddOn('addon_1', { priceJpy: 3000 }, 'csrf-8')

    expect(result.priceJpy).toBe(3000)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/add-ons/addon_1')
    expect(init.method).toBe('PATCH')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-8' })
    expect(JSON.parse(init.body as string)).toEqual({ priceJpy: 3000 })
  })

  it('encodes the id into the path', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: addOn }))
    await updateAddOn('a/b', { priceJpy: 1 }, 'csrf')
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/add-ons/a%2Fb')
  })
})

describe('archiveAddOn', () => {
  it('DELETEs /api/add-ons/:id with the CSRF header and no body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...addOn, status: 'ARCHIVED' } }),
    )

    const result = await archiveAddOn('addon_1', 'csrf-9')

    expect(result.status).toBe('ARCHIVED')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/add-ons/addon_1')
    expect(init.method).toBe('DELETE')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'X-CSRF-Token': 'csrf-9' })
    expect(init.body).toBeUndefined()
  })
})

describe('addOnsQueryOptions', () => {
  it('exposes the stable ADDON_QUERY_KEY prefix so writes can invalidate every scope', () => {
    // ADDON_QUERY_KEY is the prefix; the per-scope key appends the picked operator
    // (or 'all') so switching context refetches without serving another tenant's
    // cached list. A prefix invalidate (invalidateQueries({ queryKey: ADDON_QUERY_KEY }))
    // still clears all scopes.
    expect(ADDON_QUERY_KEY).toEqual(['operator-add-ons'])
    // The key trails with the locale (default 'en') so switching language refetches.
    expect(addOnsQueryOptions().queryKey).toEqual(['operator-add-ons', 'all', 'en'])
    expect(addOnsQueryOptions('op_9').queryKey).toEqual(['operator-add-ons', 'op_9', 'en'])
    expect(addOnsQueryOptions('op_9', 'ja').queryKey).toEqual(['operator-add-ons', 'op_9', 'ja'])
  })
})
