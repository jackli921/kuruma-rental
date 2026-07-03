import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTemplateLibrary } from './api'

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
