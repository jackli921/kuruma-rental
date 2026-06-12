import { fetchInvitePreview } from '@/vite/provider/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchInvitePreview', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('unwraps the preview envelope and requests the token-scoped preview path', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: { valid: true, operatorName: 'Pilot Operator', expiresAt: '2026-07-01T00:00:00Z' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchInvitePreview('tok-123')).resolves.toEqual({
      valid: true,
      operatorName: 'Pilot Operator',
      expiresAt: '2026-07-01T00:00:00Z',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/provider-invites/tok-123/preview', {
      credentials: 'include',
    })
  })

  it('returns valid:false for an unknown/expired invite (200 envelope)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: { valid: false } })),
    )
    await expect(fetchInvitePreview('nope')).resolves.toEqual({ valid: false })
  })

  it('encodes the token in the request path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { valid: false } }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchInvitePreview('a/b token')
    expect(fetchMock).toHaveBeenCalledWith('/api/provider-invites/a%2Fb%20token/preview', {
      credentials: 'include',
    })
  })
})
