import { OperatorTeamRoute } from '@/routes/$locale/_business/manage/team'
import { sessionQueryOptions } from '@/vite/session'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { type ReactNode, Suspense } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

// The capability-gated resolution + keyed render-gate child introduced in Slice 6
// (#1230). Three pins:
//
// P1  — PLATFORM_ADMIN with no pick shows the pick-prompt and issues NO
//       /operators/me/* read (the operatorId-gated OperatorTeamData child never mounts).
// P2a — A legacy STAFF session with a retained ?operator= is NOT a picker;
//       shows noOperatorContext with no team read.
// P3  — Picked mode: scoped read fires with the picked id.
// P2b — key={operatorId} remounts OperatorTeamData on tenant switch, proven by the
//       new /operators/me/members?operatorId=op_3 read firing after the switch.
//
// We do NOT globally stub useSuspenseQuery — fetch is stubbed per test so the
// render-gate logic is exercised for real.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const useOperatorContextMock = vi.fn<() => { pickedOperatorId: string | undefined }>()

// Spread the real module so OperatorBadge / operatorsQueryOptions / other exports
// the render path may reach survive unchanged.
vi.mock('@/vite/operator-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/vite/operator-context')>()
  return { ...actual, useOperatorContext: () => useOperatorContextMock() }
})

const en = enMessages.business.team

function platformAdminSession(): Session {
  return { user: { id: 'a', role: 'PLATFORM_ADMIN' }, csrfToken: 'c' }
}

function staffSession(): Session {
  // Legacy STAFF: has business access but no operatorId, and is NOT isPlatformAdmin.
  return { user: { id: 's', role: 'STAFF' }, csrfToken: 'c' }
}

// Pre-seed session in cache (staleTime=Infinity) so useSuspenseQuery(sessionQueryOptions())
// returns immediately without firing a fetch — mirrors VehicleDetailRoute.test.tsx pattern.
function renderRoute(session: Session) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Number.POSITIVE_INFINITY, retry: false },
      mutations: { retry: false },
    },
  })
  client.setQueryData(sessionQueryOptions().queryKey, session)
  return render(<OperatorTeamRoute />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <IntlProvider locale="en" messages={enMessages}>
          {/* Suspense boundary required: OperatorTeamData uses useSuspenseQuery */}
          <Suspense fallback={null}>{children}</Suspense>
        </IntlProvider>
      </QueryClientProvider>
    ),
  })
}

describe('OperatorTeamRoute capability-gated resolution (Slice 6 #1230)', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('P1 — PLATFORM_ADMIN with no pick shows the pick-prompt and issues no /operators/me/* read', () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    useOperatorContextMock.mockReturnValue({ pickedOperatorId: undefined })

    renderRoute(platformAdminSession())

    // Prompt is visible — the operatorId-gated OperatorTeamData child never mounted.
    expect(screen.getByText(en.pickOperatorPrompt)).toBeInTheDocument()
    // No team read fired (the child never mounted, so no useSuspenseQuery calls).
    const calledTeam = fetchMock.mock.calls.some(([u]) => String(u).includes('/operators/me/'))
    expect(calledTeam).toBe(false)
  })

  it('P2a — STAFF with retained pickedOperatorId shows the no-context prompt and fires no team read', () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    // canPickOperatorContext(STAFF) = false → picked = undefined → operatorId = undefined
    useOperatorContextMock.mockReturnValue({ pickedOperatorId: 'op_2' })

    renderRoute(staffSession())

    expect(screen.getByText(en.noOperatorContext)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/operators/me/'))).toBe(false)
  })

  it('Picked mode — PLATFORM_ADMIN with a pick fires the scoped team read with ?operatorId=', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    useOperatorContextMock.mockReturnValue({ pickedOperatorId: 'op_2' })

    renderRoute(platformAdminSession())

    // OperatorTeamData mounts with key='op_2' and fires members + invites reads.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) =>
          String(u).includes('/operators/me/members?operatorId=op_2'),
        ),
      ).toBe(true),
    )
    // The render gate opened: the pick-prompt is gone (the scoped child mounted),
    // so a read firing while the prompt still showed would fail here.
    expect(screen.queryByText(en.pickOperatorPrompt)).not.toBeInTheDocument()
  })

  it('P2b — key={operatorId} remounts OperatorTeamData on tenant switch, firing new reads for the new tenant', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    useOperatorContextMock.mockReturnValue({ pickedOperatorId: 'op_2' })
    const { rerender } = renderRoute(platformAdminSession())

    // Wait for the initial op_2 reads to fire (child mounted with key='op_2').
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) =>
          String(u).includes('/operators/me/members?operatorId=op_2'),
        ),
      ).toBe(true),
    )

    // Switch to op_3: key changes 'op_2' → 'op_3'. React unmounts the old child
    // (resetting all useState: inviteOpen, selectedInvite, selectedMember) and
    // mounts the new one. Proven by the new /operators/me/members?operatorId=op_3 read.
    fetchMock.mockClear()
    useOperatorContextMock.mockReturnValue({ pickedOperatorId: 'op_3' })
    rerender(<OperatorTeamRoute />)

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) =>
          String(u).includes('/operators/me/members?operatorId=op_3'),
        ),
      ).toBe(true),
    )
    // op_2 data is in cache (staleTime=Infinity) — its reads must NOT re-fire.
    expect(
      fetchMock.mock.calls.some(([u]) =>
        String(u).includes('/operators/me/members?operatorId=op_2'),
      ),
    ).toBe(false)
  })
})
