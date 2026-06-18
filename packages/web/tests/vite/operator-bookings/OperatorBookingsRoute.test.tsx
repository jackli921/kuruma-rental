import { OperatorBookingsRoute } from '@/routes/$locale/_business/manage/bookings/index'
import * as api from '@/vite/operator-bookings/api'
import { calendarRange, parseCalendarDate } from '@/vite/operator-bookings/calendar-events'
import { type OperatorLocation, operatorLocationsQueryOptions } from '@/vite/operator-locations/api'
import type { Session } from '@/vite/session'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import enMessages from '../../../messages/en.json'

const c = enMessages.bookings.operator.newBooking

// Render the route component outside a RouterProvider: stub createFileRoute
// (Route.useParams/useSearch/useNavigate) + useRouter, and seed the suspense
// calendar reads + session from cache. Mirrors TripDetailRoute.test.tsx.
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')),
  createFileRoute: () => () => ({
    useParams: () => ({ locale: 'en' }),
    useSearch: () => ({ view: 'week', date: '2026-07-01' }),
    useNavigate: () => vi.fn(),
  }),
  useRouter: () => ({ invalidate: vi.fn() }),
}))

// Capture the props BookingsCalendar hands to rbc's <Calendar> so the route's
// operator-only gate on slot-selection can be asserted end-to-end (route ->
// BookingsCalendar -> rbc `selectable`). The button gate and the slot gate are
// independent expressions sharing `canManualBook`; this pins the slot half so a
// mutation can't ungate slot-click manual booking for a non-operator. Only
// Calendar is replaced; the real dateFnsLocalizer stays so the localizer loads.
let calendarProps: Record<string, unknown> = {}
vi.mock('react-big-calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-big-calendar')>()),
  Calendar: (props: Record<string, unknown>) => {
    calendarProps = props
    return null
  },
}))

const ANCHOR = '2026-07-01'
const { from, to } = calendarRange('week', parseCalendarDate(ANCHOR))

const operatorSession: Session = {
  user: { id: 'u', role: 'OPERATOR_OWNER', operatorId: 'op_1', operatorSlug: 'acme' },
  csrfToken: 't',
}

// A bypass role (PLATFORM_ADMIN) clears the _business guard but carries no
// operatorId, so it reads the calendar cross-tenant and must NOT see the write
// affordance (no operator picker on the form -> no single target tenant). #589/§4.3.
const bypassSession: Session = {
  user: { id: 'admin', role: 'PLATFORM_ADMIN' },
  csrfToken: 't',
}

// A bookable fixture for tests that need the dialog FORM (not the empty-inventory
// guidance): the form only renders when there is at least one vehicle and one store.
const bookableVehicles = [{ id: 'veh-1', name: 'Toyota Aqua' }]
const nambaStore: OperatorLocation = {
  id: 'loc-1',
  operatorId: 'op_1',
  name: 'Namba Store',
  address: '1-1 Namba, Osaka',
  operatingHours: null,
  timezone: 'Asia/Tokyo',
  defaultTurnaroundMinutes: 60,
  status: 'ACTIVE',
  coordinateSource: 'GEOCODED',
  regionId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function renderRoute(
  session: Session,
  vehicles: api.CalendarVehicle[] = [],
  locations: OperatorLocation[] = [],
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  queryClient.setQueryData(['session'], session)
  queryClient.setQueryData(api.operatorCalendarQueryOptions(from, to).queryKey, [])
  queryClient.setQueryData(api.operatorCalendarVehiclesQueryOptions().queryKey, vehicles)
  // The dialog reads pickup/return stores lazily on open; seed them (default []) so
  // the test stays hermetic (staleTime is infinite, so no network fetch fires).
  queryClient.setQueryData(operatorLocationsQueryOptions().queryKey, locations)
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <OperatorBookingsRoute />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

// Manual/walk-in booking (#589) is a post-MVP add-on gated behind a flag (OFF in
// the beta demo). These tests cover the feature, so enable it; the OFF case below
// asserts the affordance disappears entirely.
beforeEach(() => {
  vi.stubEnv('VITE_FEATURE_OPERATOR_MANUAL_BOOKING', 'true')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  calendarProps = {}
})

describe('OperatorBookingsRoute manual-booking affordance (#589 1d)', () => {
  it('shows the New Booking button for a tenant-scoped operator session', () => {
    renderRoute(operatorSession)
    expect(screen.getByRole('button', { name: c.action })).toBeInTheDocument()
  })

  it('hides the New Booking affordance in the beta MVP demo (manual-booking flag off)', () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_MANUAL_BOOKING', undefined)
    renderRoute(operatorSession)
    expect(screen.queryByRole('button', { name: c.action })).not.toBeInTheDocument()
    expect(calendarProps.selectable).toBe(false)
  })

  it('hides the New Booking button for a bypass (non-operator) session', () => {
    renderRoute(bypassSession)
    expect(screen.queryByRole('button', { name: c.action })).not.toBeInTheDocument()
  })

  it('opens the manual-booking dialog when New Booking is clicked', async () => {
    const user = userEvent.setup()
    renderRoute(operatorSession)
    expect(screen.queryByRole('heading', { name: c.dialogTitle })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: c.action }))

    expect(await screen.findByRole('heading', { name: c.dialogTitle })).toBeInTheDocument()
  })

  it('enables calendar slot-selection for an operator session', () => {
    renderRoute(operatorSession)
    expect(calendarProps.selectable).toBe(true)
  })

  it('disables calendar slot-selection for a bypass (non-operator) session', () => {
    renderRoute(bypassSession)
    expect(calendarProps.selectable).toBe(false)
  })

  it('opens the dialog with the clicked calendar slot prefilled (wall-clock JST)', async () => {
    renderRoute(operatorSession, bookableVehicles, [nambaStore])
    // rbc hands a SlotInfo to BookingsCalendar's adapter (captured here); it surfaces
    // {start,end}, which the route threads to the dialog as initialRange. 01:00Z is
    // 10:00 JST — the form shows wall-clock Tokyo.
    await act(async () => {
      ;(calendarProps.onSelectSlot as (s: { start: Date; end: Date }) => void)({
        start: new Date('2026-07-01T01:00:00.000Z'),
        end: new Date('2026-07-03T01:00:00.000Z'),
      })
    })
    expect(await screen.findByRole('heading', { name: c.dialogTitle })).toBeInTheDocument()
    expect(screen.getByLabelText(c.startLabel)).toHaveValue('2026-07-01T10:00')
    expect(screen.getByLabelText(c.endLabel)).toHaveValue('2026-07-03T10:00')
  })
})
