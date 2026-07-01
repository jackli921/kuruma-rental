import { afterEach, describe, expect, it, vi } from 'vitest'
import { setFeatureFlag } from './api'

describe('setFeatureFlag', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('PATCHes the keyed admin endpoint with the CSRF token and enabled body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { key: 'REVIEWS', enabled: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await setFeatureFlag({ key: 'REVIEWS', enabled: true, csrfToken: 'tok-123' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/admin/feature-flags/REVIEWS')
    expect(init.method).toBe('PATCH')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok-123')
    expect(JSON.parse(init.body as string)).toEqual({ enabled: true })
  })

  it('rejects when the API returns a non-ok status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status: 403 }),
    )
    await expect(
      setFeatureFlag({ key: 'REVIEWS', enabled: true, csrfToken: 'tok' }),
    ).rejects.toThrow()
  })
})
