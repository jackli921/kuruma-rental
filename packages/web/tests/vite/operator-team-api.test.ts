import { fetchTeamInvites, fetchTeamMembers, inviteStaff } from '@/vite/operator-team/api'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('inviteStaff', () => {
  it('POSTs the email with the CSRF header and returns the one-time share URL', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          inviteUrl: 'https://app/provider/invite/tok',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await inviteStaff({ email: 'new@x.com' }, 'csrf-1')
    expect(result).toEqual({
      inviteUrl: 'https://app/provider/invite/tok',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/operators/me/invites')
    expect(opts.method).toBe('POST')
    expect((opts.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-1')
    expect(opts.credentials).toBe('include')
    expect(JSON.parse(opts.body as string)).toEqual({ email: 'new@x.com' })
  })

  it('throws on a CSRF rejection (403) so the dialog surfaces it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'CSRF token mismatch' }, 403)),
    )
    await expect(inviteStaff({ email: 'x@x.com' }, 'stale')).rejects.toThrow()
  })
})

describe('fetchTeamMembers', () => {
  it('parses the active members joined to name + email', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [
            {
              id: 'm1',
              userId: 'u1',
              name: 'Olive Owner',
              email: 'owner@x.com',
              role: 'OPERATOR_OWNER',
              status: 'ACTIVE',
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      ),
    )
    const members = await fetchTeamMembers()
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ userId: 'u1', name: 'Olive Owner', role: 'OPERATOR_OWNER' })
  })

  it('tolerates a null name/email (walk-in-style user) without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [
            {
              id: 'm1',
              userId: 'u1',
              name: null,
              email: null,
              role: 'OPERATOR_STAFF',
              status: 'ACTIVE',
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      ),
    )
    const members = await fetchTeamMembers()
    expect(members[0]?.name).toBeNull()
  })
})

describe('fetchTeamInvites', () => {
  it('parses the pending invites', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          success: true,
          data: [
            {
              id: 'i1',
              email: 'pending@x.com',
              role: 'OPERATOR_STAFF',
              status: 'PENDING',
              expiresAt: '2099-01-01T00:00:00.000Z',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      ),
    )
    const invites = await fetchTeamInvites()
    expect(invites[0]).toMatchObject({ email: 'pending@x.com', status: 'PENDING' })
  })
})
