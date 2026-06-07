import { fetchSession } from '@/vite/session'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('unwraps the ok() envelope into the session', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: { user: { id: 'u1', role: 'RENTER' }, csrfToken: 'tok' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchSession()).resolves.toEqual({
      user: { id: 'u1', role: 'RENTER' },
      csrfToken: 'tok',
    })
    expect(fetchMock).toHaveBeenCalledWith('/auth/session', { credentials: 'include' })
  })

  it('returns null on 401 (no session)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'Unauthorized' }, 401)),
    )
    await expect(fetchSession()).resolves.toBeNull()
  })

  it('returns null for a raw un-enveloped body (not a session)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ user: { id: 'u1', role: 'RENTER' }, csrfToken: 'tok' })),
    )
    await expect(fetchSession()).resolves.toBeNull()
  })

  it('returns null when the envelope is unsuccessful', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false })),
    )
    await expect(fetchSession()).resolves.toBeNull()
  })

  it('throws on unexpected server errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false }, 500)),
    )
    await expect(fetchSession()).rejects.toThrow()
  })
})
