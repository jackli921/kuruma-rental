import { ParseError } from '@/lib/api-error'
import {
  INSURANCE_QUERY_KEY,
  archiveInsuranceOption,
  createInsuranceOption,
  fetchInsuranceOptions,
  insuranceOptionsQueryOptions,
  updateInsuranceOption,
} from '@/vite/operator-insurance/api'
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

const option = {
  id: 'ins_1',
  operatorId: 'op_1',
  // #1437 slice 3b: the read carries the resolved label (`resolvedName`) plus the
  // raw self-authored bundle (`nameI18n`). A faithful row so the schema's
  // localizedTextSchema actually parses (an omitted bundle would 500 the read as a
  // ParseError).
  resolvedName: 'Full cover',
  nameI18n: { en: 'Full cover' },
  description: null,
  dailyPriceJpy: 2000,
  deductibleJpy: null,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('fetchInsuranceOptions', () => {
  it('GETs /api/insurance-options?includeArchived=true&includeAll=true with credentials and unwraps the array', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [option] }))

    const result = await fetchInsuranceOptions()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/insurance-options?includeArchived=true&includeAll=true',
      { credentials: 'include' },
    )
    expect(result).toEqual([option])
  })

  it('sends NO operatorId — the cookie session scopes the read, includeAll only unblocks bypass roles (#529)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchInsuranceOptions()
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('operatorId')
  })

  it('scopes the read to operatorId (dropping includeAll) but keeps includeArchived when an admin picks a tenant', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchInsuranceOptions('op_9')
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('operatorId=op_9')
    expect(url).not.toContain('includeAll')
    expect(url).toContain('includeArchived=true')
  })

  it('threads ?locale= so the server resolves resolvedName to the caller language (#1437)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }))
    await fetchInsuranceOptions('op_9', 'ja')
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('locale=ja')
  })

  it('throws an ApiError carrying the status on a failure envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'Forbidden' }, 403))
    await expect(fetchInsuranceOptions()).rejects.toThrow('Forbidden')
  })

  it('throws a ParseError when a row drifts from the schema (#711)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [{ ...option, dailyPriceJpy: 'oops' }] }),
    )
    await expect(fetchInsuranceOptions()).rejects.toBeInstanceOf(ParseError)
  })
})

describe('createInsuranceOption', () => {
  it('POSTs the body to /api/insurance-options with the CSRF + JSON headers and unwraps the row', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: option }, 201))

    const input = {
      nameI18n: { en: 'Full cover' },
      description: null,
      dailyPriceJpy: 2000,
      deductibleJpy: null,
    }
    const result = await createInsuranceOption(input, 'csrf-7')

    expect(result).toEqual(option)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/insurance-options')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-7' })
    expect(JSON.parse(init.body as string)).toEqual(input)
  })

  it('propagates a 409 duplicate-name failure as an ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: 'A plan with this name already exists' }, 409),
    )
    await expect(
      createInsuranceOption({ nameI18n: { en: 'dupe' }, dailyPriceJpy: 1 }, 'csrf'),
    ).rejects.toThrow('already exists')
  })
})

describe('updateInsuranceOption', () => {
  it('PATCHes /api/insurance-options/:id with the CSRF header and the partial body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...option, dailyPriceJpy: 3000 } }),
    )

    const result = await updateInsuranceOption('ins_1', { dailyPriceJpy: 3000 }, 'csrf-8')

    expect(result.dailyPriceJpy).toBe(3000)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/insurance-options/ins_1')
    expect(init.method).toBe('PATCH')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'csrf-8' })
    expect(JSON.parse(init.body as string)).toEqual({ dailyPriceJpy: 3000 })
  })

  it('encodes the id into the path', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: option }))
    await updateInsuranceOption('a/b', { nameI18n: { en: 'x' } }, 'csrf')
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/insurance-options/a%2Fb')
  })
})

describe('archiveInsuranceOption', () => {
  it('DELETEs /api/insurance-options/:id with the CSRF header and no body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { ...option, status: 'ARCHIVED' } }),
    )

    const result = await archiveInsuranceOption('ins_1', 'csrf-9')

    expect(result.status).toBe('ARCHIVED')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/insurance-options/ins_1')
    expect(init.method).toBe('DELETE')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'X-CSRF-Token': 'csrf-9' })
    expect(init.body).toBeUndefined()
  })
})

describe('insuranceOptionsQueryOptions', () => {
  it('exposes the stable INSURANCE_QUERY_KEY prefix so writes can invalidate every scope', () => {
    // INSURANCE_QUERY_KEY is the prefix; the per-scope key appends the picked
    // operator (or 'all') AND the locale (default 'en') so switching context or
    // language refetches without serving another tenant's / locale's cached list. A
    // prefix invalidate (invalidateQueries({ queryKey: INSURANCE_QUERY_KEY })) still
    // clears all scopes.
    expect(INSURANCE_QUERY_KEY).toEqual(['operator-insurance'])
    expect(insuranceOptionsQueryOptions().queryKey).toEqual(['operator-insurance', 'all', 'en'])
    expect(insuranceOptionsQueryOptions('op_9', 'ja').queryKey).toEqual([
      'operator-insurance',
      'op_9',
      'ja',
    ])
  })
})
