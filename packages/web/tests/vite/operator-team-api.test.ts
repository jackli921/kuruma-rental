import {
  deactivateMember,
  fetchTeamInvites,
  fetchTeamMembers,
  inviteStaff,
  revokeInvite,
  teamInvitesQueryOptions,
  teamMembersQueryOptions,
} from '@/vite/operator-team/api'
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

    const result = await inviteStaff({ email: 'new@x.com' }, 'csrf-1', 'op_1')
    expect(result).toEqual({
      inviteUrl: 'https://app/provider/invite/tok',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/operators/me/invites')
    expect(url).toContain('operatorId=op_1')
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
    await expect(inviteStaff({ email: 'x@x.com' }, 'stale', 'op_1')).rejects.toThrow(
      'CSRF token mismatch',
    )
  })
})

describe('revokeInvite', () => {
  it('POSTs to the scoped revoke path with the CSRF header', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { id: 'i1' } }))
    vi.stubGlobal('fetch', fetchMock)

    await revokeInvite('i1', 'csrf-1', 'op_1')

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/operators/me/invites/i1/revoke')
    expect(url).toContain('operatorId=op_1')
    expect(opts.method).toBe('POST')
    expect((opts.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-1')
    expect(opts.credentials).toBe('include')
  })

  it('throws on a 404 (already revoked / foreign tenant)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: false, error: 'invite not found' }, 404)),
    )
    await expect(revokeInvite('nope', 'csrf-1', 'op_1')).rejects.toThrow('invite not found')
  })
})

describe('deactivateMember', () => {
  it('POSTs to the scoped deactivate path with the CSRF header', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { id: 'm1' } }))
    vi.stubGlobal('fetch', fetchMock)

    await deactivateMember('m1', 'csrf-1', 'op_1')

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/operators/me/members/m1/deactivate')
    expect(url).toContain('operatorId=op_1')
    expect(opts.method).toBe('POST')
    expect((opts.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-1')
    expect(opts.credentials).toBe('include')
  })

  it('surfaces the 409 last-owner message so the dialog can show it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ success: false, error: 'cannot deactivate the last operator owner' }, 409),
      ),
    )
    await expect(deactivateMember('m1', 'csrf-1', 'op_1')).rejects.toThrow(
      'cannot deactivate the last operator owner',
    )
  })
})

describe('fetchTeamMembers', () => {
  it('parses the active members joined to name + email', async () => {
    const fetchMock = vi.fn(async () =>
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
    )
    vi.stubGlobal('fetch', fetchMock)

    const members = await fetchTeamMembers('op_1')
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ userId: 'u1', name: 'Olive Owner', role: 'OPERATOR_OWNER' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('operatorId=op_1')
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
    const members = await fetchTeamMembers('op_1')
    expect(members[0]?.name).toBeNull()
  })
})

describe('fetchTeamInvites', () => {
  it('parses the pending invites', async () => {
    const fetchMock = vi.fn(async () =>
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
    )
    vi.stubGlobal('fetch', fetchMock)

    const invites = await fetchTeamInvites('op_1')
    expect(invites[0]).toMatchObject({ email: 'pending@x.com', status: 'PENDING' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('operatorId=op_1')
  })
})

describe('query keys fold in the operatorId', () => {
  it('keys team reads on the operator so a tenant switch refetches', () => {
    expect(teamMembersQueryOptions('op_1').queryKey).toEqual(['operator-team', 'members', 'op_1'])
    expect(teamInvitesQueryOptions('op_2').queryKey).toEqual(['operator-team', 'invites', 'op_2'])
  })
})
