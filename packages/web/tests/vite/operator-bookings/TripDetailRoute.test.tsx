import { TripDetailRoute } from '@/routes/$locale/_business/manage/bookings/$bookingId'
import * as api from '@/vite/operator-bookings/api'
import type { OperatorBookingDetailDto } from '@/vite/operator-bookings/api'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { IntlProvider } from 'use-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

const d = enMessages.bookings.operator.detail

// #1361: the picked operator the route reads via useOperatorContext ->
// businessRoute.useSearch(). Hoisted so the router mock can close over it; each test
// sets it. Undefined = a tenant operator (no pick).
const routeCtx = vi.hoisted(() => ({ operator: undefined as string | undefined }))

// Render the route component outside a RouterProvider: stub createFileRoute
// (Route.useParams / useLoaderData), Link (-> anchor), and useRouter, then seed
// every useSuspenseQuery from cache. Mirrors OperatorFleetRoute.test.tsx (#598).
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')),
  createFileRoute: () => () => ({
    useParams: () => ({ locale: 'en', bookingId: 'bk-1' }),
    useLoaderData: () => ({ detail: detailDto('CONFIRMED') }),
  }),
  useRouter: () => ({ invalidate: vi.fn() }),
  getRouteApi: () => ({
    useSearch: () => ({ operator: routeCtx.operator }),
    useNavigate: () => vi.fn(),
  }),
  Link: ({ children, ...rest }: { children: ReactNode }) => <a {...rest}>{children}</a>,
}))

function detailDto(status: OperatorBookingDetailDto['status']): OperatorBookingDetailDto {
  return {
    id: 'bk-1',
    bookingCode: 'H7K2M9PQ',
    renterId: 'r-1',
    classId: 'cls-1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    startAt: '2026-07-01T01:00:00.000Z',
    endAt: '2026-07-03T01:00:00.000Z',
    effectiveEndAt: '2026-07-03T01:00:00.000Z',
    status,
    source: 'DIRECT',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    totalPrice: 18000,
    notes: null,
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
  }
}

const operatorSession: Session = {
  user: { id: 'u', role: 'OPERATOR_OWNER', operatorId: 'op_1', operatorSlug: 'acme' },
  csrfToken: 't',
}

// A picker admin (PLATFORM_ADMIN, no operatorId) — acts only through a chosen operator.
const bypassSession: Session = { user: { id: 'a', role: 'PLATFORM_ADMIN' }, csrfToken: 't' }

// staleTime=Infinity stops a mount-time background refetch, so the seeded CONFIRMED
// detail only changes when a mutation's invalidateQueries forces a refetch — which
// is exactly the behaviour under test.
function renderRoute(session: Session = operatorSession) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  queryClient.setQueryData(['session'], session)
  queryClient.setQueryData(
    api.operatorBookingDetailQueryOptions('bk-1').queryKey,
    detailDto('CONFIRMED'),
  )
  queryClient.setQueryData(api.bookingEventsQueryOptions('bk-1').queryKey, [])
  queryClient.setQueryData(api.substitutionCandidatesQueryOptions('bk-1').queryKey, [])
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <TripDetailRoute />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  routeCtx.operator = undefined
})

describe('TripDetailRoute refreshes after an operator action (#616)', () => {
  it('advances the panel from mark-picked-up to mark-returned once the status mutation succeeds', async () => {
    const user = userEvent.setup()
    // The detail re-fetch (forced by the mutation's invalidateQueries) now reports
    // ACTIVE. Stub fetch rather than spy fetchOperatorBookingDetail: the query
    // options call it via an intra-module binding a namespace spy can't intercept.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        // The mutation invalidates the whole operator-bookings prefix, so events +
        // candidates re-fetch too; keep them empty arrays and only the detail read
        // flips to ACTIVE.
        const data =
          url.includes('/substitution-candidates') || url.includes('/events')
            ? []
            : detailDto('ACTIVE')
        return new Response(JSON.stringify({ success: true, data }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    vi.spyOn(api, 'updateBookingStatus').mockResolvedValue(detailDto('ACTIVE') as never)
    renderRoute()

    expect(screen.getByRole('button', { name: d.markActive })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: d.markActive }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: d.markCompleted })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: d.markActive })).not.toBeInTheDocument()
  })
})

// #1361: locks the route -> panel handoff. tsc can't catch a dropped optional
// `pickedOperatorId` prop, so prove the picked operator (from useOperatorContext)
// actually reaches the status write for a picker admin.
describe('TripDetailRoute threads the picked operator into the write (#1361)', () => {
  it('a picker admin advancing carries the chosen operator as ?operatorId=', async () => {
    routeCtx.operator = 'op_7'
    const user = userEvent.setup()
    const spy = vi.spyOn(api, 'updateBookingStatus').mockResolvedValue(detailDto('ACTIVE') as never)
    renderRoute(bypassSession)

    await user.click(screen.getByRole('button', { name: d.markActive }))

    await waitFor(() => expect(spy).toHaveBeenCalledWith('bk-1', 'ACTIVE', 't', 'op_7'))
  })
})
