import { OperatorTeamRoute } from '@/routes/$locale/_business/manage/team'
import { teamInvitesQueryOptions, teamMembersQueryOptions } from '@/vite/operator-team/api'
import { type Session, sessionQueryOptions } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, Suspense } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// The picker context is the ONE input that decides all-mode vs picked; mock it so
// each test drives it directly. Session comes through the query cache (seeded),
// and `fetch` is stubbed — NOT useSuspenseQuery — so the P1 "no team read fires"
// assertion observes real network behavior, not a stubbed-away query.
const useOperatorContextMock = vi.fn<() => { pickedOperatorId: string | undefined }>()

vi.mock('@/vite/operator-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-context')>()
  return { ...actual, useOperatorContext: () => useOperatorContextMock() }
})

const en = enMessages.business.team

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderRoute(session: Session | null, seedTeams: readonly string[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(sessionQueryOptions().queryKey, session)
  // Pre-seed named tenants so their team reads resolve without suspense/fetch —
  // used only where a test switches tenants and must not race the network.
  for (const id of seedTeams) {
    client.setQueryData(teamMembersQueryOptions(id).queryKey, [])
    client.setQueryData(teamInvitesQueryOptions(id).queryKey, [])
  }
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={enMessages}>
          <Suspense fallback={<div>loading</div>}>{children}</Suspense>
        </IntlProvider>
      </QueryClientProvider>
    )
  }
  return render(<OperatorTeamRoute />, { wrapper })
}

const calledTeamRead = (m: ReturnType<typeof vi.fn>): boolean =>
  m.mock.calls.some(([u]) => String(u).includes('/operators/me/'))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('OperatorTeamRoute picker gating (#1230)', () => {
  // P1 — all-mode fires NO team read (the operatorId-gated child never mounts).
  it('a PLATFORM_ADMIN with no pick shows the pick-prompt and issues no /operators/me/* read', () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    useOperatorContextMock.mockReturnValue({ pickedOperatorId: undefined })

    renderRoute({ user: { id: 'a', role: 'PLATFORM_ADMIN' }, csrfToken: 'c' })

    expect(screen.getByText(en.pickOperatorPrompt)).toBeInTheDocument()
    expect(calledTeamRead(fetchMock)).toBe(false)
  })

  // P2a — a legacy STAFF/ADMIN with a retained ?operator= is NOT a picker: it sees
  // the no-context prompt (its team read would 403) and fires no team read.
  it('a legacy STAFF session with a retained pickedOperatorId shows the no-context prompt and fires no team read', () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    useOperatorContextMock.mockReturnValue({ pickedOperatorId: 'op_2' })

    renderRoute({ user: { id: 's', role: 'STAFF' }, csrfToken: 'c' })

    expect(screen.getByText(en.noOperatorContext)).toBeInTheDocument()
    expect(calledTeamRead(fetchMock)).toBe(false)
  })

  // Picked mode — the scoped read fires with the picked id.
  it('a PLATFORM_ADMIN with a pick fires the scoped team read with ?operatorId=', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    useOperatorContextMock.mockReturnValue({ pickedOperatorId: 'op_2' })

    renderRoute({ user: { id: 'a', role: 'PLATFORM_ADMIN' }, csrfToken: 'c' })

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) =>
          String(u).includes('/operators/me/members?operatorId=op_2'),
        ),
      ).toBe(true),
    )
  })

  // P2b — a tenant switch remounts the keyed child, resetting dialog state: an
  // invite dialog opened under op_2 is gone after switching to op_3.
  it('resets open dialog state when the picked tenant switches (key remount)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ success: true, data: [] })),
    )
    useOperatorContextMock.mockReturnValue({ pickedOperatorId: 'op_2' })
    const user = userEvent.setup()

    const { rerender } = renderRoute(
      { user: { id: 'a', role: 'PLATFORM_ADMIN' }, csrfToken: 'c' },
      ['op_2', 'op_3'],
    )

    await user.click(await screen.findByRole('button', { name: en.invite }))
    expect(screen.getByText(en.inviteTitle)).toBeInTheDocument()

    useOperatorContextMock.mockReturnValue({ pickedOperatorId: 'op_3' })
    rerender(<OperatorTeamRoute />)

    await waitFor(() => expect(screen.queryByText(en.inviteTitle)).not.toBeInTheDocument())
  })
})
