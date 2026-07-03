import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTemplateLibrary, updateTemplate } from './api'

const BODY = {
  success: true,
  data: {
    addOns: [
      {
        id: 'a1',
        key: 'baby-seat',
        name: { en: 'Baby seat' },
        description: null,
        status: 'ARCHIVED',
      },
    ],
    insurance: [
      {
        id: 'i1',
        key: 'normal',
        name: { en: 'Normal', ja: 'ノーマル' },
        description: null,
        status: 'ACTIVE',
      },
    ],
  },
}

describe('fetchTemplateLibrary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('GETs the admin templates endpoint with cookies and parses both catalogs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(BODY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await fetchTemplateLibrary()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/admin/templates')
    expect(init.credentials).toBe('include')
    expect(result.addOns[0]).toMatchObject({ key: 'baby-seat', status: 'ARCHIVED' })
    expect(result.insurance[0]?.name).toEqual({ en: 'Normal', ja: 'ノーマル' })
  })

  it('rejects when the API returns a non-ok status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status: 403 }),
    )
    await expect(fetchTemplateLibrary()).rejects.toThrow()
  })
})

describe('updateTemplate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('PATCHes the catalog-scoped path with the CSRF header and returns the updated row', async () => {
    const updatedRow = {
      id: 'a1',
      key: 'baby-seat',
      name: { en: 'Baby seat', ja: 'ベビーシート' },
      description: null,
      status: 'ACTIVE',
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: updatedRow }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await updateTemplate({
      catalog: 'add-ons',
      id: 'a1',
      patch: { name: { en: 'Baby seat', ja: 'ベビーシート' }, status: 'ACTIVE' },
      csrfToken: 'csrf_1',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/admin/templates/add-ons/a1')
    expect(init.method).toBe('PATCH')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf_1')
    expect(JSON.parse(init.body as string)).toEqual({
      name: { en: 'Baby seat', ja: 'ベビーシート' },
      status: 'ACTIVE',
    })
    expect(result).toEqual(updatedRow)
  })

  it('rejects when the API returns a non-ok status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'PLATFORM_ADMIN role required' }), {
        status: 403,
      }),
    )
    await expect(
      updateTemplate({
        catalog: 'insurance',
        id: 'i1',
        patch: { status: 'ARCHIVED' },
        csrfToken: 'x',
      }),
    ).rejects.toThrow()
  })
})
