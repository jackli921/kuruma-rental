import { fetchSession, signOut } from '@/vite/session'
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

  it('passes the optional display profile (name/email/image) through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: {
            user: {
              id: 'u1',
              role: 'RENTER',
              name: 'Aiko Tanaka',
              email: 'aiko@example.com',
              image: 'https://img.example/avatar.png',
            },
            csrfToken: 'tok',
          },
        }),
      ),
    )
    await expect(fetchSession()).resolves.toEqual({
      user: {
        id: 'u1',
        role: 'RENTER',
        name: 'Aiko Tanaka',
        email: 'aiko@example.com',
        image: 'https://img.example/avatar.png',
      },
      csrfToken: 'tok',
    })
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

describe('signOut', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /auth/signout echoing the CSRF token from the session', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(signOut('csrf-123')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/auth/signout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': 'csrf-123' },
    })
  })

  it('throws when the CSRF token is rejected (403)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'CSRF token mismatch' }, 403)),
    )
    await expect(signOut('stale')).rejects.toThrow('403')
  })
})
