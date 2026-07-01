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
const B = enMessages.bookings.operator.blocks

// Render the route component outside a RouterProvider: stub createFileRoute
// (Route.useParams/useSearch/useNavigate) + useRouter, and seed the suspense
// calendar reads + session from cache. Mirrors TripDetailRoute.test.tsx.
//
// The route's search params, mutable so a test can drop `view` to exercise the
// default (timeline) landing view. vi.hoisted so the hoisted vi.mock factory reads it.
const searchState = vi.hoisted(() => ({
  value: { view: 'week', date: '2026-07-01' } as { view?: string; date?: string },
}))
// #1101: a shared navigate spy (hoisted so the mock factory can close over it)
// lets the block-vs-booking click dispatch be asserted.
const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')),
  createFileRoute: () => () => ({
    useParams: () => ({ locale: 'en' }),
    useSearch: () => searchState.value,
    useNavigate: () => navigate,
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
// Seed both the week range (the explicit-view tests) and the timeline range (the
// default landing view) for the same anchor day, so whichever view the component
// resolves reads from cache (staleTime ∞ → no fetch).
const weekRange = calendarRange('week', parseCalendarDate(ANCHOR))
const timelineRange = calendarRange('timeline', parseCalendarDate(ANCHOR))

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

// #1101 blocks-layer fixtures: a two-car fleet, a confirmed booking on veh-1, and a
// maintenance block band on veh-2.
const blocksFleet: api.CalendarVehicle[] = [
  { id: 'veh-1', name: 'Prius' },
  { id: 'veh-2', name: 'Note' },
]
const calendarBooking: api.CalendarBookingRow = {
  id: 'bk-1',
  bookingCode: 'CODE1',
  status: 'CONFIRMED',
  startAt: '2026-07-01T01:00:00.000Z',
  effectiveEndAt: '2026-07-01T05:00:00.000Z',
  vehicleId: 'veh-1',
  renterName: 'Alice',
  renterEmail: null,
  totalPrice: null,
}
const maintenanceBlock: api.CalendarBlockRow = {
  id: 'blk-1',
  vehicleId: 'veh-2',
  startAt: '2026-07-02T00:00:00.000Z',
  endAt: '2026-07-03T00:00:00.000Z',
  kind: 'MAINTENANCE',
  reason: 'Oil change',
  notes: null,
}

function renderRoute(
  session: Session,
  vehicles: api.CalendarVehicle[] = [],
  locations: OperatorLocation[] = [],
  seed: { bookings?: api.CalendarBookingRow[]; blocks?: api.CalendarBlockRow[] } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
  })
  queryClient.setQueryData(['session'], session)
  // Seed bookings + blocks for BOTH the week range (explicit-view tests) and the
  // timeline range (default landing view) so whichever view the component resolves
  // reads from cache (staleTime ∞ → no fetch). Blocks are an additive non-suspense
  // layer; seeding them lets a flag-on / admin-preview render show the band.
  for (const range of [weekRange, timelineRange]) {
    queryClient.setQueryData(
      api.operatorCalendarQueryOptions(range.from, range.to).queryKey,
      seed.bookings ?? [],
    )
    queryClient.setQueryData(
      api.operatorCalendarBlocksQueryOptions(range.from, range.to).queryKey,
      seed.blocks ?? [],
    )
  }
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
  searchState.value = { view: 'week', date: '2026-07-01' }
  navigate.mockReset()
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

describe('OperatorBookingsRoute quick-view enrichment (#1099)', () => {
  it('enriches calendar events with the assigned vehicle name (transform wiring)', () => {
    // veh-1 -> 'Prius' in blocksFleet; the route resolves the name at transform time
    // so the quick-view card renders it with no extra fetch.
    renderRoute(operatorSession, blocksFleet, [], { bookings: [calendarBooking] })
    const events = calendarProps.events as Array<{
      id: string
      type: string
      vehicleName: string | null
    }>
    const booking = events.find((e) => e.type === 'booking')
    expect(booking).toMatchObject({ id: 'bk-1', vehicleName: 'Prius' })
  })
})

describe('OperatorBookingsRoute default view (#1100)', () => {
  it('lands on the fleet timeline board when no view param is present', () => {
    searchState.value = { date: ANCHOR } // view omitted -> DEFAULT_VIEW = 'timeline'
    renderRoute(operatorSession)
    // FleetTimeline owns its toolbar (rendered outside the mocked rbc Calendar); its
    // active "Timeline" button is proof the timeline board mounted, not the week grid.
    expect(
      screen.getByRole('button', { name: enMessages.business.bookings.calendar.views.timeline }),
    ).toBeInTheDocument()
    // The rbc <Calendar> (day/week/month) never mounted, so it captured no props.
    expect(calendarProps).toEqual({})
  })
})

// #1101 Slice B: the route wires the blocks layer onto the operator calendar. The
// pure transforms are unit-tested in calendar-events.test.ts; these cases pin the
// wiring + the admin read-only security crux through the captured Calendar props
// (events / onSelectEvent / onSelectSlot / selectable). The block flag is off by
// default — VITE_FEATURE_OPERATOR_BLOCKS gates the non-admin path.
describe('OperatorBookingsRoute blocks layer (#1101)', () => {
  it('hides the blocks layer for a non-admin operator when the flag is off', () => {
    renderRoute(operatorSession, blocksFleet, [], { blocks: [maintenanceBlock] })

    const events = calendarProps.events as { type: string }[]
    expect(events.filter((e) => e.type === 'block')).toHaveLength(0)
    expect(screen.queryByText(B.legend.title)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: B.scheduleAction })).not.toBeInTheDocument()
  })

  it('shows blocks read-only to a platform admin previewing with the flag off', () => {
    renderRoute(bypassSession, blocksFleet, [], { blocks: [maintenanceBlock] })

    // Visible: the admin previews the legend + block band (isVisibleToViewer bypass).
    expect(screen.getByText(B.legend.title)).toBeInTheDocument()
    const events = calendarProps.events as { type: string }[]
    expect(events.filter((e) => e.type === 'block')).toHaveLength(1)

    // Read-only: no Schedule affordance and the calendar is not slot-selectable
    // (isOperatorSession(admin) is false -> canManageBlocks false).
    expect(screen.queryByRole('button', { name: B.scheduleAction })).not.toBeInTheDocument()
    expect(calendarProps.selectable).toBe(false)

    // Opening the block shows detail but offers NO Remove action — the gate that
    // keeps an admin preview read-only even though the write API would admit it.
    const block = (calendarProps.events as { type: string }[]).find((e) => e.type === 'block')
    act(() => (calendarProps.onSelectEvent as (i: unknown) => void)(block))
    expect(screen.getByText(B.detail.dialogTitle)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: B.detail.deleteAction })).not.toBeInTheDocument()
  })

  it('dispatches a clicked booking to its detail page and a clicked block to the detail dialog', () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_BLOCKS', 'true')
    renderRoute(operatorSession, blocksFleet, [], {
      bookings: [calendarBooking],
      blocks: [maintenanceBlock],
    })

    const events = calendarProps.events as { type: string; id: string }[]
    const booking = events.find((e) => e.type === 'booking')
    const block = events.find((e) => e.type === 'block')

    act(() => (calendarProps.onSelectEvent as (i: unknown) => void)(booking))
    expect(navigate).toHaveBeenCalledWith({
      to: '/$locale/manage/bookings/$bookingId',
      params: { locale: 'en', bookingId: 'bk-1' },
    })

    act(() => (calendarProps.onSelectEvent as (i: unknown) => void)(block))
    expect(screen.getByText(B.detail.dialogTitle)).toBeInTheDocument()
  })

  it('prefills the schedule dialog with the slot vehicle for a managing operator', async () => {
    // Blocks on, manual booking off -> the slot gesture routes to block scheduling.
    vi.stubEnv('VITE_FEATURE_OPERATOR_BLOCKS', 'true')
    vi.stubEnv('VITE_FEATURE_OPERATOR_MANUAL_BOOKING', undefined)
    renderRoute(operatorSession, blocksFleet)

    expect(calendarProps.selectable).toBe(true)
    await act(async () => {
      ;(calendarProps.onSelectSlot as (s: { start: Date; end: Date; resourceId?: string }) => void)(
        {
          start: new Date('2026-07-01T01:00:00.000Z'),
          end: new Date('2026-07-01T03:00:00.000Z'),
          resourceId: 'veh-2',
        },
      )
    })

    // The slot's resource column prefills the schedule dialog's vehicle picker (review #2).
    expect((screen.getByLabelText(B.schedule.vehicleLabel) as HTMLSelectElement).value).toBe(
      'veh-2',
    )
  })

  it('keeps the Schedule affordance on a calendar view where a block is visible', () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_BLOCKS', 'true')
    searchState.value = { view: 'week', date: ANCHOR }
    renderRoute(operatorSession, blocksFleet)
    expect(screen.getByRole('button', { name: B.scheduleAction })).toBeInTheDocument()
  })

  it('hides the Schedule affordance on the default timeline view (a created block renders no band there)', () => {
    vi.stubEnv('VITE_FEATURE_OPERATOR_BLOCKS', 'true')
    searchState.value = { view: 'timeline', date: ANCHOR }
    renderRoute(operatorSession, blocksFleet)
    expect(screen.queryByRole('button', { name: B.scheduleAction })).not.toBeInTheDocument()
  })
})
